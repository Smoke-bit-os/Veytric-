import os
import uuid
import base64
import logging
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Annotated, Any

from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, BeforeValidator
from bson import ObjectId
import jwt
import bcrypt

from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText
from emergentintegrations.llm.openai.text_to_speech import OpenAITextToSpeech

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jarvis")


# ----------------------------- Models ---------------------------------------
def _oid(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    return str(v)


PyObjectId = Annotated[str, BeforeValidator(_oid)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class Vehicle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    make: str
    model: str
    year: int
    vin: Optional[str] = ""
    engine: Optional[str] = ""
    is_active: bool = False
    created_at: str = Field(default_factory=now_iso)


class VehicleInput(BaseModel):
    name: str
    make: str
    model: str
    year: int
    vin: Optional[str] = ""
    engine: Optional[str] = ""


class ChatInput(BaseModel):
    session_id: str
    message: str
    telemetry: Optional[dict] = None
    vehicle: Optional[dict] = None


class TTSInput(BaseModel):
    text: str
    voice: Optional[str] = "onyx"


# ----------------------------- Auth helpers ---------------------------------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def make_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


async def get_current_user(cred: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not cred:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(cred.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def public_user(u: dict) -> dict:
    return {"id": u["_id"], "name": u["name"], "email": u["email"]}


# ----------------------------- Routes: Auth ---------------------------------
@api_router.get("/")
async def root():
    return {"message": "JARVIS AI online"}


@api_router.post("/auth/register")
async def register(inp: RegisterInput):
    existing = await db.users.find_one({"email": inp.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = str(uuid.uuid4())
    doc = {
        "_id": uid,
        "name": inp.name,
        "email": inp.email.lower(),
        "password": hash_pw(inp.password),
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {"token": make_token(uid), "user": public_user(doc)}


@api_router.post("/auth/login")
async def login(inp: LoginInput):
    user = await db.users.find_one({"email": inp.email.lower()})
    if not user or not verify_pw(inp.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": make_token(user["_id"]), "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return public_user(user)


# ----------------------------- Routes: Vehicles -----------------------------
@api_router.get("/vehicles")
async def list_vehicles(user=Depends(get_current_user)):
    docs = await db.vehicles.find({"user_id": user["_id"]}).sort("created_at", 1).to_list(100)
    return [{k: v for k, v in d.items() if k not in ("user_id", "_id")} for d in docs]


@api_router.post("/vehicles", response_model=Vehicle)
async def add_vehicle(inp: VehicleInput, user=Depends(get_current_user)):
    count = await db.vehicles.count_documents({"user_id": user["_id"]})
    v = Vehicle(**inp.dict(), is_active=(count == 0))
    doc = v.dict()
    doc["user_id"] = user["_id"]
    await db.vehicles.insert_one(doc)
    return v


@api_router.post("/vehicles/{vehicle_id}/activate")
async def activate_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    await db.vehicles.update_many({"user_id": user["_id"]}, {"$set": {"is_active": False}})
    res = await db.vehicles.update_one(
        {"id": vehicle_id, "user_id": user["_id"]}, {"$set": {"is_active": True}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"ok": True}


@api_router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str, user=Depends(get_current_user)):
    await db.vehicles.delete_one({"id": vehicle_id, "user_id": user["_id"]})
    await db.vehicle_history.delete_many({"vehicle_id": vehicle_id, "user_id": user["_id"]})
    return {"ok": True}


# ----------------------------- Routes: Vehicle Intelligence / Profile -------
class VinUpsertInput(BaseModel):
    vin: str
    nickname: Optional[str] = ""
    mileage: Optional[int] = None
    spec: dict = {}


class VehiclePatchInput(BaseModel):
    name: Optional[str] = None
    mileage: Optional[int] = None


class HistoryEntryInput(BaseModel):
    title: str
    detail: Optional[str] = ""
    meta: dict = {}


class HealthSampleInput(BaseModel):
    score: int


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in ("user_id", "_id")}


@api_router.post("/vehicles/upsert-by-vin")
async def upsert_by_vin(inp: VinUpsertInput, user=Depends(get_current_user)):
    vin = (inp.vin or "").strip().upper()
    if not vin:
        raise HTTPException(status_code=400, detail="VIN required")
    spec = inp.spec or {}
    existing = await db.vehicles.find_one({"user_id": user["_id"], "vin": vin})
    fields = {
        "make": spec.get("make", ""),
        "model": spec.get("model", ""),
        "year": spec.get("year", 0),
        "trim": spec.get("trim", ""),
        "engine": spec.get("engine", ""),
        "transmission": spec.get("transmission", ""),
        "drivetrain": spec.get("drivetrain", spec.get("driveType", "")),
        "bodyStyle": spec.get("bodyStyle", ""),
        "manufacturer": spec.get("manufacturer", ""),
        "plant": spec.get("plant", ""),
        "decode_confidence": spec.get("confidence", 0),
        "decode_source": spec.get("source", spec.get("decodeSource", "")),
        "last_scan_at": now_iso(),
    }
    if inp.mileage is not None:
        fields["mileage"] = inp.mileage
    if existing:
        if inp.nickname:
            fields["name"] = inp.nickname
        await db.vehicles.update_one({"_id": existing["_id"]}, {"$set": fields})
        doc = await db.vehicles.find_one({"_id": existing["_id"]})
        return {"created": False, **_clean(doc)}
    count = await db.vehicles.count_documents({"user_id": user["_id"]})
    doc = {
        "_id": str(uuid.uuid4()),
        "id": str(uuid.uuid4()),
        "user_id": user["_id"],
        "vin": vin,
        "name": inp.nickname or f"{fields['year']} {fields['make']} {fields['model']}".strip(),
        "mileage": inp.mileage,
        "is_active": count == 0,
        "health_history": [],
        "created_at": now_iso(),
        **fields,
    }
    await db.vehicles.insert_one(doc)
    return {"created": True, **_clean(doc)}


@api_router.patch("/vehicles/{vehicle_id}")
async def patch_vehicle(vehicle_id: str, inp: VehiclePatchInput, user=Depends(get_current_user)):
    updates = {k: v for k, v in inp.dict().items() if v is not None}
    if not updates:
        return {"ok": True}
    res = await db.vehicles.update_one({"id": vehicle_id, "user_id": user["_id"]}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"ok": True}


@api_router.get("/vehicles/{vehicle_id}")
async def get_vehicle_profile(vehicle_id: str, user=Depends(get_current_user)):
    doc = await db.vehicles.find_one({"id": vehicle_id, "user_id": user["_id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    hist = await db.vehicle_history.find({"vehicle_id": vehicle_id, "user_id": user["_id"]}).sort("ts", -1).to_list(300)
    by_kind = {"maintenance": [], "parts": [], "dtc": []}
    for h in hist:
        by_kind.setdefault(h.get("kind", "other"), []).append(_clean(h))
    vin = doc.get("vin", "")
    or_clauses: list = [{"vehicle_id": vehicle_id}]
    if vin:
        or_clauses.append({"vehicle": {"$regex": vin}})
    reports = await db.reports.find(
        {"user_id": user["_id"], "$or": or_clauses}
    ).sort("created_at", -1).to_list(100)
    rep_out = []
    for r in reports:
        rc = _clean(r)
        rc["id"] = r["_id"]
        rep_out.append(rc)
    return {**_clean(doc), "history": by_kind, "reports": rep_out}


@api_router.post("/vehicles/{vehicle_id}/history/{kind}")
async def add_history(vehicle_id: str, kind: str, inp: HistoryEntryInput, user=Depends(get_current_user)):
    if kind not in ("maintenance", "parts", "dtc"):
        raise HTTPException(status_code=400, detail="Invalid history kind")
    entry = {
        "_id": str(uuid.uuid4()),
        "id": str(uuid.uuid4()),
        "user_id": user["_id"],
        "vehicle_id": vehicle_id,
        "kind": kind,
        "title": inp.title,
        "detail": inp.detail,
        "meta": inp.meta,
        "ts": now_iso(),
    }
    await db.vehicle_history.insert_one(entry)
    return _clean(entry)


@api_router.post("/vehicles/{vehicle_id}/health")
async def add_health_sample(vehicle_id: str, inp: HealthSampleInput, user=Depends(get_current_user)):
    sample = {"ts": now_iso(), "score": inp.score}
    res = await db.vehicles.update_one(
        {"id": vehicle_id, "user_id": user["_id"]},
        {"$push": {"health_history": {"$each": [sample], "$slice": -60}}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return {"ok": True}


# ----------------------------- Routes: AI Chat ------------------------------
JARVIS_SYSTEM = (
    "You are JARVIS, an elite AI automotive diagnostic assistant for mechanics and "
    "enthusiasts. You combine live OBD-II sensor data with deep automotive knowledge. "
    "Give confident, technically precise diagnostics. When relevant, reference the live "
    "sensor values provided. Structure answers with: a short direct assessment, likely "
    "causes (ranked), and concrete guided testing / repair steps. Be concise, use short "
    "paragraphs and bullet steps. Do not use markdown headers larger than bold."
)


@api_router.post("/chat")
async def chat(inp: ChatInput, user=Depends(get_current_user)):
    context = ""
    if inp.vehicle:
        context += f"\nActive vehicle: {inp.vehicle}"
    if inp.telemetry:
        context += f"\nLive sensor snapshot (OBD-II): {inp.telemetry}"

    chat_client = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"{user['_id']}_{inp.session_id}",
        system_message=JARVIS_SYSTEM + context,
    ).with_model("openai", "gpt-5.4")

    # persist user message
    await db.messages.insert_one({
        "_id": str(uuid.uuid4()),
        "user_id": user["_id"],
        "session_id": inp.session_id,
        "role": "user",
        "content": inp.message,
        "created_at": now_iso(),
    })

    try:
        reply = await chat_client.send_message(UserMessage(text=inp.message))
    except Exception as e:
        logger.error(f"chat error: {e}")
        raise HTTPException(status_code=500, detail="AI assistant unavailable")

    reply_text = reply if isinstance(reply, str) else str(reply)
    await db.messages.insert_one({
        "_id": str(uuid.uuid4()),
        "user_id": user["_id"],
        "session_id": inp.session_id,
        "role": "assistant",
        "content": reply_text,
        "created_at": now_iso(),
    })
    return {"reply": reply_text}


@api_router.get("/chat/history/{session_id}")
async def chat_history(session_id: str, user=Depends(get_current_user)):
    docs = await db.messages.find(
        {"user_id": user["_id"], "session_id": session_id}
    ).sort("created_at", 1).to_list(200)
    return [{"role": d["role"], "content": d["content"], "created_at": d["created_at"]} for d in docs]


# ----------------------------- Routes: Voice --------------------------------
@api_router.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(get_current_user)):
    suffix = os.path.splitext(file.filename or "audio.m4a")[1] or ".m4a"
    data = await file.read()
    tmp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}{suffix}")
    with open(tmp_path, "wb") as f:
        f.write(data)
    try:
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        with open(tmp_path, "rb") as audio_file:
            result = await stt.transcribe(file=audio_file, response_format="json")
        text = getattr(result, "text", None) or (result.get("text") if isinstance(result, dict) else str(result))
    except Exception as e:
        logger.error(f"stt error: {e}")
        raise HTTPException(status_code=500, detail="Transcription failed")
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
    return {"text": text}


@api_router.post("/voice/speak")
async def speak(inp: TTSInput, user=Depends(get_current_user)):
    try:
        tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
        text = inp.text[:4000]
        b64 = await tts.generate_speech_base64(text=text, voice=inp.voice or "onyx", model="tts-1")
    except Exception as e:
        logger.error(f"tts error: {e}")
        raise HTTPException(status_code=500, detail="Speech generation failed")
    return {"audio": b64, "mime": "audio/mp3"}


# ----------------------------- Routes: DTC Intelligence ---------------------
class DtcAnalyzeInput(BaseModel):
    code: str
    desc: Optional[str] = ""
    telemetry: Optional[dict] = None
    vehicle: Optional[Any] = None


@api_router.post("/dtc/analyze")
async def dtc_analyze(inp: DtcAnalyzeInput, user=Depends(get_current_user)):
    prompt = (
        f"Analyze diagnostic trouble code {inp.code} ({inp.desc}). "
        f"Vehicle: {inp.vehicle}. Live sensor snapshot: {inp.telemetry}. "
        "Respond in these clearly labeled sections using plain text with bold labels: "
        "Meaning; Common Causes (bulleted); Most Likely Cause (based on the live data, 1 line); "
        "Diagnostic Confidence (a % and one-line rationale); Recommended Tests (numbered); "
        "Required Tools; Estimated Repair Time; Difficulty (1-5); Estimated Cost (USD range); "
        "Commonly Replaced Parts. Never recommend replacing parts without diagnostic evidence. Be concise."
    )
    chat_client = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"{user['_id']}_dtc_{inp.code}",
        system_message=JARVIS_SYSTEM,
    ).with_model("openai", "gpt-5.4")
    try:
        reply = await chat_client.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"dtc analyze error: {e}")
        raise HTTPException(status_code=500, detail="Analysis unavailable")
    return {"code": inp.code, "analysis": reply if isinstance(reply, str) else str(reply)}


# ----------------------------- Routes: VIN Decode ---------------------------
_WMI = {
    "1C4": ("Jeep", "USA"), "1C6": ("Ram", "USA"), "1C3": ("Chrysler", "USA"),
    "3C4": ("Jeep", "Mexico"), "2C3": ("Chrysler", "Canada"),
    "1FA": ("Ford", "USA"), "1FT": ("Ford", "USA"), "1FM": ("Ford", "USA"), "1FD": ("Ford", "USA"),
    "1G1": ("Chevrolet", "USA"), "1GC": ("Chevrolet", "USA"), "1GT": ("GMC", "USA"), "1GK": ("GMC", "USA"),
    "1HG": ("Honda", "USA"), "2HG": ("Honda", "Canada"), "JHM": ("Honda", "Japan"), "19X": ("Honda", "USA"),
    "4T1": ("Toyota", "USA"), "5TD": ("Toyota", "USA"), "JTD": ("Toyota", "Japan"), "JTE": ("Toyota", "Japan"),
    "WBA": ("BMW", "Germany"), "WBS": ("BMW", "Germany"), "WBY": ("BMW", "Germany"),
    "WDB": ("Mercedes-Benz", "Germany"), "WDD": ("Mercedes-Benz", "Germany"), "4JG": ("Mercedes-Benz", "USA"),
    "WVW": ("Volkswagen", "Germany"), "1VW": ("Volkswagen", "USA"), "3VW": ("Volkswagen", "Mexico"),
    "WAU": ("Audi", "Germany"), "TRU": ("Audi", "Hungary"),
    "5YJ": ("Tesla", "USA"), "7SA": ("Tesla", "USA"),
    "1N4": ("Nissan", "USA"), "JN1": ("Nissan", "Japan"), "3N1": ("Nissan", "Mexico"),
    "KM8": ("Hyundai", "S. Korea"), "5NP": ("Hyundai", "USA"),
    "KNA": ("Kia", "S. Korea"), "KND": ("Kia", "S. Korea"),
    "1GN": ("Chevrolet", "USA"), "2T3": ("Toyota", "Canada"), "SAL": ("Land Rover", "UK"),
    "WP0": ("Porsche", "Germany"), "ZFF": ("Ferrari", "Italy"),
}
_YEAR = {c: y for c, y in zip("ABCDEFGHJKLMNPRSTVWXY123456789", list(range(2010, 2031)) + list(range(2031, 2040)))}
_TRANSLIT = {
    "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8,
    "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "P": 7, "R": 9,
    "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9,
}
_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]


class VinInput(BaseModel):
    vin: str


def _vin_checksum_valid(vin: str) -> bool:
    if len(vin) != 17:
        return False
    try:
        total = sum(_TRANSLIT.get(vin[i], 0) * _WEIGHTS[i] for i in range(17))
    except Exception:
        return False
    check = total % 11
    expected = "X" if check == 10 else str(check)
    return vin[8] == expected


def _local_decode(vin: str) -> dict:
    vin = vin.upper()
    wmi = vin[:3]
    make, country = _WMI.get(wmi, _WMI.get(vin[:2] + "_", ("Unknown", "Unknown")))
    year = _YEAR.get(vin[9], 0) if len(vin) >= 10 else 0
    plant = vin[10] if len(vin) >= 11 else ""
    return {
        "make": make, "country": country, "year": year,
        "plant": f"Plant code {plant}" if plant else "",
        "model": "", "trim": "", "engine": "", "transmission": "", "drivetrain": "",
    }


def _nhtsa_decode(vin: str) -> Optional[dict]:
    try:
        import requests
        r = requests.get(
            f"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json",
            timeout=5,
        )
        res = r.json()["Results"][0]
        if not res.get("Make"):
            return None
        disp = res.get("DisplacementL")
        cyl = res.get("EngineCylinders")
        engine = " ".join(filter(None, [f"{disp}L" if disp else "", f"{cyl}-cyl" if cyl else "", res.get("EngineModel") or ""])).strip()
        return {
            "make": res.get("Make") or "", "model": res.get("Model") or "",
            "year": int(res["ModelYear"]) if res.get("ModelYear", "").isdigit() else 0,
            "trim": res.get("Trim") or res.get("Series") or "",
            "engine": engine, "transmission": res.get("TransmissionStyle") or "",
            "drivetrain": res.get("DriveType") or "", "plant": res.get("PlantCity") or "",
            "country": res.get("PlantCountry") or "", "ecu": res.get("VehicleType") or "",
            "bodyStyle": res.get("BodyClass") or "", "manufacturer": res.get("Manufacturer") or "",
        }
    except Exception as e:
        logger.warning(f"nhtsa decode failed: {e}")
        return None


@api_router.post("/vin/decode")
async def vin_decode(inp: VinInput, user=Depends(get_current_user)):
    vin = (inp.vin or "").strip().upper()
    valid_format = len(vin) == 17 and all(c not in "IOQ" for c in vin)
    checksum_ok = _vin_checksum_valid(vin) if valid_format else False

    source = "local"
    confidence = 0.0
    data = _local_decode(vin) if valid_format else {}
    nh = _nhtsa_decode(vin) if valid_format else None
    if nh:
        source = "nhtsa"
        data = {**data, **{k: v for k, v in nh.items() if v}}
        confidence = 0.95 if (nh.get("make") and nh.get("model")) else 0.8
    elif valid_format and data.get("make") not in (None, "", "Unknown"):
        confidence = 0.6 if checksum_ok else 0.45
    elif valid_format:
        confidence = 0.3

    return {
        "vin": vin,
        "validFormat": valid_format,
        "checksumValid": checksum_ok,
        "source": source,
        "confidence": round(confidence, 2),
        **data,
    }


# ----------------------------- Routes: Scan Reports -------------------------
class ReportInput(BaseModel):
    vehicle: Any = ""
    vehicle_id: Optional[str] = None
    dtcs: List[dict] = []
    signals_summary: dict = {}
    health_score: Optional[int] = None
    customer_name: Optional[str] = ""
    mileage: Optional[int] = None
    notes: Optional[str] = ""


@api_router.post("/reports")
async def create_report(inp: ReportInput, user=Depends(get_current_user)):
    findings = ""
    try:
        chat_client = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"{user['_id']}_report_{uuid.uuid4()}",
            system_message=JARVIS_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        prompt = (
            f"Write a concise professional scan-report summary for a {inp.vehicle}. "
            f"Active codes: {inp.dtcs}. Live sensor summary: {inp.signals_summary}. "
            f"Overall health score: {inp.health_score}. Provide: AI Findings (2-4 bullets), "
            "Recommended Next Steps (numbered), and Suggested Maintenance. Keep it tight."
        )
        findings = await chat_client.send_message(UserMessage(text=prompt))
        findings = findings if isinstance(findings, str) else str(findings)
    except Exception as e:
        logger.error(f"report ai error: {e}")
        findings = "AI summary unavailable. Review codes and sensor data below."

    rid = str(uuid.uuid4())
    doc = {
        "_id": rid,
        "user_id": user["_id"],
        "vehicle": inp.vehicle,
        "vehicle_id": inp.vehicle_id,
        "dtcs": inp.dtcs,
        "signals_summary": inp.signals_summary,
        "health_score": inp.health_score,
        "customer_name": inp.customer_name,
        "mileage": inp.mileage,
        "notes": inp.notes,
        "ai_findings": findings,
        "created_at": now_iso(),
    }
    await db.reports.insert_one(doc)
    doc.pop("user_id", None)
    doc["id"] = doc.pop("_id")
    return doc


@api_router.get("/reports")
async def list_reports(user=Depends(get_current_user)):
    docs = await db.reports.find({"user_id": user["_id"]}).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        d.pop("user_id", None)
        d["id"] = d.pop("_id")
        out.append(d)
    return out


@api_router.get("/reports/{report_id}")
async def get_report(report_id: str, user=Depends(get_current_user)):
    d = await db.reports.find_one({"_id": report_id, "user_id": user["_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Report not found")
    d.pop("user_id", None)
    d["id"] = d.pop("_id")
    return d


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
