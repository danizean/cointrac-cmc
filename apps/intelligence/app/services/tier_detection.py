"""Detect the server CoinMarketCap plan without treating it as market data.

`CMC_QUOTA_PROFILE` always wins. A detected plan fills only the `adaptive` profile.
The raw `/v1/key/info` payload is not stored. Only the plan label and remaining
credits stay in memory, and remaining credits are not returned to API clients.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.core.config import get_settings

DetectedTier = Literal["startup", "basic", "unknown"]
KEY_INFO = "/v1/key/info"
REFRESH_INTERVAL = timedelta(hours=1)


@dataclass(frozen=True)
class TierObservation:
    detected_tier: DetectedTier
    plan_label: str | None
    remaining_credits: int | None
    observed_at: datetime | None


def plan_label_to_tier(label: str | None) -> DetectedTier:
    if not label:
        return "unknown"
    folded = label.strip().lower()
    if "startup" in folded:
        return "startup"
    if folded == "basic" or folded.startswith("basic "):
        return "basic"
    return "unknown"


def _remaining(payload: dict[str, object]) -> int | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    usage = data.get("usage")
    if not isinstance(usage, dict):
        return None
    month = usage.get("current_month")
    if not isinstance(month, dict):
        return None
    left = month.get("credits_left")
    if isinstance(left, bool) or not isinstance(left, (int, float)):
        return None
    if left < 0:
        return None
    return int(left)


def _plan_label(payload: dict[str, object]) -> str | None:
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    plan = data.get("plan")
    if isinstance(plan, dict):
        name = plan.get("name")
        return name.strip() if isinstance(name, str) and name.strip() else None
    if isinstance(plan, str) and plan.strip():
        return plan.strip()
    return None


class TierDetector:
    def __init__(self) -> None:
        self._observation = TierObservation("unknown", None, None, None)
        self._fingerprint: str | None = None
        self._last_attempt: datetime | None = None

    @property
    def observation(self) -> TierObservation:
        return self._observation

    def effective_profile(self) -> str:
        configured = get_settings().cmc_quota_profile
        if configured != "adaptive":
            return configured
        detected = self._observation.detected_tier
        if detected in {"startup", "basic"}:
            return detected
        return "unknown"

    def startup_features_open(self, *, state: str, warning_level: str, ledger_status: str) -> bool:
        return (
            self.effective_profile() == "startup"
            and state == "NORMAL"
            and warning_level == "NONE"
            and ledger_status == "ok"
        )

    async def refresh(self, client: object, *, now: datetime | None = None) -> TierObservation:
        moment = now or datetime.now(UTC)
        fingerprint = _key_fingerprint()
        key_changed = fingerprint != self._fingerprint
        due = self._last_attempt is None or moment - self._last_attempt >= REFRESH_INTERVAL
        if not key_changed and not due:
            return self._observation
        self._last_attempt = moment
        self._fingerprint = fingerprint
        try:
            payload, _meta = await client.fetch(  # type: ignore[attr-defined]
                KEY_INFO,
                {},
                ttl_seconds=1,
                priority="core_warmer",
                cache_status="MISS",
                budget_caller="warmer",
                persist_snapshot=False,
            )
        except Exception:
            self._observation = TierObservation("unknown", None, None, moment)
            return self._observation
        if not isinstance(payload, dict):
            self._observation = TierObservation("unknown", None, None, moment)
            return self._observation
        label = _plan_label(payload)
        self._observation = TierObservation(
            plan_label_to_tier(label),
            label,
            _remaining(payload),
            moment,
        )
        return self._observation


_detector = TierDetector()


def get_tier_detector() -> TierDetector:
    return _detector


def install_tier_detector(detector: TierDetector | None) -> None:
    global _detector
    _detector = detector if detector is not None else TierDetector()


def _key_fingerprint() -> str:
    raw = get_settings().cmc_api_key.get_secret_value().encode("utf-8")
    return hashlib.sha256(raw).hexdigest()
