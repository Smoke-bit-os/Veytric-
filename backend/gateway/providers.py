"""VEYTRIC — Prompt 3 AI provider registry + capability router (Phase 3B).

Mirrors the Prompt-1 Provider Registry / Capability Router pattern, but for AI
providers. The backend can only EXECUTE the CLOUD provider (VEYTRIC-managed
key). BYOK and LOCAL execute on the user's device and are metered via the
gateway's record path — they are NEVER silently executed against VEYTRIC Cloud.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional, List, Dict

from .contracts import GatewayError, GatewayFailure, GatewayErrorCode
from .pricing import estimate_tokens


@dataclass
class AIProviderResult:
    text: str
    model: str
    provider_request_id: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0


class BaseAIProvider:
    mode: str = "CLOUD"
    capabilities: List[str] = field(default_factory=list)

    def supports(self, capability: str) -> bool:
        return capability in self.capabilities

    async def generate(self, *, system: str, prompt: str,
                       max_output_tokens: int, timeout_ms: int) -> AIProviderResult:
        raise NotImplementedError


class CloudAIProvider(BaseAIProvider):
    """Wraps the Emergent-managed LlmChat (gpt-5.4). Token counts are estimated
    (the SDK does not return exact usage)."""

    mode = "CLOUD"
    capabilities = ["ai.explain", "ai.summarize", "ai.compare", "ai.reason",
                    "ai.narrate", "ai.validate", "ai.chat"]

    def __init__(self, llm_chat_factory, user_message_cls, api_key: str,
                 model: str = "gpt-5.4"):
        self._factory = llm_chat_factory
        self._UserMessage = user_message_cls
        self._api_key = api_key
        self._model = model

    async def generate(self, *, system, prompt, max_output_tokens, timeout_ms):
        import asyncio
        import uuid as _uuid
        client = self._factory(
            api_key=self._api_key,
            session_id=f"gw_{_uuid.uuid4()}",
            system_message=system,
        ).with_model("openai", self._model)
        try:
            reply = await asyncio.wait_for(
                client.send_message(self._UserMessage(text=prompt)),
                timeout=max(1.0, timeout_ms / 1000.0))
        except asyncio.TimeoutError:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.TIMEOUT,
                "The AI provider took too long to respond. Please try again.",
                provider_spend_occurred=True))
        text = reply if isinstance(reply, str) else str(reply)
        return AIProviderResult(
            text=text, model=self._model, provider_request_id=None,
            input_tokens=estimate_tokens(system) + estimate_tokens(prompt),
            output_tokens=estimate_tokens(text))


class MockAIProvider(BaseAIProvider):
    """Deterministic provider for automated tests. NEVER spends real credits."""

    mode = "CLOUD"
    capabilities = CloudAIProvider.capabilities

    def __init__(self, mode_flag: str = "ok"):
        self._flag = mode_flag

    async def generate(self, *, system, prompt, max_output_tokens, timeout_ms):
        if self._flag == "malformed":
            body = "not-a-json {broken"
        else:
            body = json.dumps({
                "user_explanation": "Mock explanation grounded in the supplied evidence.",
                "supported_findings": ["DTC P0300 present in the evidence."],
                "hypotheses": [{"statement": "Possible ignition misfire.",
                                "confidence": "PLAUSIBLE",
                                "supporting_evidence_ids": ["dtc_P0300"]}],
                "uncertainties": ["Fuel-trim data not supplied."],
                "missing_evidence": ["Long-term fuel trim"],
                "contradictions": [],
                "recommended_next_evidence": ["Capture LTFT/STFT"],
                "safety_notices": [],
                "overall_confidence": "PLAUSIBLE",
            })
        return AIProviderResult(
            text=body, model="mock-gpt", provider_request_id="mock-req",
            input_tokens=estimate_tokens(system) + estimate_tokens(prompt),
            output_tokens=estimate_tokens(body))


class AIProviderRegistry:
    """Discovery + capability routing + provider-disable for AI providers."""

    def __init__(self):
        self._providers: Dict[str, BaseAIProvider] = {}
        self._disabled: set = set()

    def register(self, provider: BaseAIProvider) -> None:
        self._providers[provider.mode] = provider

    def disable(self, mode: str) -> None:
        self._disabled.add(mode)

    def enable(self, mode: str) -> None:
        self._disabled.discard(mode)

    def is_disabled(self, mode: str) -> bool:
        return mode in self._disabled

    def resolve(self, mode: str, capability: str) -> BaseAIProvider:
        if mode in self._disabled:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.PROVIDER_DISABLED,
                "This AI provider is temporarily unavailable. Core diagnostics still work."))
        provider = self._providers.get(mode)
        if provider is None:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.PROVIDER_NOT_CONFIGURED,
                "The selected AI provider is not configured on the server."))
        if not provider.supports(capability):
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.UNSUPPORTED_CAPABILITY,
                "The selected AI provider cannot perform this type of request."))
        return provider


_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


def parse_structured(text: str) -> Optional[dict]:
    """Extract a JSON object from provider text. Returns None if unparseable."""
    if not text:
        return None
    candidate = text.strip()
    try:
        return json.loads(candidate)
    except Exception:
        pass
    m = _JSON_BLOCK.search(candidate)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None
