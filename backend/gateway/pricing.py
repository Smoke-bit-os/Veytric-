"""VEYTRIC — Prompt 3 pricing & token estimation (Phase 3C).

Cost is expressed in integer micros (1e-6 USD) to avoid float drift in the
ledger. BYOK and LOCAL always attribute ZERO VEYTRIC cost (the user pays their
provider / runs locally) — only their classification is recorded.
"""
from __future__ import annotations

from typing import Tuple

# Approximate blended rate per 1K tokens, in micros USD. Server-authoritative.
# (Deterministic estimates — providers do not always return exact usage.)
MODEL_RATES_MICROS_PER_1K = {
    "gpt-5.4": {"input": 2500, "output": 10000},
    "gpt-5.4-mini": {"input": 300, "output": 1200},
    "default": {"input": 2500, "output": 10000},
}


def estimate_tokens(text: str) -> int:
    """Char/4 heuristic, min 1 for non-empty."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


def cloud_cost_micros(model: str, input_tokens: int, output_tokens: int) -> int:
    rate = MODEL_RATES_MICROS_PER_1K.get(model, MODEL_RATES_MICROS_PER_1K["default"])
    cost = (input_tokens * rate["input"] + output_tokens * rate["output"]) / 1000.0
    return int(round(cost))


def split_cost(provider_mode: str, model: str, input_tokens: int, output_tokens: int) -> Tuple[int, int]:
    """Return (veytric_cost_micros, provider_cost_micros).

    CLOUD -> VEYTRIC bears the cost (also the amount attributable to customer
    credits in Prompt 4). BYOK/LOCAL -> VEYTRIC bears nothing.
    """
    est = cloud_cost_micros(model, input_tokens, output_tokens)
    if provider_mode == "CLOUD":
        return est, est
    if provider_mode == "BYOK":
        return 0, est  # user pays their OpenAI account; we only classify
    return 0, 0        # LOCAL: free
