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
@api_router.get("/vehicles", response_model=List[Vehicle])
async def list_vehicles(user=Depends(get_current_user)):
    docs = await db.vehicles.find({"user_id": user["_id"]}).sort("created_at", 1).to_list(100)
    return [Vehicle(**{k: v for k, v in d.items() if k != "user_id" and k != "_id"}) for d in docs]


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
    vehicle: Optional[dict] = None


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


# ----------------------------- Routes: Scan Reports -------------------------
class ReportInput(BaseModel):
    vehicle: dict
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
