import os
import re
import math
import time
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
    vehicle: Optional[Any] = None


class TTSInput(BaseModel):
    text: str
    voice: Optional[str] = "onyx"


# ----------------------------- Auth helpers ---------------------------------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def make_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=7)}
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
    return {"id": u["_id"], "name": u["name"], "email": u["email"], "entitlement": compute_entitlement(u)}


# ----------------------------- Licensing / Subscription ---------------------
# Backend is the source of truth for tier/status/trial. The client caches the
# computed entitlement (encrypted) for offline-first behaviour but never makes
# authoritative decisions on its own. Real billing (App Store / Google Play /
# RevenueCat) plugs into /subscription/validate + /restore later.
TRIAL_DAYS = 30
GRACE_DAYS = 3
APP_ENV = os.environ.get("APP_ENV", "production")


def _parse_dt(dt):
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt)
    except Exception:
        return None


def compute_entitlement(u: dict) -> dict:
    now = datetime.now(timezone.utc)
    tier = u.get("tier", "free")
    status = u.get("subscription_status", "none")
    trial_end = _parse_dt(u.get("trial_end"))
    sub_end = _parse_dt(u.get("subscription_end"))
    grace_end = _parse_dt(u.get("grace_period_end"))
    trial_used = bool(u.get("trial_used", False))

    eff_tier, eff_status, trial_days, in_grace = "free", "none", 0, False

    if status == "trial":
        if trial_end and trial_end > now:
            eff_tier, eff_status = "pro", "trial"
            trial_days = max(0, math.ceil((trial_end - now).total_seconds() / 86400))
        else:
            eff_tier, eff_status = "free", "expired"
    elif status in ("active", "grace"):
        if sub_end and sub_end <= now:
            if grace_end and grace_end > now:
                eff_tier, eff_status, in_grace = tier, "grace", True
            else:
                eff_tier, eff_status = "free", "expired"
        else:
            eff_tier, eff_status = tier, "active"

    return {
        "tier": eff_tier,
        "storedTier": tier,
        "status": eff_status,
        "trialUsed": trial_used,
        "trialDaysRemaining": trial_days,
        "trialEnd": u.get("trial_end"),
        "inGrace": in_grace,
        "gracePeriodEnd": u.get("grace_period_end"),
        "subscriptionEnd": u.get("subscription_end"),
        "autoRenew": bool(u.get("auto_renew", False)),
        "provider": u.get("provider", ""),
        "lastValidation": u.get("last_validation"),
    }


# ----------------------------- Abuse protection helpers ---------------------
# In-memory per-process throttles (best-effort). Server-side entitlement +
# monthly usage counters in Mongo are the authoritative controls.
AI_FREE_MONTHLY_LIMIT = int(os.environ.get("AI_FREE_MONTHLY_LIMIT", "20"))
AI_TIER_LIMITS = {"free": AI_FREE_MONTHLY_LIMIT, "pro": None, "shop": None}  # None = unlimited
MAX_PROMPT_CHARS = 12000
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 20
LOGIN_WINDOW = 300
LOGIN_MAX = 10

_rate_buckets: dict = {}
_login_buckets: dict = {}


def _throttle(store: dict, key: str, max_n: int, window: int, msg: str):
    now = time.time()
    arr = [t for t in store.get(key, []) if now - t < window]
    if len(arr) >= max_n:
        raise HTTPException(status_code=429, detail=msg)
    arr.append(now)
    store[key] = arr


def _month_key() -> str:
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def validate_prompt_size(*texts: Optional[str]):
    total = sum(len(t or "") for t in texts)
    if total > MAX_PROMPT_CHARS:
        raise HTTPException(status_code=413, detail=f"Request too large ({total} characters). Maximum is {MAX_PROMPT_CHARS} characters.")


async def enforce_cloud_quota(user: dict) -> dict:
    """Rate-limit + monthly Cloud-AI quota. Only requests that use the
    JARVIS-managed key call this — BYOK/Local go device->provider directly and
    never consume quota. Server-computed entitlement is the ONLY source of
    truth (client-provided tier/quota is never trusted)."""
    _throttle(_rate_buckets, user["_id"], RATE_LIMIT_MAX, RATE_LIMIT_WINDOW,
              "Too many requests. Please slow down and try again shortly.")
    tier = compute_entitlement(user)["tier"]
    limit = AI_TIER_LIMITS.get(tier, AI_FREE_MONTHLY_LIMIT)
    month = _month_key()
    if limit is None:
        await db.ai_usage.update_one(
            {"user_id": user["_id"], "month": month},
            {"$inc": {"requests_used": 1}, "$setOnInsert": {"provider": "cloud"}},
            upsert=True,
        )
        return {"allowed": True, "requests_used": None, "requests_limit": None, "remaining": None, "tier": tier}
    doc = await db.ai_usage.find_one({"user_id": user["_id"], "month": month})
    used = int((doc or {}).get("requests_used", 0))
    if used >= limit:
        raise HTTPException(status_code=429, detail={
            "message": f"You've reached the Free plan limit of {limit} VEYTRIC Cloud AI requests this month. Upgrade to Pro for unlimited AI, or switch to your own OpenAI key (BYOK) or Local AI in Settings → Artificial Intelligence.",
            "code": "cloud_quota_exceeded",
            "requests_used": used, "requests_limit": limit, "remaining": 0,
        })
    await db.ai_usage.update_one(
        {"user_id": user["_id"], "month": month},
        {"$inc": {"requests_used": 1}, "$setOnInsert": {"provider": "cloud"}},
        upsert=True,
    )
    return {"allowed": True, "requests_used": used + 1, "requests_limit": limit, "remaining": max(0, limit - used - 1), "tier": tier}


async def ai_guard(user=Depends(get_current_user)):
    """Dependency for endpoints that spend the JARVIS-managed AI key. Applies
    per-user rate limiting + monthly Cloud quota, then returns the user."""
    await enforce_cloud_quota(user)
    return user


# ----------------------------- Routes: Auth ---------------------------------
@api_router.get("/")
async def root():
    return {"message": "VEYTRIC AI online"}


@api_router.post("/auth/register")
async def register(inp: RegisterInput):
    _throttle(_login_buckets, f"reg:{inp.email.lower()}", LOGIN_MAX, LOGIN_WINDOW,
              "Too many attempts. Please wait a few minutes and try again.")
    if len(inp.password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
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
    _throttle(_login_buckets, f"login:{inp.email.lower()}", LOGIN_MAX, LOGIN_WINDOW,
              "Too many login attempts. Please wait a few minutes and try again.")
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
    customerName: Optional[str] = None
    customerNotes: Optional[str] = None


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
    # Customer association/notes are a Shop-only management layer — enforced on
    # the backend, not just hidden in the UI.
    if ("customerName" in updates or "customerNotes" in updates) and compute_entitlement(user)["tier"] != "shop":
        raise HTTPException(status_code=403, detail={"message": "Customer management requires a Shop plan", "code": "shop_required"})
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
        or_clauses.append({"vehicle": {"$regex": re.escape(vin)}})
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
    if kind not in ("maintenance", "parts", "dtc", "repair", "note"):
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


# ----------------------------- Routes: Shop Dashboard (Fleet MVP) -----------
# A Shop-tier management/view layer over the EXISTING vehicle records (no
# separate customer collection). Access is enforced server-side, not just in UI.
async def shop_guard(user=Depends(get_current_user)):
    if compute_entitlement(user)["tier"] != "shop":
        raise HTTPException(status_code=403, detail={"message": "Fleet management requires a Shop plan", "code": "shop_required"})
    return user


def _health_status(score) -> str:
    if score is None:
        return "unknown"
    if score >= 80:
        return "healthy"
    if score >= 60:
        return "attention"
    return "critical"


@api_router.get("/shop/fleet")
async def shop_fleet(user=Depends(shop_guard)):
    vehicles = await db.vehicles.find({"user_id": user["_id"]}).sort("created_at", 1).to_list(1000)
    scans = await db.scans.find({"user_id": user["_id"]}, {"modules": 0, "systems": 0}).sort("created_at", -1).to_list(4000)
    reports = await db.reports.find({"user_id": user["_id"]}).sort("created_at", -1).to_list(4000)
    scans_by: dict = {}
    reports_by: dict = {}
    for s in scans:
        scans_by.setdefault(s.get("vehicle_id"), []).append(s)
    for r in reports:
        reports_by.setdefault(r.get("vehicle_id"), []).append(r)

    now = datetime.now(timezone.utc)
    summary = {"total": 0, "healthy": 0, "attention": 0, "critical": 0, "unknown": 0, "totalOpenIssues": 0, "noScanCount": 0, "avgHealth": None}
    score_sum = 0
    score_n = 0
    out = []
    for v in vehicles:
        vid = v.get("id")
        hh = v.get("health_history") or []
        score = hh[-1]["score"] if hh else None
        combined = sorted(scans_by.get(vid, []) + reports_by.get(vid, []),
                          key=lambda x: x.get("created_at") or "", reverse=True)
        last_scan = combined[0].get("created_at") if combined else None
        open_issues = len(combined[0].get("dtcs") or []) if combined else 0
        has_recent = False
        if last_scan:
            try:
                has_recent = (now - datetime.fromisoformat(last_scan)).days <= 90
            except Exception:
                has_recent = False
        status = _health_status(score)
        summary["total"] += 1
        summary[status] += 1
        summary["totalOpenIssues"] += open_issues
        if not has_recent:
            summary["noScanCount"] += 1
        if score is not None:
            score_sum += score
            score_n += 1
        out.append({
            "id": vid,
            "vin": v.get("vin", ""),
            "name": v.get("name", ""),
            "year": v.get("year"),
            "make": v.get("make", ""),
            "model": v.get("model", ""),
            "mileage": v.get("mileage"),
            "customerName": v.get("customerName", ""),
            "customerNotes": v.get("customerNotes", ""),
            "healthScore": score,
            "healthStatus": status,
            "lastScan": last_scan,
            "openIssues": open_issues,
            "hasRecentScan": has_recent,
        })
    summary["avgHealth"] = round(score_sum / score_n) if score_n else None
    return {"summary": summary, "vehicles": out}


# ----------------------------- Routes: AI Chat ------------------------------
JARVIS_SYSTEM = (
    "You are VEYTRIC — AI Vehicle Intelligence, an elite AI automotive diagnostic assistant for mechanics and "
    "enthusiasts. You combine live OBD-II sensor data with deep automotive knowledge. "
    "Give confident, technically precise diagnostics. When relevant, reference the live "
    "sensor values provided. Structure answers with: a short direct assessment, likely "
    "causes (ranked), and concrete guided testing / repair steps. Be concise, use short "
    "paragraphs and bullet steps. Do not use markdown headers larger than bold."
)


@api_router.post("/chat")
async def chat(inp: ChatInput, user=Depends(get_current_user)):
    validate_prompt_size(inp.message)
    await enforce_cloud_quota(user)
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
ALLOWED_AUDIO_EXT = {".m4a", ".mp3", ".wav", ".mp4", ".mpeg", ".mpga", ".webm", ".aac", ".ogg", ".flac", ".aiff"}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB


@api_router.post("/voice/transcribe")
async def transcribe(file: UploadFile = File(...), user=Depends(get_current_user)):
    # Metered against the monthly Cloud quota (managed key spend) + per-user rate limit.
    await enforce_cloud_quota(user)
    suffix = os.path.splitext(file.filename or "audio.m4a")[1].lower() or ".m4a"
    if suffix not in ALLOWED_AUDIO_EXT:
        raise HTTPException(status_code=415, detail="Unsupported audio format")
    ctype = (file.content_type or "").lower()
    if ctype and not (ctype.startswith("audio/") or ctype in ("application/octet-stream", "video/mp4", "video/webm")):
        raise HTTPException(status_code=415, detail="Unsupported audio content type")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 25MB)")
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
    # Metered against the monthly Cloud quota (managed key spend) + per-user rate limit.
    await enforce_cloud_quota(user)
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
async def dtc_analyze(inp: DtcAnalyzeInput, prepare: bool = False, user=Depends(get_current_user)):
    validate_prompt_size(inp.code, inp.desc)
    prompt = (
        f"Analyze diagnostic trouble code {inp.code} ({inp.desc}). "
        f"Vehicle: {inp.vehicle}. Live sensor snapshot: {inp.telemetry}. "
        "Respond in these clearly labeled sections using plain text with bold labels: "
        "Meaning; Common Causes (bulleted); Most Likely Cause (based on the live data, 1 line); "
        "Diagnostic Confidence (a % and one-line rationale); Recommended Tests (numbered); "
        "Required Tools; Estimated Repair Time; Difficulty (1-5); Estimated Cost (USD range); "
        "Commonly Replaced Parts. Never recommend replacing parts without diagnostic evidence. Be concise."
    )
    # BYOK / Local: return the prepared prompt only — no managed-key call, no quota.
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
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


def _vin_reject_reason(vin: str) -> Optional[str]:
    """Return a user-facing rejection reason, or None if the format is acceptable."""
    if not vin:
        return "Enter a VIN to decode."
    if len(vin) != 17:
        return "Invalid VIN. A VIN must be exactly 17 characters."
    bad = [c for c in vin if c in "IOQ"]
    if bad:
        return "Invalid VIN. A VIN cannot contain the letters I, O or Q."
    if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}", vin):
        return "Invalid VIN. Please check the VIN and try again."
    return None


@api_router.post("/vin/decode")
async def vin_decode(inp: VinInput, user=Depends(get_current_user)):
    # Normalise: strip accidental whitespace, upper-case.
    vin = (inp.vin or "").strip().upper()
    reason = _vin_reject_reason(vin)
    if reason:
        # Reject cleanly BEFORE any VPIC lookup — never fabricate a vehicle.
        return {"vin": vin, "validFormat": False, "checksumValid": False,
                "source": "invalid", "confidence": 0.0, "reason": reason}

    checksum_ok = _vin_checksum_valid(vin)

    source = "local"
    confidence = 0.0
    data = _local_decode(vin)
    nh = _nhtsa_decode(vin)
    if nh:
        source = "nhtsa"
        data = {**data, **{k: v for k, v in nh.items() if v}}
        confidence = 0.95 if (nh.get("make") and nh.get("model")) else 0.8
    elif data.get("make") not in (None, "", "Unknown"):
        confidence = 0.6 if checksum_ok else 0.45
    else:
        confidence = 0.3

    return {
        "vin": vin,
        "validFormat": True,
        "checksumValid": checksum_ok,
        "source": source,
        "confidence": round(confidence, 2),
        **data,
    }


# ----------------------------- Vehicle catalog (VPIC-backed) ----------------
# Authoritative make/model lists sourced from NHTSA vPIC for the manual
# "Add Vehicle" dropdowns. We NEVER invent options — if vPIC is unreachable the
# endpoint surfaces an empty list so the UI can show an "unavailable" state.
_catalog_cache: dict = {}  # key -> (expires_epoch, value)
_CATALOG_TTL = 60 * 60 * 24  # 24h


def _catalog_get(key: str):
    hit = _catalog_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    return None


def _catalog_put(key: str, value):
    _catalog_cache[key] = (time.time() + _CATALOG_TTL, value)
    return value


@api_router.get("/vehicles/catalog/makes")
async def catalog_makes():
    # Public NHTSA reference data (non-sensitive) so the manual Add Vehicle
    # dropdowns work for guests too. Server-cached to avoid abuse of vPIC.
    cached = _catalog_get("makes")
    if cached is not None:
        return {"makes": cached, "source": "vpic-cache"}
    try:
        import requests
        r = requests.get(
            "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json",
            timeout=8,
        )
        rows = r.json().get("Results", [])
        makes = sorted({(row.get("MakeName") or "").strip().title()
                        for row in rows if row.get("MakeName")})
        _catalog_put("makes", makes)
        return {"makes": makes, "source": "vpic"}
    except Exception as e:
        logger.warning(f"catalog makes failed: {e}")
        # Never fabricate — signal unavailable to the client.
        return {"makes": [], "source": "unavailable"}


@api_router.get("/vehicles/catalog/models")
async def catalog_models(make: str, year: Optional[int] = None):
    make = (make or "").strip()
    if not make:
        return {"models": [], "source": "unavailable"}
    key = f"models:{make.lower()}:{year or 'any'}"
    cached = _catalog_get(key)
    if cached is not None:
        return {"models": cached, "source": "vpic-cache"}
    try:
        import requests
        from urllib.parse import quote
        mk = quote(make, safe="")
        if year:
            url = f"https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/{mk}/modelyear/{year}?format=json"
        else:
            url = f"https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/{mk}?format=json"
        r = requests.get(url, timeout=8)
        rows = r.json().get("Results", [])
        models = sorted({(row.get("Model_Name") or "").strip()
                         for row in rows if row.get("Model_Name")})
        _catalog_put(key, models)
        return {"models": models, "source": "vpic"}
    except Exception as e:
        logger.warning(f"catalog models failed: {e}")
        return {"models": [], "source": "unavailable"}


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
    # BYOK / Local: when the client already ran the prompt on the user's own
    # engine, it posts the generated findings back here to persist WITHOUT
    # spending the managed cloud key or quota.
    ai_findings: Optional[str] = None
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None


@api_router.post("/reports")
async def create_report(inp: ReportInput, prepare: bool = False, user=Depends(get_current_user)):
    prompt = (
        f"Write a concise professional scan-report summary for a {inp.vehicle}. "
        f"Active codes: {inp.dtcs}. Live sensor summary: {inp.signals_summary}. "
        f"Overall health score: {inp.health_score}. Provide: AI Findings (2-4 bullets), "
        "Recommended Next Steps (numbered), and Suggested Maintenance. Keep it tight."
    )
    # BYOK / Local: return the prepared prompt only — no managed-key call, no quota.
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}

    if inp.ai_findings:
        # Client already generated on the user's own engine — persist as-is.
        findings = inp.ai_findings
        ai_provider = inp.ai_provider or "byok"
        ai_model = inp.ai_model
    else:
        await enforce_cloud_quota(user)
        ai_provider, ai_model = "cloud", None
        try:
            chat_client = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=f"{user['_id']}_report_{uuid.uuid4()}",
                system_message=JARVIS_SYSTEM,
            ).with_model("openai", "gpt-5.4")
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
        "ai_provider": ai_provider,
        "ai_model": ai_model,
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


# ----------------------------- Routes: Performance Recordings ---------------
class RecordingInput(BaseModel):
    vehicle_id: Optional[str] = None
    vin: Optional[str] = ""
    name: str
    notes: Optional[str] = ""
    driver_notes: Optional[str] = ""
    tags: List[str] = []
    duration: float = 0
    distance: float = 0
    health_score: Optional[int] = None
    summary: dict = {}
    events: List[dict] = []
    samples: List[dict] = []


@api_router.post("/recordings")
async def create_recording(inp: RecordingInput, user=Depends(get_current_user)):
    rid = str(uuid.uuid4())
    doc = {"_id": rid, "user_id": user["_id"], "created_at": now_iso(), **inp.dict()}
    await db.recordings.insert_one(doc)
    return {"id": rid, "created_at": doc["created_at"]}


@api_router.get("/recordings")
async def list_recordings(vehicle_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"user_id": user["_id"]}
    if vehicle_id:
        q["vehicle_id"] = vehicle_id
    docs = await db.recordings.find(q, {"samples": 0}).sort("created_at", -1).to_list(200)
    out = []
    for d in docs:
        d.pop("user_id", None)
        d["id"] = d.pop("_id")
        out.append(d)
    return out


@api_router.get("/recordings/{rec_id}")
async def get_recording(rec_id: str, user=Depends(get_current_user)):
    d = await db.recordings.find_one({"_id": rec_id, "user_id": user["_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Recording not found")
    d.pop("user_id", None)
    d["id"] = d.pop("_id")
    return d


@api_router.delete("/recordings/{rec_id}")
async def delete_recording(rec_id: str, user=Depends(get_current_user)):
    await db.recordings.delete_one({"_id": rec_id, "user_id": user["_id"]})
    return {"ok": True}


@api_router.get("/vehicles/{vehicle_id}/performance")
async def vehicle_performance(vehicle_id: str, user=Depends(get_current_user)):
    recs = await db.recordings.find(
        {"user_id": user["_id"], "vehicle_id": vehicle_id}, {"samples": 0}
    ).sort("created_at", -1).to_list(200)
    if not recs:
        return {"count": 0, "recent": [], "trends": {}}

    def num(r, k, d=0):
        return (r.get("summary") or {}).get(k, d)

    recent = [{"id": r["_id"], "name": r.get("name"), "created_at": r.get("created_at"),
               "duration": r.get("duration"), "distance": r.get("distance"),
               "summary": r.get("summary", {}), "health_score": r.get("health_score")} for r in recs[:8]]
    longest = max(recs, key=lambda r: r.get("duration", 0))
    fastest = max(recs, key=lambda r: num(r, "maxSpeed"))
    highest_rpm = max(recs, key=lambda r: num(r, "peakRpm"))
    chrono = list(reversed(recs))
    trends = {
        "battery": [{"t": r.get("created_at"), "v": num(r, "lowestVoltage")} for r in chrono],
        "coolant": [{"t": r.get("created_at"), "v": num(r, "highestCoolant")} for r in chrono],
        "health": [{"t": r.get("created_at"), "v": r.get("health_score") or 0} for r in chrono],
    }
    return {
        "count": len(recs),
        "recent": recent,
        "longest": {"id": longest["_id"], "name": longest.get("name"), "duration": longest.get("duration")},
        "fastest": {"id": fastest["_id"], "name": fastest.get("name"), "maxSpeed": num(fastest, "maxSpeed")},
        "highestRpm": {"id": highest_rpm["_id"], "name": highest_rpm.get("name"), "peakRpm": num(highest_rpm, "peakRpm")},
        "trends": trends,
    }


@api_router.post("/recordings/{rec_id}/analyze")
async def analyze_recording(rec_id: str, prepare: bool = False, user=Depends(get_current_user)):
    rec = await db.recordings.find_one({"_id": rec_id, "user_id": user["_id"]})
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    prev = await db.recordings.find(
        {"user_id": user["_id"], "vehicle_id": rec.get("vehicle_id"), "_id": {"$ne": rec_id}}, {"samples": 0}
    ).sort("created_at", -1).to_list(5)
    prev_summaries = [{"name": p.get("name"), "summary": p.get("summary"), "health": p.get("health_score")} for p in prev]
    prompt = (
        f"Analyze this recorded driving session for vehicle {rec.get('vin') or rec.get('vehicle_id')}. "
        f"Session summary: {rec.get('summary')}. Duration {rec.get('duration')}s, distance {rec.get('distance')}km. "
        f"Detected events: {rec.get('events')}. Previous sessions for comparison: {prev_summaries}. "
        "Provide clearly labeled sections with bold labels: Driving Summary; Performance Analysis; "
        "Charging System Analysis; Cooling System Analysis; Fuel System Analysis; Detected Anomalies; "
        "Trend Analysis (vs previous sessions); Suggested Maintenance. Be concise and technical."
    )
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
    try:
        chat_client = LlmChat(
            api_key=EMERGENT_LLM_KEY, session_id=f"{user['_id']}_rec_{rec_id}", system_message=JARVIS_SYSTEM
        ).with_model("openai", "gpt-5.4")
        analysis = await chat_client.send_message(UserMessage(text=prompt))
        analysis = analysis if isinstance(analysis, str) else str(analysis)
    except Exception as e:
        logger.error(f"recording analyze error: {e}")
        raise HTTPException(status_code=500, detail="Analysis unavailable")
    await db.recordings.update_one({"_id": rec_id}, {"$set": {"ai_analysis": analysis, "ai_provider": "cloud"}})
    return {"analysis": analysis}


class SaveAnalysisInput(BaseModel):
    analysis: str
    provider: Optional[str] = "byok"
    model: Optional[str] = None


@api_router.post("/recordings/{rec_id}/save-analysis")
async def save_recording_analysis(rec_id: str, inp: SaveAnalysisInput, user=Depends(get_current_user)):
    """Persist a BYOK/Local-generated recording analysis. No managed key, no quota."""
    res = await db.recordings.update_one(
        {"_id": rec_id, "user_id": user["_id"]},
        {"$set": {"ai_analysis": inp.analysis, "ai_provider": inp.provider, "ai_model": inp.model}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recording not found")
    return {"analysis": inp.analysis, "provider": inp.provider}


# ============================================================================
#  Vehicle Intelligence & Maintenance Platform
#  Heuristic + offline-first engines (timeline / predictions / trends /
#  dashboard). AI (GPT-5.4) is used ONLY for explanations + health reports.
# ============================================================================

SERVICE_INTERVALS = [
    {"key": "oil", "name": "Engine Oil & Filter", "km": 12000, "kw": ["oil change", "oil", "oil filter"]},
    {"key": "tires", "name": "Tire Rotation", "km": 10000, "kw": ["tire rotation", "tire", "rotation"]},
    {"key": "airfilter", "name": "Air Filter", "km": 25000, "kw": ["air filter", "engine filter", "cabin filter", "filter"]},
    {"key": "brakes", "name": "Brake Pads", "km": 40000, "kw": ["brake", "brake pad", "pads", "rotor"]},
    {"key": "plugs", "name": "Spark Plugs", "km": 50000, "kw": ["spark plug", "plug", "ignition coil"]},
    {"key": "battery", "name": "Battery", "km": 60000, "kw": ["battery"]},
    {"key": "trans", "name": "Transmission Service", "km": 60000, "kw": ["transmission", "trans fluid", "atf", "gearbox"]},
    {"key": "coolant", "name": "Coolant Flush", "km": 80000, "kw": ["coolant", "antifreeze", "radiator flush"]},
    {"key": "belts", "name": "Serpentine / Timing Belt", "km": 90000, "kw": ["belt", "serpentine", "timing belt"]},
    {"key": "alternator", "name": "Alternator Inspection", "km": 120000, "kw": ["alternator", "charging system"]},
]


def _slope(points: list) -> float:
    n = len(points)
    if n < 2:
        return 0.0
    xs = list(range(n))
    mean_x = (n - 1) / 2.0
    mean_y = sum(points) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, points))
    den = sum((x - mean_x) ** 2 for x in xs) or 1.0
    return num / den


async def _gather_vehicle(vehicle_id: str, user_id: str):
    """Pull the vehicle + all linked historical data in one place."""
    veh = await db.vehicles.find_one({"id": vehicle_id, "user_id": user_id})
    if not veh:
        return None
    vin = veh.get("vin", "")
    hist = await db.vehicle_history.find({"vehicle_id": vehicle_id, "user_id": user_id}).sort("ts", -1).to_list(500)
    or_clauses: list = [{"vehicle_id": vehicle_id}]
    if vin:
        or_clauses.append({"vehicle": {"$regex": re.escape(vin)}})
    reports = await db.reports.find({"user_id": user_id, "$or": or_clauses}).sort("created_at", -1).to_list(200)
    rec_q = {"user_id": user_id, "$or": ([{"vehicle_id": vehicle_id}] + ([{"vin": vin}] if vin else []))}
    recordings = await db.recordings.find(rec_q, {"samples": 0}).sort("created_at", -1).to_list(200)
    return {"veh": veh, "history": hist, "reports": reports, "recordings": recordings}


def _last_service_km(history: list, keywords: list, current_mileage: int):
    """Find the most recent maintenance/parts/repair entry matching a service by
    keyword and return the mileage it was performed at (from meta.mileage)."""
    for h in history:
        if h.get("kind") not in ("maintenance", "parts", "repair"):
            continue
        text = f"{h.get('title','')} {h.get('detail','')}".lower()
        if any(k in text for k in keywords):
            m = (h.get("meta") or {}).get("mileage")
            try:
                if m is not None:
                    return int(m)
            except (TypeError, ValueError):
                pass
            return 0  # matched but no mileage recorded -> treat as baseline
    return None


def _compute_predictions(bundle: dict) -> dict:
    veh = bundle["veh"]
    history = bundle["history"]
    reports = bundle["reports"]
    recordings = bundle["recordings"]
    mileage = int(veh.get("mileage") or 0)

    # Signal aggregates from recent recordings (offline heuristic evidence).
    recent_recs = recordings[:8]
    low_volts = [(r.get("summary") or {}).get("lowestVoltage") for r in recent_recs]
    low_volts = [v for v in low_volts if isinstance(v, (int, float)) and v > 0]
    hi_cool = [(r.get("summary") or {}).get("highestCoolant") for r in recent_recs]
    hi_cool = [v for v in hi_cool if isinstance(v, (int, float))]
    min_voltage = min(low_volts) if low_volts else None
    max_coolant = max(hi_cool) if hi_cool else None

    # DTC evidence.
    dtc_codes: list = []
    for r in reports:
        for d in (r.get("dtcs") or []):
            code = d.get("code") if isinstance(d, dict) else str(d)
            if code:
                dtc_codes.append(code)
    for h in history:
        if h.get("kind") == "dtc":
            dtc_codes.append(h.get("title", ""))
    has_misfire = any(str(c).upper().startswith("P03") for c in dtc_codes)

    # Components OBD-II CANNOT directly measure — never fabricate a % / condition.
    DIRECT_INSPECT = {"brakes"}   # pad thickness not on standard OBD-II
    TEST_ONLY = {"battery"}       # needs a physical/load battery test
    has_mileage = mileage > 0

    items = []
    for svc in SERVICE_INTERVALS:
        key = svc["key"]
        interval = svc["km"]
        last_km = _last_service_km(history, svc["kw"], mileage)
        has_record = last_km is not None

        # Real LIVE_ECU / recorded-evidence signals (only when actually present).
        evidence = False
        evidence_pct = 1.0
        evidence_reason = None
        if key == "battery" and min_voltage is not None and min_voltage < 12.2:
            evidence, evidence_pct, evidence_reason = True, 0.15, f"Recorded battery low of {min_voltage:.1f} V"
        elif key == "coolant" and max_coolant is not None and max_coolant > 104:
            evidence, evidence_pct, evidence_reason = True, 0.2, f"Coolant peaked at {int(max_coolant)}°C"
        elif key == "plugs" and has_misfire:
            evidence, evidence_pct, evidence_reason = True, 0.1, "Misfire codes (P03xx) present"
        elif key == "alternator" and min_voltage is not None and min_voltage < 12.0:
            evidence, evidence_pct, evidence_reason = True, 0.25, "Charging voltage instability observed"

        base = {
            "key": key, "name": svc["name"], "intervalKm": interval,
            "lastServiceKm": last_km if has_record else None,
            "kmSince": max(0, mileage - last_km) if (has_record and mileage) else (mileage if has_mileage else 0),
        }

        # 1) Components we cannot measure and have no legitimate basis for.
        if key in DIRECT_INSPECT and not has_record and not evidence:
            items.append({**base, "remainingKm": None, "remainingLifePct": None, "dueMileage": None,
                          "urgency": "inspect", "source": "UNAVAILABLE", "confidence": None,
                          "reasons": ["OBD-II cannot directly measure brake pad thickness — physical inspection required."]})
            continue
        if key in TEST_ONLY and not has_record and not evidence:
            items.append({**base, "remainingKm": None, "remainingLifePct": None, "dueMileage": None,
                          "urgency": "test", "source": "UNAVAILABLE", "confidence": None,
                          "reasons": ["No verified battery-health measurement available — a physical battery test is recommended."]})
            continue
        # 2) No verified mileage AND no service history AND no live evidence → UNKNOWN.
        if not has_record and not has_mileage and not evidence:
            items.append({**base, "remainingKm": None, "remainingLifePct": None, "dueMileage": None,
                          "urgency": "unknown", "source": "UNAVAILABLE", "confidence": None,
                          "reasons": ["Set current mileage or log service history to enable this prediction."]})
            continue

        # 3) We have a legitimate basis → interval / history / live-evidence prediction.
        reasons = []
        if has_record:
            # Real baseline → we can legitimately compute remaining/overdue.
            base_km = last_km
            km_since = max(0, mileage - base_km) if mileage else 0
            remaining_km = interval - km_since
            remaining_pct = max(0.0, min(1.0, remaining_km / interval)) if interval else 0.0
            source, confidence = "USER_SERVICE_HISTORY", 0.85
            reasons.append(f"Based on your service history (last logged at {last_km:,} km)")
            measured_pct = None
            if evidence:
                remaining_pct = min(remaining_pct, evidence_pct)
                measured_pct = round(remaining_pct, 2)
                source, confidence = "LIVE_ECU", min(0.95, confidence + 0.15)
                if evidence_reason:
                    reasons.append(evidence_reason)
            if remaining_km <= 0 or remaining_pct <= 0.02:
                urgency = "overdue"
            elif remaining_pct < 0.15:
                urgency = "soon"
            elif remaining_pct < 0.4:
                urgency = "upcoming"
            else:
                urgency = "ok"
            items.append({**base, "remainingKm": remaining_km if mileage else None,
                          "remainingLifePct": measured_pct,
                          "dueMileage": (base_km + interval) if mileage else None,
                          "urgency": urgency, "source": source, "confidence": round(confidence, 2), "reasons": reasons})
        elif evidence:
            # Real measurement without a logged baseline → report the measurement.
            items.append({**base, "remainingKm": None, "remainingLifePct": round(evidence_pct, 2),
                          "dueMileage": None, "urgency": "soon" if evidence_pct < 0.3 else "upcoming",
                          "source": "LIVE_ECU", "confidence": 0.7,
                          "reasons": [evidence_reason] if evidence_reason else ["Live measurement"]})
        else:
            # We have a general interval but NO baseline → we cannot legitimately
            # compute due/overdue. Show the recommended interval only.
            items.append({**base, "remainingKm": None, "remainingLifePct": None, "dueMileage": None,
                          "urgency": "unknown", "source": "GENERAL_INDUSTRY_INTERVAL", "confidence": 0.4,
                          "reasons": [f"General industry interval is ~{interval:,} km (not vehicle-specific). Log your last service to see when it's due."]})

    order = {"overdue": 0, "soon": 1, "test": 2, "inspect": 3, "upcoming": 4, "ok": 5, "unknown": 6}
    items.sort(key=lambda i: (order.get(i["urgency"], 9), i["remainingLifePct"] if i["remainingLifePct"] is not None else 1.0))
    return {"mileage": mileage if has_mileage else None, "mileageKnown": has_mileage, "items": items}


def _compute_trends(bundle: dict) -> dict:
    veh = bundle["veh"]
    recordings = list(reversed(bundle["recordings"]))  # chronological
    reports = bundle["reports"]
    health_hist = veh.get("health_history") or []

    def series(vals):
        return [round(float(v), 2) for v in vals if isinstance(v, (int, float))]

    battery = series([(r.get("summary") or {}).get("lowestVoltage") for r in recordings])
    coolant = series([(r.get("summary") or {}).get("highestCoolant") for r in recordings])
    maxspeed = series([(r.get("summary") or {}).get("maxSpeed") for r in recordings])
    health = series([h.get("score") for h in health_hist])

    # Repeated DTC pattern frequency.
    freq: dict = {}
    for r in reports:
        for d in (r.get("dtcs") or []):
            code = d.get("code") if isinstance(d, dict) else str(d)
            if code:
                freq[code] = freq.get(code, 0) + 1
    repeated = sorted([{"code": k, "count": v} for k, v in freq.items() if v >= 2], key=lambda x: -x["count"])

    findings = []

    def add(key, label, pts, rising_is_bad, unit, thresh):
        if len(pts) < 3:
            return
        s = _slope(pts)
        direction = "rising" if s > thresh else "declining" if s < -thresh else "stable"
        if direction == "stable":
            sev = "info"
        else:
            bad = (direction == "rising") == rising_is_bad
            sev = "warn" if bad else "good"
        delta = round(pts[-1] - pts[0], 2)
        findings.append({
            "key": key, "label": label, "direction": direction, "severity": sev,
            "slope": round(s, 4), "delta": delta, "unit": unit,
            "first": pts[0], "last": pts[-1],
            "summary": f"{label} {direction} over {len(pts)} sessions ({'+' if delta >= 0 else ''}{delta}{unit}).",
        })

    add("battery", "Battery voltage", battery, rising_is_bad=False, unit=" V", thresh=0.02)
    add("coolant", "Coolant temperature", coolant, rising_is_bad=True, unit="°C", thresh=0.3)
    add("health", "Health score", health, rising_is_bad=False, unit="", thresh=0.4)
    add("maxspeed", "Peak speed", maxspeed, rising_is_bad=False, unit=" km/h", thresh=0.5)
    if repeated:
        top = repeated[0]
        findings.append({
            "key": "dtc", "label": "Repeated DTC pattern", "direction": "recurring",
            "severity": "warn", "slope": 0, "delta": top["count"], "unit": "",
            "summary": f"{top['code']} has recurred {top['count']} times across scans.",
        })

    return {
        "series": {"battery": battery, "coolant": coolant, "health": health, "maxSpeed": maxspeed},
        "repeatedDtcs": repeated,
        "findings": findings,
    }


def _timeline_events(bundle: dict) -> list:
    events = []
    for r in bundle["reports"]:
        events.append({
            "ts": r.get("created_at"), "type": "diagnostics", "group": "diagnostics",
            "title": "Diagnostic Scan", "refId": r["_id"],
            "subtitle": f"{len(r.get('dtcs') or [])} codes · Health {r.get('health_score', '—')}",
            "healthScore": r.get("health_score"), "mileage": r.get("mileage"),
            "hasAi": bool(r.get("ai_findings")), "severity": "warn" if (r.get("dtcs")) else "good",
        })
    for r in bundle["recordings"]:
        sm = r.get("summary") or {}
        events.append({
            "ts": r.get("created_at"), "type": "performance", "group": "performance",
            "title": r.get("name", "Drive Session"), "refId": r["_id"],
            "subtitle": f"{int(r.get('duration') or 0)}s · {r.get('distance', 0)} km · {sm.get('maxSpeed', 0)} km/h peak",
            "healthScore": r.get("health_score"), "hasAi": bool(r.get("ai_analysis")), "severity": "info",
        })
    kind_map = {
        "maintenance": ("maintenance", "wrench"), "parts": ("parts", "cog"),
        "repair": ("repairs", "car-wrench"), "note": ("notes", "note-text"),
        "dtc": ("diagnostics", "alert-circle"),
    }
    for h in bundle["history"]:
        k = h.get("kind", "note")
        group, _ = kind_map.get(k, ("notes", "note-text"))
        meta = h.get("meta") or {}
        events.append({
            "ts": h.get("ts"), "type": k, "group": group, "title": h.get("title", ""),
            "subtitle": h.get("detail", ""), "refId": h.get("id"),
            "mileage": meta.get("mileage"), "cost": meta.get("cost"),
            "severity": "warn" if k == "dtc" else "info",
        })
    events = [e for e in events if e.get("ts")]
    events.sort(key=lambda e: e["ts"], reverse=True)
    return events


@api_router.get("/vehicles/{vehicle_id}/timeline")
async def vehicle_timeline(vehicle_id: str, filter: Optional[str] = None, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    events = _timeline_events(bundle)
    if filter and filter != "all":
        events = [e for e in events if e["group"] == filter]
    counts: dict = {}
    for e in _timeline_events(bundle):
        counts[e["group"]] = counts.get(e["group"], 0) + 1
    return {"vehicle_id": vehicle_id, "count": len(events), "counts": counts, "events": events}


@api_router.get("/vehicles/{vehicle_id}/predictions")
async def vehicle_predictions(vehicle_id: str, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return _compute_predictions(bundle)


@api_router.get("/vehicles/{vehicle_id}/trends")
async def vehicle_trends(vehicle_id: str, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return _compute_trends(bundle)


@api_router.get("/vehicles/{vehicle_id}/dashboard")
async def vehicle_dashboard(vehicle_id: str, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    veh = bundle["veh"]
    preds = _compute_predictions(bundle)
    trends = _compute_trends(bundle)
    health_hist = veh.get("health_history") or []
    last_scan = bundle["reports"][0]["created_at"] if bundle["reports"] else None
    last_rec = bundle["recordings"][0]["created_at"] if bundle["recordings"] else None
    last_maint = None
    for h in bundle["history"]:
        if h.get("kind") in ("maintenance", "repair"):
            last_maint = h.get("ts")
            break
    urgent = [i for i in preds["items"] if i["urgency"] in ("overdue", "soon")]
    next_service = preds["items"][0] if preds["items"] else None
    alerts = []
    for i in urgent[:4]:
        alerts.append({"key": i["key"], "name": i["name"], "urgency": i["urgency"]})
    trend_indicators = [{"key": f["key"], "direction": f["direction"], "severity": f["severity"]}
                        for f in trends["findings"] if f["severity"] != "good"][:4]
    return {
        "vehicle_id": vehicle_id,
        "healthScore": health_hist[-1]["score"] if health_hist else None,
        "mileage": veh.get("mileage"),
        "lastScan": last_scan,
        "lastRecording": last_rec,
        "lastMaintenance": last_maint,
        "nextService": {"name": next_service["name"], "dueMileage": next_service["dueMileage"], "urgency": next_service["urgency"]} if next_service else None,
        "alerts": alerts,
        "trends": trend_indicators,
        "counts": {"scans": len(bundle["reports"]), "recordings": len(bundle["recordings"]), "history": len(bundle["history"])},
    }


@api_router.post("/vehicles/{vehicle_id}/trends/explain")
async def explain_trends(vehicle_id: str, prepare: bool = False, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    trends = _compute_trends(bundle)
    veh = bundle["veh"]
    if not trends["findings"]:
        return {"explanation": "Not enough historical data yet to detect long-term trends. Record more drive sessions and run diagnostic scans to build a trend history."}
    prompt = (
        f"Vehicle: {veh.get('year')} {veh.get('make')} {veh.get('model')} ({veh.get('engine','')}). "
        f"Mileage: {veh.get('mileage')} km. Detected long-term telemetry trends (heuristic): {trends['findings']}. "
        f"Repeated fault codes: {trends['repeatedDtcs']}. "
        "Explain what these trends likely indicate about the vehicle's health, root causes, and what the owner "
        "should monitor or service. Use bold labels per trend. Be concise and technical."
    )
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
    try:
        chat_client = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"{user['_id']}_trends_{vehicle_id}", system_message=JARVIS_SYSTEM).with_model("openai", "gpt-5.4")
        explanation = await chat_client.send_message(UserMessage(text=prompt))
        explanation = explanation if isinstance(explanation, str) else str(explanation)
    except Exception as e:
        logger.error(f"trends explain error: {e}")
        raise HTTPException(status_code=500, detail="Explanation unavailable")
    return {"explanation": explanation}


@api_router.get("/vehicles/{vehicle_id}/health-report")
async def get_health_report(vehicle_id: str, user=Depends(get_current_user)):
    doc = await db.vehicle_reports.find_one({"vehicle_id": vehicle_id, "user_id": user["_id"]}, sort=[("created_at", -1)])
    if not doc:
        return {"report": None}
    return _clean(doc) | {"id": doc["_id"]}


@api_router.post("/vehicles/{vehicle_id}/health-report")
async def create_health_report(vehicle_id: str, prepare: bool = False, user=Depends(get_current_user)):
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    veh = bundle["veh"]
    preds = _compute_predictions(bundle)
    trends = _compute_trends(bundle)
    health_hist = veh.get("health_history") or []
    urgent = [i for i in preds["items"] if i["urgency"] in ("overdue", "soon")]
    recent_repairs = [f"{h.get('title')} ({(h.get('meta') or {}).get('mileage','?')} km)" for h in bundle["history"] if h.get("kind") in ("repair", "maintenance")][:5]
    prompt = (
        f"Generate a comprehensive professional vehicle health report for a "
        f"{veh.get('year')} {veh.get('make')} {veh.get('model')} {veh.get('trim','')} ({veh.get('engine','')}), "
        f"VIN {veh.get('vin','')}, mileage {veh.get('mileage')} km. "
        f"Current health score: {health_hist[-1]['score'] if health_hist else 'N/A'}. "
        f"Priority maintenance concerns (heuristic): {urgent}. "
        f"All predicted maintenance: {preds['items']}. "
        f"Detected long-term trends: {trends['findings']}. Repeated fault codes: {trends['repeatedDtcs']}. "
        f"Recent repairs/maintenance: {recent_repairs}. "
        f"Total scans: {len(bundle['reports'])}, recordings: {len(bundle['recordings'])}. "
        "Produce a report with clearly bold-labeled sections: Current Condition; Recent Repairs & Maintenance; "
        "Performance Changes; Diagnostic History; Predicted Maintenance; Highest-Priority Concerns; "
        "Recommended Next Inspections. Be thorough but concise and technical."
    )
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
    try:
        chat_client = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"{user['_id']}_hr_{vehicle_id}", system_message=JARVIS_SYSTEM).with_model("openai", "gpt-5.4")
        report = await chat_client.send_message(UserMessage(text=prompt))
        report = report if isinstance(report, str) else str(report)
    except Exception as e:
        logger.error(f"health report error: {e}")
        raise HTTPException(status_code=500, detail="Health report unavailable")
    rid = str(uuid.uuid4())
    doc = {
        "_id": rid, "user_id": user["_id"], "vehicle_id": vehicle_id,
        "vehicle": f"{veh.get('year')} {veh.get('make')} {veh.get('model')}",
        "mileage": veh.get("mileage"),
        "health_score": health_hist[-1]["score"] if health_hist else None,
        "report": report, "predictions": preds, "trends": trends,
        "ai_provider": "cloud", "ai_model": None, "created_at": now_iso(),
    }
    await db.vehicle_reports.insert_one(doc)
    return _clean(doc) | {"id": rid}


class SaveHealthReportInput(BaseModel):
    report: str
    provider: Optional[str] = "byok"
    model: Optional[str] = None


@api_router.post("/vehicles/{vehicle_id}/health-report/save")
async def save_health_report(vehicle_id: str, inp: SaveHealthReportInput, user=Depends(get_current_user)):
    """Persist a BYOK/Local-generated health report. Recomputes the heuristic
    predictions/trends server-side (no LLM, no quota) and stores provider metadata."""
    bundle = await _gather_vehicle(vehicle_id, user["_id"])
    if not bundle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    veh = bundle["veh"]
    preds = _compute_predictions(bundle)
    trends = _compute_trends(bundle)
    health_hist = veh.get("health_history") or []
    rid = str(uuid.uuid4())
    doc = {
        "_id": rid, "user_id": user["_id"], "vehicle_id": vehicle_id,
        "vehicle": f"{veh.get('year')} {veh.get('make')} {veh.get('model')}",
        "mileage": veh.get("mileage"),
        "health_score": health_hist[-1]["score"] if health_hist else None,
        "report": inp.report, "predictions": preds, "trends": trends,
        "ai_provider": inp.provider, "ai_model": inp.model, "created_at": now_iso(),
    }
    await db.vehicle_reports.insert_one(doc)
    return _clean(doc) | {"id": rid}




# ============================================================================
#  Advanced Diagnostics & ECU Intelligence
#  AI interpretation (GPT-5.4) + persisted scan workflows. Module/readiness/
#  Mode-06 data is derived client-side from the normalized provider outputs;
#  these endpoints add AI narrative + report persistence only.
# ============================================================================

class InterpretInput(BaseModel):
    kind: str                       # "module" | "system"
    title: str                      # module or system name
    vehicle: Optional[str] = ""
    context: dict = {}              # signals / dtcs / metrics


@api_router.post("/diagnostics/interpret")
async def diagnostics_interpret(inp: InterpretInput, prepare: bool = False, user=Depends(get_current_user)):
    validate_prompt_size(inp.title, inp.vehicle, str(inp.context))
    if inp.kind == "system":
        prompt = (
            f"You are analyzing the {inp.title} system of a {inp.vehicle}. "
            f"Live/aggregated data: {inp.context}. Provide a concise technical interpretation with bold labels: "
            "Assessment; Notable Readings; Likely Concerns; Recommended Checks. 4-8 short lines."
        )
    else:
        prompt = (
            f"Assess the health of the {inp.title} module on a {inp.vehicle}. "
            f"Diagnostic context (fault codes, communication metrics): {inp.context}. "
            "Provide bold-labeled sections: Assessment; Fault Analysis; Communication Reliability; Recommended Action. Be concise and technical."
        )
    # BYOK / Local: return the prepared prompt only — no managed-key call, no quota.
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
    try:
        chat_client = LlmChat(
            api_key=EMERGENT_LLM_KEY, session_id=f"{user['_id']}_interp_{inp.kind}_{inp.title[:12]}",
            system_message=JARVIS_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        text = await chat_client.send_message(UserMessage(text=prompt))
        text = text if isinstance(text, str) else str(text)
    except Exception as e:
        logger.error(f"interpret error: {e}")
        raise HTTPException(status_code=500, detail="Interpretation unavailable")
    return {"interpretation": text}


class ScanInput(BaseModel):
    vehicle_id: Optional[str] = None
    vin: Optional[str] = ""
    vehicle: Optional[str] = ""
    workflow: str                   # full | quick | health | prepurchase | charging | cooling
    modules: List[dict] = []
    dtcs: List[dict] = []
    readiness: List[dict] = []
    systems: List[dict] = []
    metrics: dict = {}
    overall_score: Optional[int] = None


WORKFLOW_TITLES = {
    "full": "Full Vehicle Scan", "quick": "Quick Scan", "health": "Health Check",
    "prepurchase": "Pre-Purchase Inspection", "charging": "Charging System Test",
    "cooling": "Cooling System Evaluation",
}


@api_router.post("/scans")
async def create_scan(inp: ScanInput, user=Depends(get_current_user)):
    """Persist the scan immediately with structured results (no AI wait).
    The AI narrative is generated separately via /scans/{id}/analyze so the UI
    can navigate to the report instantly and fill in the analysis afterward."""
    title = WORKFLOW_TITLES.get(inp.workflow, "Vehicle Scan")
    sid = str(uuid.uuid4())
    doc = {
        "_id": sid, "user_id": user["_id"], "vehicle_id": inp.vehicle_id, "vin": inp.vin,
        "vehicle": inp.vehicle, "workflow": inp.workflow, "title": title,
        "modules": inp.modules, "dtcs": inp.dtcs, "readiness": inp.readiness,
        "systems": inp.systems, "metrics": inp.metrics, "overall_score": inp.overall_score,
        "ai_report": "", "created_at": now_iso(),
    }
    await db.scans.insert_one(doc)
    return _clean(doc) | {"id": sid}


@api_router.post("/scans/{scan_id}/analyze")
async def analyze_scan(scan_id: str, prepare: bool = False, user=Depends(get_current_user)):
    d = await db.scans.find_one({"_id": scan_id, "user_id": user["_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Scan not found")
    if d.get("ai_report") and not prepare:
        return {"ai_report": d["ai_report"]}
    title = d.get("title", "Vehicle Scan")
    prompt = (
        f"Generate a professional {title} report for a {d.get('vehicle')}. "
        f"Detected modules: {d.get('modules')}. Fault codes: {d.get('dtcs')}. Readiness monitors: {d.get('readiness')}. "
        f"System health: {d.get('systems')}. Reliability metrics: {d.get('metrics')}. Overall score: {d.get('overall_score')}. "
        "Structure with bold-labeled sections appropriate to the workflow: Summary; Modules Scanned; "
        "Fault Codes; Readiness; System Health; Concerns; Recommended Actions. Be concise and technical."
    )
    if prepare:
        return {"system": JARVIS_SYSTEM, "prompt": prompt}
    await enforce_cloud_quota(user)
    try:
        chat_client = LlmChat(
            api_key=EMERGENT_LLM_KEY, session_id=f"{user['_id']}_scan_{scan_id}",
            system_message=JARVIS_SYSTEM,
        ).with_model("openai", "gpt-5.4")
        findings = await chat_client.send_message(UserMessage(text=prompt))
        findings = findings if isinstance(findings, str) else str(findings)
    except Exception as e:
        logger.error(f"scan analyze error: {e}")
        raise HTTPException(status_code=500, detail="AI report unavailable")
    await db.scans.update_one({"_id": scan_id}, {"$set": {"ai_report": findings, "ai_provider": "cloud"}})
    return {"ai_report": findings}


class SaveScanAiInput(BaseModel):
    ai_report: str
    provider: Optional[str] = "byok"
    model: Optional[str] = None


@api_router.post("/scans/{scan_id}/save-ai")
async def save_scan_ai(scan_id: str, inp: SaveScanAiInput, user=Depends(get_current_user)):
    """Persist a BYOK/Local-generated scan report. No managed key, no quota."""
    res = await db.scans.update_one(
        {"_id": scan_id, "user_id": user["_id"]},
        {"$set": {"ai_report": inp.ai_report, "ai_provider": inp.provider, "ai_model": inp.model}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Scan not found")
    return {"ai_report": inp.ai_report, "provider": inp.provider}


@api_router.get("/scans")
async def list_scans(vehicle_id: Optional[str] = None, user=Depends(get_current_user)):
    q = {"user_id": user["_id"]}
    if vehicle_id:
        q["vehicle_id"] = vehicle_id
    docs = await db.scans.find(q, {"modules": 0, "systems": 0}).sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        out.append(_clean(d) | {"id": d["_id"]})
    return out


@api_router.get("/scans/{scan_id}")
async def get_scan(scan_id: str, user=Depends(get_current_user)):
    d = await db.scans.find_one({"_id": scan_id, "user_id": user["_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _clean(d) | {"id": d["_id"]}


@api_router.delete("/scans/{scan_id}")
async def delete_scan(scan_id: str, user=Depends(get_current_user)):
    await db.scans.delete_one({"_id": scan_id, "user_id": user["_id"]})
    return {"ok": True}


# ============================================================================
#  AI Analyze (JARVIS Cloud provider backend for the AI Engine)
# ============================================================================
class AIAnalyzeInput(BaseModel):
    prompt: str
    system: Optional[str] = None
    vehicle: Optional[Any] = None
    telemetry: Optional[dict] = None
    diagnostics: Optional[dict] = None
    history: List[dict] = []


@api_router.post("/ai/analyze")
async def ai_analyze(inp: AIAnalyzeInput, user=Depends(get_current_user)):
    validate_prompt_size(inp.prompt, inp.system)
    usage = await enforce_cloud_quota(user)
    context = ""
    if inp.vehicle:
        context += f"\nVehicle: {inp.vehicle}"
    if inp.telemetry:
        context += f"\nLive sensors: {inp.telemetry}"
    if inp.diagnostics:
        context += f"\nDiagnostics: {inp.diagnostics}"
    system = inp.system or JARVIS_SYSTEM
    convo = ""
    for h in (inp.history or [])[-8:]:
        r, c = h.get("role"), h.get("content")
        if r and c:
            convo += f"\n{str(r).upper()}: {c}"
    prompt = inp.prompt if not convo else f"Conversation so far:{convo}\n\nUSER: {inp.prompt}"
    try:
        chat_client = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"{user['_id']}_aigen_{uuid.uuid4()}",
            system_message=system + context,
        ).with_model("openai", "gpt-5.4")
        reply = await chat_client.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.error(f"ai analyze error: {e}")
        raise HTTPException(status_code=500, detail="AI unavailable")
    return {"text": reply if isinstance(reply, str) else str(reply), "model": "gpt-5.4", "usage": usage}


@api_router.get("/ai/usage")
async def ai_usage(user=Depends(get_current_user)):
    tier = compute_entitlement(user)["tier"]
    limit = AI_TIER_LIMITS.get(tier, AI_FREE_MONTHLY_LIMIT)
    doc = await db.ai_usage.find_one({"user_id": user["_id"], "month": _month_key()})
    used = int((doc or {}).get("requests_used", 0))
    return {
        "tier": tier,
        "month": _month_key(),
        "requests_used": used,
        "requests_limit": limit,
        "remaining": None if limit is None else max(0, limit - used),
        "unlimited": limit is None,
    }


# ============================================================================
#  Subscription / Licensing endpoints
# ============================================================================
class DeveloperSetInput(BaseModel):
    action: str  # free | trial | pro | shop | expired | grace | reset_trial | clear


@api_router.get("/subscription")
async def get_subscription(user=Depends(get_current_user)):
    return {
        "entitlement": compute_entitlement(user),
        "trialDays": TRIAL_DAYS,
        "graceDays": GRACE_DAYS,
        "env": APP_ENV,
    }


@api_router.post("/subscription/start-trial")
async def start_trial(user=Depends(get_current_user)):
    if user.get("trial_used"):
        raise HTTPException(status_code=400, detail="Trial already used on this account")
    now = datetime.now(timezone.utc)
    fields = {
        "subscription_status": "trial",
        "trial_start": now.isoformat(),
        "trial_end": (now + timedelta(days=TRIAL_DAYS)).isoformat(),
        "trial_used": True,
        "provider": "trial",
        "last_validation": now.isoformat(),
    }
    await db.users.update_one({"_id": user["_id"]}, {"$set": fields})
    return {"entitlement": compute_entitlement({**user, **fields})}


@api_router.post("/subscription/restore")
async def restore_subscription(user=Depends(get_current_user)):
    # Stub — real App Store / Google Play / RevenueCat restoration plugs in here.
    return {
        "status": "not_configured",
        "message": "Purchase restoration is not configured yet. Connect App Store / Google Play billing to enable.",
        "entitlement": compute_entitlement(user),
    }


@api_router.post("/subscription/validate")
async def validate_subscription(user=Depends(get_current_user)):
    # Stub — server-side receipt validation (Apple/Google/RevenueCat) plugs in here.
    return {
        "status": "not_configured",
        "valid": False,
        "message": "Server-side receipt validation is not configured yet.",
        "entitlement": compute_entitlement(user),
    }


@api_router.post("/subscription/developer/set")
async def developer_set(inp: DeveloperSetInput, user=Depends(get_current_user)):
    # Closed-by-default: only available when development is EXPLICITLY enabled.
    if APP_ENV != "development":
        raise HTTPException(status_code=403, detail="Developer mode is disabled")
    now = datetime.now(timezone.utc)
    a = inp.action
    if a == "free":
        f = {"tier": "free", "subscription_status": "none", "trial_start": None, "trial_end": None,
             "subscription_start": None, "subscription_end": None, "grace_period_end": None,
             "auto_renew": False, "provider": "developer"}
    elif a == "trial":
        f = {"tier": "pro", "subscription_status": "trial", "trial_start": now.isoformat(),
             "trial_end": (now + timedelta(days=TRIAL_DAYS)).isoformat(), "trial_used": True,
             "provider": "developer", "last_validation": now.isoformat()}
    elif a in ("pro", "shop"):
        f = {"tier": a, "subscription_status": "active", "subscription_start": now.isoformat(),
             "subscription_end": (now + timedelta(days=30)).isoformat(), "grace_period_end": None,
             "auto_renew": True, "provider": "developer", "last_validation": now.isoformat()}
    elif a == "expired":
        f = {"tier": "pro", "subscription_status": "active",
             "subscription_start": (now - timedelta(days=31)).isoformat(),
             "subscription_end": (now - timedelta(days=1)).isoformat(),
             "grace_period_end": (now - timedelta(days=1)).isoformat(),
             "auto_renew": False, "provider": "developer"}
    elif a == "grace":
        f = {"tier": "pro", "subscription_status": "active",
             "subscription_start": (now - timedelta(days=31)).isoformat(),
             "subscription_end": (now - timedelta(days=1)).isoformat(),
             "grace_period_end": (now + timedelta(days=GRACE_DAYS)).isoformat(),
             "auto_renew": True, "provider": "developer"}
    elif a == "reset_trial":
        f = {"trial_used": False, "trial_start": None, "trial_end": None}
        if user.get("subscription_status") == "trial":
            f["subscription_status"] = "none"
            f["tier"] = "free"
    elif a == "clear":
        f = {"tier": "free", "subscription_status": "none", "trial_start": None, "trial_end": None,
             "trial_used": False, "subscription_start": None, "subscription_end": None,
             "grace_period_end": None, "auto_renew": False, "provider": "developer"}
    else:
        raise HTTPException(status_code=400, detail="Unknown developer action")
    await db.users.update_one({"_id": user["_id"]}, {"$set": f})
    return {"entitlement": compute_entitlement({**user, **f}), "action": a}


app.include_router(api_router)

# CORS: explicit allowlist in production (set CORS_ORIGINS as a comma-separated
# list). Dev fallback avoids the dangerous wildcard-origin + credentials combo
# (auth is Bearer-token based, so credentials/cookies are not needed).
_cors_origins = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_origins=[o.strip() for o in _cors_origins.split(",") if o.strip()],
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=False,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
