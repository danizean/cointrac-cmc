"""CoinTrac AI Analyst service powered by Meta Muse Spark 1.3 with native tool calling.

Architectural boundary (AGENTS.md Rule 10):
- CoinTrac quantitative analytics, screening, anomaly detection, regime classification,
  and Hidden Gem scoring remain 100% deterministic Python.
- CoinTrac AI operates strictly as a separate read-only orchestration and explanation layer:
  it calls deterministic intelligence services on behalf of the verified user, cites
  exact `evidence_id` and `data_mode` values, never invents missing (`null`) figures,
  and enforces Super-Admin configurable per-user rate limits and daily quotas.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol
from uuid import uuid4

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.api.deps import AuthContext, current_principal
from app.core.config import get_settings
from app.core.logging import register_secrets
from app.schemas.hidden_gems import (
    HiddenGemCandidatesInput,
    HiddenGemDetailInput,
    HiddenGemQualityStatsInput,
)
from app.schemas.tools import (
    AnalyzeAssetInput,
    AnalyzeMomentumInput,
    CompareAssetsInput,
    DerivativesAnalysisInput,
    DetectAnomaliesInput,
    HistoricalPerformanceInput,
    ScanMoversInput,
    SectorRotationInput,
    validate_quote_currency,
)
from app.services import intelligence as workflows
from app.services.ai_structured import (
    AIStructuredSummary,
    _extract_primary_ts,
    build_structured_summary,
)
from app.services.evidence import RequestLog, SupabaseEvidenceWriter
from app.services.hidden_gems import get_hidden_gem_service

logger = logging.getLogger("cointrac.ai")

# Muse Spark 1.3 pricing per 1M tokens (USD)
_MUSE_INPUT_USD_PER_M = 1.25
_MUSE_CACHED_INPUT_USD_PER_M = 0.15
_MUSE_OUTPUT_USD_PER_M = 4.25

AIStatusLiteral = Literal["OK", "CACHED", "RATE_LIMITED", "QUOTA_EXCEEDED", "DISABLED", "ERROR"]


class AIRuntimeConfigPublic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    provider: str = "meta_muse"
    base_url: str = "https://api.meta.ai/v1"
    model: str = "muse-spark-1.3"
    default_rate_limit_per_min: int = Field(default=10, ge=1, le=240)
    default_daily_requests: int = Field(default=50, ge=1, le=10000)
    default_daily_tokens: int = Field(default=150_000, ge=1000, le=10_000_000)
    max_tool_rounds: int = Field(default=4, ge=1, le=8)
    max_output_tokens: int = Field(default=900, ge=128, le=4096)
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    response_cache_ttl_seconds: int = Field(default=120, ge=0, le=3600)
    system_directive: str = ""
    api_key_configured: bool = False
    api_key_source: Literal["db", "env", "none"] = "none"
    api_key_hint: str | None = None
    updated_at: str | None = None


class AIRuntimeConfigUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    base_url: str | None = Field(default=None, min_length=8, max_length=256)
    model: str | None = Field(default=None, min_length=2, max_length=120)
    api_key_secret: str | None = Field(default=None, max_length=512)
    clear_api_key_secret: bool = False
    default_rate_limit_per_min: int | None = Field(default=None, ge=1, le=240)
    default_daily_requests: int | None = Field(default=None, ge=1, le=10000)
    default_daily_tokens: int | None = Field(default=None, ge=1000, le=10_000_000)
    max_tool_rounds: int | None = Field(default=None, ge=1, le=8)
    max_output_tokens: int | None = Field(default=None, ge=128, le=4096)
    temperature: float | None = Field(default=None, ge=0.0, le=1.0)
    response_cache_ttl_seconds: int | None = Field(default=None, ge=0, le=3600)
    system_directive: str | None = Field(default=None, max_length=2000)


class AIUserLimitsRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    ai_enabled: bool = True
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=240)
    daily_requests_limit: int | None = Field(default=None, ge=1, le=10000)
    daily_tokens_limit: int | None = Field(default=None, ge=1000, le=10_000_000)
    notes: str | None = None
    updated_at: str | None = None


class AIUserLimitsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ai_enabled: bool = True
    rate_limit_per_min: int | None = Field(default=None, ge=1, le=240)
    daily_requests_limit: int | None = Field(default=None, ge=1, le=10000)
    daily_tokens_limit: int | None = Field(default=None, ge=1000, le=10_000_000)
    notes: str | None = Field(default=None, max_length=400)


class AIUserRoleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform_role: Literal["user", "super_admin"]


class AIQuotaSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ai_enabled: bool
    user_ai_enabled: bool
    key_configured: bool
    model: str
    rate_limit_per_min: int
    used_last_minute: int
    remaining_this_minute: int
    daily_requests_limit: int
    used_today_requests: int
    remaining_today_requests: int
    daily_tokens_limit: int
    used_today_tokens: int
    remaining_today_tokens: int
    reset_in_seconds: int


class AIChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class AIChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[AIChatMessage] = Field(min_length=1, max_length=12)
    locale: Literal["en", "id"] = "id"
    context_hint: str | None = Field(default=None, max_length=160)
    bypass_cache: bool = False


class EvidenceCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_id: str
    tool: str
    data_mode: str | None = None
    freshness: str | None = None
    retrieved_at_utc: str | None = None
    source_timestamp: str | None = None
    status: str | None = None


class AITokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0


class AIChatResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str
    model: str
    locale: Literal["en", "id"]
    tools_used: list[str]
    evidence_refs: list[EvidenceCitation]
    tool_calls_count: int
    usage: AITokenUsage
    latency_ms: int
    cache_hit: bool
    quota: AIQuotaSnapshot
    structured_cards: AIStructuredSummary | None = None


class AIStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quota: AIQuotaSnapshot
    recent_logs: list[dict[str, Any]]


@dataclass
class _StoredConfig:
    enabled: bool = True
    provider: str = "meta_muse"
    base_url: str = "https://api.meta.ai/v1"
    model: str = "muse-spark-1.3"
    api_key_secret: str | None = None
    default_rate_limit_per_min: int = 10
    default_daily_requests: int = 50
    default_daily_tokens: int = 150_000
    max_tool_rounds: int = 4
    max_output_tokens: int = 2048
    temperature: float = 0.2
    response_cache_ttl_seconds: int = 120
    system_directive: str = ""
    updated_at: str | None = None


def _mask_secret(secret: str | None) -> str | None:
    if not secret:
        return None
    cleaned = secret.strip()
    if len(cleaned) <= 6:
        return "***"
    return f"***{cleaned[-4:]}"


def _resolve_key(stored: _StoredConfig) -> tuple[str | None, Literal["db", "env", "none"]]:
    if stored.api_key_secret and stored.api_key_secret.strip():
        secret = stored.api_key_secret.strip()
        register_secrets(secret)
        return secret, "db"
    env_key = get_settings().muse_api_key.get_secret_value().strip()
    if env_key:
        register_secrets(env_key)
        return env_key, "env"
    return None, "none"


def _to_public_config(stored: _StoredConfig) -> AIRuntimeConfigPublic:
    key, source = _resolve_key(stored)
    return AIRuntimeConfigPublic(
        enabled=stored.enabled,
        provider=stored.provider,
        base_url=stored.base_url,
        model=stored.model,
        default_rate_limit_per_min=stored.default_rate_limit_per_min,
        default_daily_requests=stored.default_daily_requests,
        default_daily_tokens=stored.default_daily_tokens,
        max_tool_rounds=stored.max_tool_rounds,
        max_output_tokens=stored.max_output_tokens,
        temperature=stored.temperature,
        response_cache_ttl_seconds=stored.response_cache_ttl_seconds,
        system_directive=stored.system_directive,
        api_key_configured=bool(key),
        api_key_source=source,
        api_key_hint=_mask_secret(key),
        updated_at=stored.updated_at,
    )


def estimate_muse_cost_usd(
    input_tokens: int,
    cached_input_tokens: int,
    output_tokens: int,
) -> float:
    uncached_in = max(0, input_tokens - cached_input_tokens)
    cost = (
        uncached_in * (_MUSE_INPUT_USD_PER_M / 1_000_000.0)
        + max(0, cached_input_tokens) * (_MUSE_CACHED_INPUT_USD_PER_M / 1_000_000.0)
        + max(0, output_tokens) * (_MUSE_OUTPUT_USD_PER_M / 1_000_000.0)
    )
    return round(cost, 6)


class AIStore(Protocol):
    async def get_config(self) -> _StoredConfig: ...

    async def update_config(
        self, update: AIRuntimeConfigUpdate, *, actor_id: str
    ) -> _StoredConfig: ...

    async def get_user_limits(self, user_id: str) -> AIUserLimitsRecord | None: ...

    async def set_user_limits(
        self, target_user_id: str, update: AIUserLimitsUpdate, *, actor_id: str
    ) -> AIUserLimitsRecord: ...

    async def delete_user_limits(self, target_user_id: str) -> None: ...

    async def list_all_user_limits(self) -> dict[str, AIUserLimitsRecord]: ...

    async def list_profiles(self, limit: int = 200) -> list[dict[str, Any]]: ...

    async def update_user_platform_role(
        self, target_user_id: str, platform_role: Literal["user", "super_admin"]
    ) -> dict[str, Any] | None: ...

    async def log_usage(self, row: dict[str, Any]) -> None: ...

    async def list_user_usage_logs(
        self, user_id: str, *, since_iso: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]: ...

    async def list_recent_usage_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]: ...

    async def list_recent_platform_request_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]: ...


class MemoryAIStore:
    """In-memory AI store for isolated unit tests and zero-DB local runs."""

    def __init__(self) -> None:
        settings = get_settings()
        self.config = _StoredConfig(
            base_url=settings.muse_base_url or "https://api.meta.ai/v1",
            model=settings.muse_model or "muse-spark-1.3",
        )
        self.user_limits: dict[str, AIUserLimitsRecord] = {}
        self.logs: list[dict[str, Any]] = []
        self.platform_request_logs: list[dict[str, Any]] = []
        self.profiles: dict[str, dict[str, Any]] = {}

    async def get_config(self) -> _StoredConfig:
        return self.config

    async def update_config(self, update: AIRuntimeConfigUpdate, *, actor_id: str) -> _StoredConfig:
        del actor_id
        data = update.model_dump(exclude_unset=True)
        if data.get("clear_api_key_secret"):
            self.config.api_key_secret = None
        elif "api_key_secret" in data and data["api_key_secret"] is not None:
            cleaned = str(data["api_key_secret"]).strip()
            if cleaned:
                self.config.api_key_secret = cleaned
                register_secrets(cleaned)

        for field in (
            "enabled",
            "base_url",
            "model",
            "default_rate_limit_per_min",
            "default_daily_requests",
            "default_daily_tokens",
            "max_tool_rounds",
            "max_output_tokens",
            "temperature",
            "response_cache_ttl_seconds",
            "system_directive",
        ):
            if field in data and data[field] is not None:
                setattr(self.config, field, data[field])
        self.config.updated_at = datetime.now(UTC).isoformat()
        return self.config

    async def get_user_limits(self, user_id: str) -> AIUserLimitsRecord | None:
        return self.user_limits.get(user_id)

    async def set_user_limits(
        self, target_user_id: str, update: AIUserLimitsUpdate, *, actor_id: str
    ) -> AIUserLimitsRecord:
        del actor_id
        rec = AIUserLimitsRecord(
            user_id=target_user_id,
            ai_enabled=update.ai_enabled,
            rate_limit_per_min=update.rate_limit_per_min,
            daily_requests_limit=update.daily_requests_limit,
            daily_tokens_limit=update.daily_tokens_limit,
            notes=update.notes,
            updated_at=datetime.now(UTC).isoformat(),
        )
        self.user_limits[target_user_id] = rec
        return rec

    async def delete_user_limits(self, target_user_id: str) -> None:
        self.user_limits.pop(target_user_id, None)

    async def list_all_user_limits(self) -> dict[str, AIUserLimitsRecord]:
        return dict(self.user_limits)

    async def list_profiles(self, limit: int = 200) -> list[dict[str, Any]]:
        return list(self.profiles.values())[:limit]

    async def update_user_platform_role(
        self, target_user_id: str, platform_role: Literal["user", "super_admin"]
    ) -> dict[str, Any] | None:
        prof = self.profiles.get(target_user_id)
        if prof is None:
            return None
        prof["platform_role"] = platform_role
        return dict(prof)

    async def log_usage(self, row: dict[str, Any]) -> None:
        entry = {"id": str(uuid4()), "created_at": datetime.now(UTC).isoformat(), **row}
        self.logs.insert(0, entry)

    async def list_user_usage_logs(
        self, user_id: str, *, since_iso: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        out = [r for r in self.logs if r.get("user_id") == user_id]
        if since_iso:
            out = [r for r in out if str(r.get("created_at") or "") >= since_iso]
        return out[:limit]

    async def list_recent_usage_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]:
        cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        return [r for r in self.logs if str(r.get("created_at") or "") >= cutoff][:limit]

    async def list_recent_platform_request_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]:
        cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat()
        filtered = [
            dict(r)
            for r in self.platform_request_logs
            if str(r.get("created_at") or "") >= cutoff
        ]
        filtered.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return filtered[:limit]


class SupabaseAIStore:
    """Supabase-backed AI store with resilient memory fallback if migration 015 is pending."""

    def __init__(self) -> None:
        self._fallback = MemoryAIStore()

    async def get_config(self) -> _StoredConfig:
        from app.core.db import supabase_client

        def read() -> _StoredConfig | None:
            resp = (
                supabase_client()
                .table("ai_runtime_config")
                .select("*")
                .eq("id", "default")
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                return None
            r = dict(rows[0])
            return _StoredConfig(
                enabled=bool(r.get("enabled", True)),
                provider=str(r.get("provider") or "meta_muse"),
                base_url=str(r.get("base_url") or "https://api.meta.ai/v1"),
                model=str(r.get("model") or "muse-spark-1.3"),
                api_key_secret=(str(r["api_key_secret"]) if r.get("api_key_secret") else None),
                default_rate_limit_per_min=int(r.get("default_rate_limit_per_min") or 10),
                default_daily_requests=int(r.get("default_daily_requests") or 50),
                default_daily_tokens=int(r.get("default_daily_tokens") or 150_000),
                max_tool_rounds=int(r.get("max_tool_rounds") or 4),
                max_output_tokens=int(r.get("max_output_tokens") or 900),
                temperature=float(
                    r.get("temperature") if r.get("temperature") is not None else 0.2
                ),
                response_cache_ttl_seconds=int(
                    r.get("response_cache_ttl_seconds")
                    if r.get("response_cache_ttl_seconds") is not None
                    else 120
                ),
                system_directive=str(r.get("system_directive") or ""),
                updated_at=str(r["updated_at"]) if r.get("updated_at") else None,
            )

        try:
            loaded = await asyncio.to_thread(read)
            if loaded is not None:
                return loaded
        except Exception as exc:
            logger.debug("ai_runtime_config fallback err=%s", exc.__class__.__name__)
        return await self._fallback.get_config()

    async def update_config(self, update: AIRuntimeConfigUpdate, *, actor_id: str) -> _StoredConfig:
        from app.core.db import supabase_client

        current = await self.get_config()
        payload: dict[str, Any] = {
            "id": "default",
            "updated_by": actor_id,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        data = update.model_dump(exclude_unset=True)
        if data.get("clear_api_key_secret"):
            payload["api_key_secret"] = None
        elif "api_key_secret" in data and data["api_key_secret"] is not None:
            cleaned = str(data["api_key_secret"]).strip()
            if cleaned:
                payload["api_key_secret"] = cleaned
                register_secrets(cleaned)
        else:
            payload["api_key_secret"] = current.api_key_secret

        for field in (
            "enabled",
            "base_url",
            "model",
            "default_rate_limit_per_min",
            "default_daily_requests",
            "default_daily_tokens",
            "max_tool_rounds",
            "max_output_tokens",
            "temperature",
            "response_cache_ttl_seconds",
            "system_directive",
        ):
            payload[field] = (
                data[field]
                if field in data and data[field] is not None
                else getattr(current, field)
            )

        def write() -> None:
            supabase_client().table("ai_runtime_config").upsert(payload, on_conflict="id").execute()

        try:
            await asyncio.to_thread(write)
            return await self.get_config()
        except Exception as exc:
            logger.warning("ai_runtime_config write fallback err=%s", exc.__class__.__name__)
            return await self._fallback.update_config(update, actor_id=actor_id)

    async def get_user_limits(self, user_id: str) -> AIUserLimitsRecord | None:
        from app.core.db import supabase_client

        def read() -> AIUserLimitsRecord | None:
            resp = (
                supabase_client()
                .table("ai_user_limits")
                .select("*")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                return None
            r = dict(rows[0])
            return AIUserLimitsRecord(
                user_id=str(r["user_id"]),
                ai_enabled=bool(r.get("ai_enabled", True)),
                rate_limit_per_min=(
                    int(r["rate_limit_per_min"])
                    if r.get("rate_limit_per_min") is not None
                    else None
                ),
                daily_requests_limit=(
                    int(r["daily_requests_limit"])
                    if r.get("daily_requests_limit") is not None
                    else None
                ),
                daily_tokens_limit=(
                    int(r["daily_tokens_limit"])
                    if r.get("daily_tokens_limit") is not None
                    else None
                ),
                notes=str(r["notes"]) if r.get("notes") else None,
                updated_at=str(r["updated_at"]) if r.get("updated_at") else None,
            )

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.get_user_limits(user_id)

    async def set_user_limits(
        self, target_user_id: str, update: AIUserLimitsUpdate, *, actor_id: str
    ) -> AIUserLimitsRecord:
        from app.core.db import supabase_client

        now_iso = datetime.now(UTC).isoformat()
        payload = {
            "user_id": target_user_id,
            "ai_enabled": update.ai_enabled,
            "rate_limit_per_min": update.rate_limit_per_min,
            "daily_requests_limit": update.daily_requests_limit,
            "daily_tokens_limit": update.daily_tokens_limit,
            "notes": update.notes,
            "updated_by": actor_id,
            "updated_at": now_iso,
        }

        def write() -> None:
            supabase_client().table("ai_user_limits").upsert(
                payload, on_conflict="user_id"
            ).execute()

        try:
            await asyncio.to_thread(write)
        except Exception:
            return await self._fallback.set_user_limits(target_user_id, update, actor_id=actor_id)
        return AIUserLimitsRecord(
            user_id=target_user_id,
            ai_enabled=update.ai_enabled,
            rate_limit_per_min=update.rate_limit_per_min,
            daily_requests_limit=update.daily_requests_limit,
            daily_tokens_limit=update.daily_tokens_limit,
            notes=update.notes,
            updated_at=now_iso,
        )

    async def delete_user_limits(self, target_user_id: str) -> None:
        from app.core.db import supabase_client

        def delete_row() -> None:
            (
                supabase_client()
                .table("ai_user_limits")
                .delete()
                .eq("user_id", target_user_id)
                .execute()
            )

        try:
            await asyncio.to_thread(delete_row)
        except Exception:
            await self._fallback.delete_user_limits(target_user_id)

    async def list_all_user_limits(self) -> dict[str, AIUserLimitsRecord]:
        from app.core.db import supabase_client

        def read() -> dict[str, AIUserLimitsRecord]:
            resp = supabase_client().table("ai_user_limits").select("*").limit(500).execute()
            out: dict[str, AIUserLimitsRecord] = {}
            for raw in resp.data or []:
                r = dict(raw)
                uid = str(r["user_id"])
                out[uid] = AIUserLimitsRecord(
                    user_id=uid,
                    ai_enabled=bool(r.get("ai_enabled", True)),
                    rate_limit_per_min=(
                        int(r["rate_limit_per_min"])
                        if r.get("rate_limit_per_min") is not None
                        else None
                    ),
                    daily_requests_limit=(
                        int(r["daily_requests_limit"])
                        if r.get("daily_requests_limit") is not None
                        else None
                    ),
                    daily_tokens_limit=(
                        int(r["daily_tokens_limit"])
                        if r.get("daily_tokens_limit") is not None
                        else None
                    ),
                    notes=str(r["notes"]) if r.get("notes") else None,
                    updated_at=str(r["updated_at"]) if r.get("updated_at") else None,
                )
            return out

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.list_all_user_limits()

    async def list_profiles(self, limit: int = 200) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        def read() -> list[dict[str, Any]]:
            client = supabase_client()
            try:
                resp = (
                    client.table("profiles")
                    .select(
                        "id,email,display_name,base_plan_code,account_status,"
                        "platform_role,email_verified_at,created_at"
                    )
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
            except Exception:
                resp = (
                    client.table("profiles")
                    .select(
                        "id,email,display_name,base_plan_code,account_status,"
                        "email_verified_at,created_at"
                    )
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                )
            return [dict(r) for r in (resp.data or [])]

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.list_profiles(limit=limit)

    async def update_user_platform_role(
        self, target_user_id: str, platform_role: Literal["user", "super_admin"]
    ) -> dict[str, Any] | None:
        from app.core.db import supabase_client

        def write() -> dict[str, Any] | None:
            resp = (
                supabase_client()
                .table("profiles")
                .update({"platform_role": platform_role})
                .eq("id", target_user_id)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(write)

    async def log_usage(self, row: dict[str, Any]) -> None:
        from app.core.db import supabase_client

        def write() -> None:
            supabase_client().table("ai_usage_logs").insert(row).execute()

        try:
            await asyncio.to_thread(write)
        except Exception:
            await self._fallback.log_usage(row)

    async def list_user_usage_logs(
        self, user_id: str, *, since_iso: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        def read() -> list[dict[str, Any]]:
            query = (
                supabase_client()
                .table("ai_usage_logs")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
            )
            if since_iso:
                query = query.gte("created_at", since_iso)
            resp = query.execute()
            return [dict(r) for r in (resp.data or [])]

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.list_user_usage_logs(
                user_id, since_iso=since_iso, limit=limit
            )

    async def list_recent_usage_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        since_iso = (datetime.now(UTC) - timedelta(days=days)).isoformat()

        def read() -> list[dict[str, Any]]:
            resp = (
                supabase_client()
                .table("ai_usage_logs")
                .select("*")
                .gte("created_at", since_iso)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.list_recent_usage_logs(days=days, limit=limit)

    async def list_recent_platform_request_logs(
        self, *, days: int = 30, limit: int = 2000
    ) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        since_iso = (datetime.now(UTC) - timedelta(days=days)).isoformat()

        def read() -> list[dict[str, Any]]:
            resp = (
                supabase_client()
                .table("request_logs")
                .select(
                    "id,user_id,api_key_id,surface,tool_name,status_code,"
                    "latency_ms,cache_hit,credit_cost,evidence_id,created_at"
                )
                .gte("created_at", since_iso)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return await self._fallback.list_recent_platform_request_logs(days=days, limit=limit)


class MuseTransport(Protocol):
    async def chat_completion(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]: ...


class HttpxMuseTransport:
    """Async OpenAI-compatible HTTP client targeting Meta Muse Spark 1.3 (dev.meta.ai)."""

    async def chat_completion(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]:
        endpoint = f"{base_url.rstrip('/')}/chat/completions"
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        async with httpx.AsyncClient(timeout=38.0) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            detail_preview = ""
            try:
                err_json = response.json()
                err_obj = err_json.get("error")
                if isinstance(err_obj, dict) and err_obj.get("message"):
                    detail_preview = str(err_obj["message"])[:200]
            except Exception:
                detail_preview = response.text[:160]
            raise RuntimeError(
                f"Muse upstream HTTP {response.status_code}"
                + (f": {detail_preview}" if detail_preview else "")
            )
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("Invalid JSON object from Muse API")
        return data


_TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_market_overview",
            "description": (
                "Fetch macro crypto overview: market cap, BTC/ETH dominance, Fear & Greed, "
                "Top-50 breadth, and spot leaders."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "quote_currency": {"type": "string", "default": "USD"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_market_regime",
            "description": (
                "Classify deterministic macro regime (RISK_ON_ALTSEASON, BTC_LED_EXPANSION, "
                "RANGE_CONSOLIDATION, RISK_OFF_STRESS) with rationale."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "quote_currency": {"type": "string", "default": "USD"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_asset",
            "description": (
                "Deep single-asset profile by canonical CMC ID: price, market cap, FDV, "
                "volume, supply inflation, RS vs BTC, and risk metrics."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {
                        "type": "string",
                        "description": "Ticker symbol e.g. BTC, ETH, SOL, ONDO",
                    },
                    "quote_currency": {"type": "string", "default": "USD"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_assets",
            "description": (
                "Compare 2 to 8 coins side-by-side on liquidity, FDV overhang, "
                "composite momentum, and RS vs BTC."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 2,
                        "maxItems": 8,
                    },
                    "quote_currency": {"type": "string", "default": "USD"},
                },
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_momentum",
            "description": (
                "Multi-timeframe momentum (1h to 90d), acceleration, and RS vs BTC "
                "for 1 to 10 symbols."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "minItems": 1,
                        "maxItems": 10,
                    },
                    "quote_currency": {"type": "string", "default": "USD"},
                },
                "required": ["symbols"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scan_market_movers",
            "description": (
                "Anti-chase momentum screener filtering market cap, volume, "
                "and max 24h gain cap."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "quote_currency": {"type": "string", "default": "USD"},
                    "min_market_cap_usd": {"type": "number"},
                    "min_volume_24h_usd": {"type": "number"},
                    "max_24h_gain_pct": {"type": "number"},
                    "rank_by": {
                        "type": "string",
                        "enum": ["composite_momentum_score", "rs_vs_btc_7d", "volume_to_mcap"],
                    },
                    "limit": {"type": "integer", "default": 10},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "detect_market_anomalies",
            "description": (
                "Spot statistical volume-to-mcap spikes (Z-score & MAD) and strong "
                "BTC price divergences."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "quote_currency": {"type": "string", "default": "USD"},
                    "universe_size": {"type": "integer", "default": 150},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_sector_rotation",
            "description": (
                "Compare capital rotation across 7 canonical crypto sectors "
                "(defi, ai-big-data, layer-1, layer-2, gaming, rwa, memes)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sectors": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": [
                                "defi",
                                "ai-big-data",
                                "layer-1",
                                "layer-2",
                                "gaming",
                                "rwa",
                                "memes",
                            ],
                        },
                    },
                    "quote_currency": {"type": "string", "default": "USD"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_derivatives",
            "description": (
                "Inspect v5 derivatives market pairs (funding rate, open interest) "
                "or spot stress proxy for an asset."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "quote_currency": {"type": "string", "default": "USD"},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_historical_performance",
            "description": (
                "Daily aligned volatility sqrt(365), max drawdown, beta, and correlation "
                "vs BTC (returns TIER_RESTRICTED on Basic/Startup if OHLCV restricted)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "quote_currency": {"type": "string", "default": "USD"},
                    "count": {"type": "integer", "default": 30},
                },
                "required": ["symbol"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_hidden_gem_candidates",
            "description": (
                "List user's deterministic Hidden Gem candidates filtered by track "
                "(EARLY/CONFIRMED), horizon (SHORT_TERM/SWING), or min_score."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "track": {"type": "string", "enum": ["EARLY", "CONFIRMED"]},
                    "horizon": {"type": "string", "enum": ["SHORT_TERM", "SWING"]},
                    "min_score": {"type": "number"},
                    "limit": {"type": "integer", "default": 12},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_hidden_gem_detail",
            "description": (
                "Get full quantitative breakdown, factor weights, hard-gate notes, "
                "and forward checkpoint for a Hidden Gem candidate UUID."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "candidate_id": {"type": "string"},
                },
                "required": ["candidate_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_hidden_gem_quality_stats",
            "description": (
                "Read aggregated forward T+1/3/7/14/30d outcome calibration stats "
                "(hit rates, avg relative BTC return, MAE) for user's Hidden Gems."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "track": {"type": "string", "enum": ["EARLY", "CONFIRMED"]},
                },
            },
        },
    },
]


def _compact_value(val: Any, *, depth: int = 0) -> Any:
    if val is None or isinstance(val, bool | int | float):
        if isinstance(val, float) and not math.isfinite(val):
            return None
        return round(val, 6) if isinstance(val, float) else val
    if isinstance(val, str):
        return val if len(val) <= 220 else f"{val[:217]}..."
    if isinstance(val, BaseModel):
        return _compact_value(val.model_dump(mode="json"), depth=depth)
    if depth >= 4:
        return "[truncated]"
    if isinstance(val, list):
        return [_compact_value(item, depth=depth + 1) for item in val[:14]]
    if isinstance(val, dict):
        return {str(k): _compact_value(v, depth=depth + 1) for k, v in list(val.items())[:24]}
    return str(val)


def _compact_envelope_digest(raw_envelope: Any) -> dict[str, Any]:
    if isinstance(raw_envelope, BaseModel):
        dumped = raw_envelope.model_dump(mode="json")
    elif isinstance(raw_envelope, dict):
        dumped = raw_envelope
    else:
        return {"raw": str(raw_envelope)[:500]}

    evidence = dumped.get("evidence") if isinstance(dumped.get("evidence"), dict) else {}
    return {
        "tool": dumped.get("tool"),
        "status": dumped.get("status"),
        "summary": dumped.get("summary"),
        "evidence_id": evidence.get("evidence_id"),
        "data_mode": evidence.get("data_mode"),
        "freshness": evidence.get("freshness"),
        "retrieved_at_utc": evidence.get("retrieved_at_utc"),
        "source_timestamp": _extract_primary_ts(evidence),
        "limitations": dumped.get("limitations", [])[:8],
        "data": _compact_value(dumped.get("data")),
    }


def _system_prompt(locale: Literal["en", "id"], directive: str, context_hint: str | None) -> str:
    lang_rule = (
        "Respond concisely in natural, crisp Bahasa Indonesia."
        if locale == "id"
        else "Respond concisely in crisp, institutional English."
    )
    hint_line = f"\nActive workspace context: {context_hint}" if context_hint else ""
    extra = f"\nSuper Admin directive: {directive.strip()}" if directive.strip() else ""
    return (
        "You are CoinTrac AI, an institutional crypto market intelligence analyst "
        "powered by Meta Muse Spark 1.3.\n"
        f"{lang_rule}\n"
        "STRICT RULES:\n"
        "1. ALWAYS call the appropriate CoinTrac tools before quoting any live price, "
        "market cap, regime, score, or Hidden Gem candidate.\n"
        "2. Clean executive hierarchy (the UI renders KPI cards and tables automatically "
        "alongside your answer, so avoid walls of raw bullet numbers):\n"
        "   - Start with `**Bottom-line:**` in 1-2 crisp sentences. ONLY name coins/assets "
        "in the Bottom-line that you explicitly cover in the body/table.\n"
        "   - Use a compact Markdown table (`| Asset | Price | 24h | 7d | Score |`) when "
        "comparing 2+ coins, movers, Hidden Gems, or sectors.\n"
        "   - Group unavailable/TIER_RESTRICTED metrics into 1 short sentence; NEVER spam "
        "rows of `— / unavailable` bullets.\n"
        "   - Always finish with ONE line: `**Limitations & Evidence:**` citing every "
        "`evidence_id` and `data_mode`.\n"
        "3. Number normalization rules:\n"
        "   - Percentages: 1 decimal (`+4.3%`, `-3.7%`)\n"
        "   - Prices: 2 decimals (`$59,495.15`, `$70.85`; tiny sub-cent tokens max 6 decimals)\n"
        "   - Market cap / volume / OI: abbreviated (`$2.04T`, `$41.97B`, `$2.25M`)\n"
        "   - Scores: 1 decimal (`29.2`); Ratios: 2 decimals (`0.05`)\n"
        "4. NEVER invent missing values or turn `null` into `0`. "
        "Do NOT present CACHED or VERIFIED_SNAPSHOT_FALLBACK as live ticks, and never give "
        "financial/trading advice.\n"
        f"{hint_line}{extra}"
    )


class AIAnalystService:
    """Orchestrates CoinTrac AI tool calling, Muse execution, and per-user rate limits."""

    def __init__(
        self,
        *,
        store: AIStore | None = None,
        transport: MuseTransport | None = None,
    ) -> None:
        self.store: AIStore = store or SupabaseAIStore()
        self.transport: MuseTransport = transport or HttpxMuseTransport()
        self._minute_windows: dict[str, deque[float]] = defaultdict(deque)
        self._response_cache: dict[str, tuple[float, AIChatResponse]] = {}
        self._last_tool_envelopes: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def get_quota_snapshot(self, user_id: str) -> AIQuotaSnapshot:
        cfg, limits = await asyncio.gather(
            self.store.get_config(),
            self.store.get_user_limits(user_id),
        )
        key, _ = _resolve_key(cfg)
        rate_limit_min = (
            limits.rate_limit_per_min
            if limits and limits.rate_limit_per_min is not None
            else cfg.default_rate_limit_per_min
        )
        daily_req_limit = (
            limits.daily_requests_limit
            if limits and limits.daily_requests_limit is not None
            else cfg.default_daily_requests
        )
        daily_tok_limit = (
            limits.daily_tokens_limit
            if limits and limits.daily_tokens_limit is not None
            else cfg.default_daily_tokens
        )
        user_enabled = limits.ai_enabled if limits is not None else True

        now_dt = datetime.now(UTC)
        day_start = now_dt.replace(hour=0, minute=0, second=0, microsecond=0)
        today_logs = await self.store.list_user_usage_logs(
            user_id, since_iso=day_start.isoformat(), limit=500
        )
        counted_logs = [
            row for row in today_logs if str(row.get("status") or "") in {"OK", "CACHED"}
        ]
        used_today_req = len(counted_logs)
        used_today_tok = sum(int(row.get("total_tokens") or 0) for row in counted_logs)

        now_mono = time.monotonic()
        cutoff = now_mono - 60.0
        async with self._lock:
            q = self._minute_windows[user_id]
            while q and q[0] <= cutoff:
                q.popleft()
            used_min = len(q)
            reset_sec = max(1, int(math.ceil(60.0 - (now_mono - q[0])))) if q else 60

        return AIQuotaSnapshot(
            ai_enabled=cfg.enabled,
            user_ai_enabled=user_enabled,
            key_configured=bool(key),
            model=cfg.model,
            rate_limit_per_min=rate_limit_min,
            used_last_minute=used_min,
            remaining_this_minute=max(0, rate_limit_min - used_min),
            daily_requests_limit=daily_req_limit,
            used_today_requests=used_today_req,
            remaining_today_requests=max(0, daily_req_limit - used_today_req),
            daily_tokens_limit=daily_tok_limit,
            used_today_tokens=used_today_tok,
            remaining_today_tokens=max(0, daily_tok_limit - used_today_tok),
            reset_in_seconds=reset_sec,
        )

    async def get_status(self, user_id: str) -> AIStatusResponse:
        quota = await self.get_quota_snapshot(user_id)
        logs = await self.store.list_user_usage_logs(user_id, limit=15)
        return AIStatusResponse(quota=quota, recent_logs=logs)

    async def _check_and_reserve_rate_window(
        self,
        user_id: str,
        rate_limit_per_min: int,
    ) -> tuple[bool, int]:
        now_mono = time.monotonic()
        cutoff = now_mono - 60.0
        async with self._lock:
            q = self._minute_windows[user_id]
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= rate_limit_per_min:
                retry_after = max(1, int(math.ceil(60.0 - (now_mono - q[0]))))
                return False, retry_after
            q.append(now_mono)
            return True, 0

    async def _dispatch_tool_once(
        self,
        *,
        user_id: str,
        name: str,
        args: dict[str, Any],
        quote: str,
        byok_cmc_key: str | None,
    ) -> Any:
        if name == "get_market_overview":
            return await workflows.get_market_overview(
                quote_currency=quote, override_cmc_key=byok_cmc_key
            )
        if name == "analyze_market_regime":
            return await workflows.analyze_market_regime(
                quote_currency=quote, override_cmc_key=byok_cmc_key
            )
        if name == "analyze_asset":
            params = AnalyzeAssetInput(
                symbol=str(args.get("symbol") or "BTC"), quote_currency=quote
            )
            return await workflows.analyze_asset(params, override_cmc_key=byok_cmc_key)
        if name == "compare_assets":
            raw_syms = args.get("symbols") or ["BTC", "ETH"]
            params = CompareAssetsInput(symbols=list(raw_syms), quote_currency=quote)
            return await workflows.compare_assets(params, override_cmc_key=byok_cmc_key)
        if name == "analyze_momentum":
            raw_syms = args.get("symbols") or ["BTC"]
            params = AnalyzeMomentumInput(symbols=list(raw_syms), quote_currency=quote)
            return await workflows.analyze_momentum(params, override_cmc_key=byok_cmc_key)
        if name == "scan_market_movers":
            params = ScanMoversInput(
                quote_currency=quote,
                min_market_cap_usd=args.get("min_market_cap_usd", 250_000_000.0),
                min_volume_24h_usd=args.get("min_volume_24h_usd", 15_000_000.0),
                max_24h_gain_pct=args.get("max_24h_gain_pct", 18.0),
                rank_by=args.get("rank_by", "composite_momentum_score"),
                limit=int(args.get("limit") or 10),
            )
            return await workflows.scan_market_movers(params, override_cmc_key=byok_cmc_key)
        if name == "detect_market_anomalies":
            params = DetectAnomaliesInput(
                quote_currency=quote,
                universe_size=int(args.get("universe_size") or 150),
            )
            return await workflows.detect_market_anomalies(params, override_cmc_key=byok_cmc_key)
        if name == "analyze_sector_rotation":
            params = SectorRotationInput(
                quote_currency=quote,
                sectors=args.get("sectors"),
            )
            return await workflows.analyze_sector_rotation(params, override_cmc_key=byok_cmc_key)
        if name == "analyze_derivatives":
            params = DerivativesAnalysisInput(
                symbol=str(args.get("symbol") or "BTC"), quote_currency=quote
            )
            return await workflows.analyze_derivatives(params, override_cmc_key=byok_cmc_key)
        if name == "get_historical_performance":
            params = HistoricalPerformanceInput(
                symbol=str(args.get("symbol") or "BTC"),
                quote_currency=quote,
                count=int(args.get("count") or 30),
            )
            return await workflows.get_historical_performance(params, override_cmc_key=byok_cmc_key)
        if name == "list_hidden_gem_candidates":
            params = HiddenGemCandidatesInput(
                track=args.get("track"),
                horizon=args.get("horizon"),
                min_score=args.get("min_score"),
                limit=int(args.get("limit") or 12),
            )
            return await get_hidden_gem_service().list_candidates_envelope(
                user_id, params, evidence_writer=SupabaseEvidenceWriter()
            )
        if name == "get_hidden_gem_detail":
            params = HiddenGemDetailInput(candidate_id=str(args.get("candidate_id") or ""))
            return await get_hidden_gem_service().get_candidate_detail_envelope(
                user_id, params, evidence_writer=SupabaseEvidenceWriter()
            )
        if name == "get_hidden_gem_quality_stats":
            params = HiddenGemQualityStatsInput(track=args.get("track"))
            return await get_hidden_gem_service().get_quality_stats_envelope(
                user_id, params, evidence_writer=SupabaseEvidenceWriter()
            )
        raise KeyError(f"Unknown tool: {name}")

    async def _execute_tool(
        self,
        *,
        user_id: str,
        name: str,
        arguments_raw: str | dict[str, Any],
        byok_cmc_key: str | None,
    ) -> tuple[dict[str, Any], EvidenceCitation | None, dict[str, Any] | None]:
        if isinstance(arguments_raw, dict):
            args = arguments_raw
        else:
            try:
                parsed = json.loads(arguments_raw or "{}")
                args = parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {"error": f"Invalid JSON arguments for tool {name}"}, None, None

        quote = validate_quote_currency(str(args.get("quote_currency") or "USD"))
        fallback_key = f"{name}:{quote}:{json.dumps(args, sort_keys=True, default=str)}"
        started = time.perf_counter()
        envelope: Any = None
        last_exc: Exception | None = None
        token = current_principal.set(
            AuthContext(
                scoped=True,
                user_id=user_id,
                key_id=None,
                rate_limit_per_min=60,
                surface="playground",
                byok=byok_cmc_key,
            )
        )
        try:
            for attempt in range(2):
                try:
                    candidate = await self._dispatch_tool_once(
                        user_id=user_id,
                        name=name,
                        args=args,
                        quote=quote,
                        byok_cmc_key=byok_cmc_key,
                    )
                    if (
                        name == "analyze_market_regime"
                        and getattr(getattr(candidate, "data", None), "regime", None) is None
                        and attempt == 0
                    ):
                        await asyncio.sleep(0.25)
                        continue
                    envelope = candidate
                    last_exc = None
                    break
                except ValidationError as exc:
                    return (
                        {"error": f"Invalid tool parameters for {name}: {exc.errors()[:3]}"},
                        None,
                        None,
                    )
                except KeyError:
                    return {"error": f"Unknown tool: {name}"}, None, None
                except Exception as exc:
                    last_exc = exc
                    if attempt == 0:
                        await asyncio.sleep(0.25)
        finally:
            current_principal.reset(token)

        dumped: dict[str, Any] | None = None
        if envelope is not None:
            dumped = (
                envelope.model_dump(mode="json")
                if isinstance(envelope, BaseModel)
                else dict(envelope)
            )
            if name != "analyze_market_regime" or (dumped.get("data") or {}).get("regime"):
                self._last_tool_envelopes[fallback_key] = copy.deepcopy(dumped)
                self._last_tool_envelopes[name] = copy.deepcopy(dumped)

        if (
            dumped is None
            or (name == "analyze_market_regime" and not (dumped.get("data") or {}).get("regime"))
        ):
            cached_fallback = self._last_tool_envelopes.get(
                fallback_key
            ) or self._last_tool_envelopes.get(name)
            if cached_fallback is not None:
                dumped = copy.deepcopy(cached_fallback)
                ev_blk = dict(dumped.get("evidence") or {})
                ev_blk["data_mode"] = "CACHED"
                dumped["evidence"] = ev_blk
                lims = list(dumped.get("limitations") or [])
                fb_note = (
                    "Fallback to last cached snapshot after live tool error "
                    f"({last_exc.__class__.__name__ if last_exc else 'incomplete'})."
                )
                if fb_note not in lims:
                    lims.insert(0, fb_note)
                dumped["limitations"] = lims
            elif last_exc is not None:
                return {"error": f"Tool {name} failed: {last_exc.__class__.__name__}"}, None, None

        digest = _compact_envelope_digest(dumped if dumped is not None else envelope)
        ev_id = digest.get("evidence_id")
        citation = (
            EvidenceCitation(
                evidence_id=str(ev_id),
                tool=name,
                data_mode=str(digest.get("data_mode")) if digest.get("data_mode") else None,
                freshness=str(digest.get("freshness")) if digest.get("freshness") else None,
                retrieved_at_utc=str(digest.get("retrieved_at_utc"))
                if digest.get("retrieved_at_utc")
                else None,
                source_timestamp=str(digest.get("source_timestamp"))
                if digest.get("source_timestamp")
                else None,
                status=str(digest.get("status")) if digest.get("status") else None,
            )
            if ev_id
            else None
        )
        # Attribute tool call & CMC credit usage in request_logs silently
        try:
            ev_meta = getattr(envelope, "evidence", None)
            if ev_meta is not None:
                latency_ms = int((time.perf_counter() - started) * 1000)
                await SupabaseEvidenceWriter().log_request(
                    RequestLog(
                        api_key_id=None,
                        user_id=user_id,
                        surface="playground",
                        tool_name=name,
                        status_code=200,
                        latency_ms=latency_ms,
                        cache_hit=bool(ev_meta.cache_hit),
                        credit_cost=int(ev_meta.cmc_credit_cost or 0),
                        evidence_id=str(ev_id) if ev_id else None,
                    )
                )
        except Exception:
            pass
        return digest, citation, dumped

    async def chat(
        self,
        *,
        user_id: str,
        request: AIChatRequest,
        byok_cmc_key: str | None = None,
    ) -> tuple[AIChatResponse | None, tuple[int, str, dict[str, str]] | None]:
        """Execute CoinTrac AI chat turn and enforce rate/quota governance."""
        started = time.perf_counter()
        cfg = await self.store.get_config()
        quota = await self.get_quota_snapshot(user_id)
        last_user_prompt = next(
            (m.content for m in reversed(request.messages) if m.role == "user"), ""
        )[:220]

        if not quota.ai_enabled or not quota.user_ai_enabled:
            await self.store.log_usage(
                {
                    "user_id": user_id,
                    "model": cfg.model,
                    "status": "DISABLED",
                    "prompt_summary": last_user_prompt,
                    "error_code": "AI_DISABLED",
                }
            )
            msg = (
                "CoinTrac AI is currently paused for this account or workspace."
                if request.locale == "en"
                else "CoinTrac AI sedang dinonaktifkan sementara untuk akun atau workspace ini."
            )
            return None, (403, msg, {})

        key, _ = _resolve_key(cfg)
        if not key:
            return None, (
                503,
                "Muse API key is not configured. Set MUSE_API_KEY in server env "
                "or configure it in Super Admin.",
                {},
            )

        # Check cache before consuming minute/daily rate limits on repeated single-turn asks
        cache_key: str | None = None
        if (
            len(request.messages) == 1
            and cfg.response_cache_ttl_seconds > 0
            and not request.bypass_cache
        ):
            raw_sig = json.dumps(
                {
                    "u": user_id,
                    "m": request.messages[0].content.strip(),
                    "l": request.locale,
                    "c": request.context_hint or "",
                    "model": cfg.model,
                },
                sort_keys=True,
            )
            cache_key = hashlib.sha256(raw_sig.encode("utf-8")).hexdigest()[:24]
            cached = self._response_cache.get(cache_key)
            if cached is not None and cached[0] > time.monotonic():
                cached_resp = cached[1]
                latency_ms = max(1, int((time.perf_counter() - started) * 1000))
                await self.store.log_usage(
                    {
                        "user_id": user_id,
                        "model": cached_resp.model,
                        "status": "CACHED",
                        "prompt_summary": last_user_prompt,
                        "tools_called": cached_resp.tools_used,
                        "evidence_ids": [c.evidence_id for c in cached_resp.evidence_refs],
                        "tool_calls_count": cached_resp.tool_calls_count,
                        "input_tokens": 0,
                        "cached_input_tokens": 0,
                        "output_tokens": 0,
                        "total_tokens": 0,
                        "estimated_cost_usd": 0.0,
                        "latency_ms": latency_ms,
                        "cache_hit": True,
                    }
                )
                return (
                    cached_resp.model_copy(
                        update={
                            "cache_hit": True,
                            "latency_ms": latency_ms,
                            "usage": AITokenUsage(),
                            "quota": await self.get_quota_snapshot(user_id),
                        }
                    ),
                    None,
                )

        if quota.remaining_today_requests <= 0 or quota.remaining_today_tokens <= 0:
            await self.store.log_usage(
                {
                    "user_id": user_id,
                    "model": cfg.model,
                    "status": "QUOTA_EXCEEDED",
                    "prompt_summary": last_user_prompt,
                    "error_code": "DAILY_QUOTA_EXCEEDED",
                }
            )
            return None, (
                429,
                "Daily CoinTrac AI request or token quota reached. Resets at 00:00 UTC.",
                {"Retry-After": "3600"},
            )

        allowed, retry_after = await self._check_and_reserve_rate_window(
            user_id, quota.rate_limit_per_min
        )
        if not allowed:
            await self.store.log_usage(
                {
                    "user_id": user_id,
                    "model": cfg.model,
                    "status": "RATE_LIMITED",
                    "prompt_summary": last_user_prompt,
                    "error_code": "MINUTE_RATE_LIMIT",
                }
            )
            return None, (
                429,
                f"CoinTrac AI rate limit exceeded ({quota.rate_limit_per_min}/min). "
                f"Retry in {retry_after}s.",
                {"Retry-After": str(retry_after)},
            )

        conversation: list[dict[str, Any]] = [
            {
                "role": "system",
                "content": _system_prompt(
                    request.locale, cfg.system_directive, request.context_hint
                ),
            },
            *[{"role": m.role, "content": m.content} for m in request.messages],
        ]

        tools_used: list[str] = []
        citations: dict[str, EvidenceCitation] = {}
        collected_envelopes: list[dict[str, Any]] = []
        turn_tool_cache: dict[
            str, tuple[dict[str, Any], EvidenceCitation | None, dict[str, Any] | None]
        ] = {}
        total_in = 0
        total_cached_in = 0
        total_out = 0
        tool_calls_count = 0
        final_answer = ""

        try:
            is_reasoning_model = "muse" in cfg.model.lower()
            effective_max_tokens = (
                max(cfg.max_output_tokens, 1800) if is_reasoning_model else cfg.max_output_tokens
            )
            for round_idx in range(cfg.max_tool_rounds + 1):
                allow_tools = _TOOL_DEFINITIONS if round_idx < cfg.max_tool_rounds else []
                raw = await self.transport.chat_completion(
                    base_url=cfg.base_url,
                    api_key=key,
                    model=cfg.model,
                    messages=conversation,
                    tools=allow_tools,
                    max_tokens=effective_max_tokens,
                    temperature=cfg.temperature,
                )
                usage_raw = raw.get("usage") if isinstance(raw.get("usage"), dict) else {}
                total_in += int(usage_raw.get("prompt_tokens") or 0)
                prompt_details = (
                    usage_raw.get("prompt_tokens_details")
                    if isinstance(usage_raw.get("prompt_tokens_details"), dict)
                    else {}
                )
                total_cached_in += int(prompt_details.get("cached_tokens") or 0)
                total_out += int(usage_raw.get("completion_tokens") or 0)

                choices = raw.get("choices") if isinstance(raw.get("choices"), list) else []
                if not choices or not isinstance(choices[0], dict):
                    raise RuntimeError("Muse response contained no choices")
                finish_reason = str(choices[0].get("finish_reason") or "")
                msg = choices[0].get("message")
                if not isinstance(msg, dict):
                    raise RuntimeError("Muse choice contained no message")

                tool_calls = msg.get("tool_calls")
                if isinstance(tool_calls, list) and tool_calls and round_idx < cfg.max_tool_rounds:
                    conversation.append(
                        {
                            "role": "assistant",
                            "content": msg.get("content") or "",
                            "tool_calls": tool_calls,
                        }
                    )

                    # Execute tools sequentially within the turn with memoization so shared
                    # CMC feeds stay deterministically tagged (no race-induced LIVE/CACHED swaps).
                    for call in tool_calls[:6]:
                        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
                        t_name = str(fn.get("name") or "")
                        t_args = fn.get("arguments") or "{}"
                        t_id = str(call.get("id") or f"call_{uuid4().hex[:8]}")
                        args_key = (
                            t_args
                            if isinstance(t_args, str)
                            else json.dumps(t_args, sort_keys=True)
                        )
                        memo_key = f"{t_name}:{args_key}"
                        if memo_key in turn_tool_cache:
                            digest, cit, raw_env = turn_tool_cache[memo_key]
                        else:
                            digest, cit, raw_env = await self._execute_tool(
                                user_id=user_id,
                                name=t_name,
                                arguments_raw=t_args,
                                byok_cmc_key=byok_cmc_key,
                            )
                            turn_tool_cache[memo_key] = (digest, cit, raw_env)
                        tool_calls_count += 1
                        if t_name and t_name not in tools_used:
                            tools_used.append(t_name)
                        if cit is not None:
                            citations[cit.evidence_id] = cit
                        if raw_env is not None:
                            collected_envelopes.append(raw_env)
                        conversation.append(
                            {
                                "role": "tool",
                                "tool_call_id": t_id,
                                "content": json.dumps(digest, ensure_ascii=True),
                            }
                        )
                    continue

                final_answer = str(msg.get("content") or "").strip()
                if not final_answer and finish_reason == "length":
                    # Reasoning token budget filled max_tokens before emitting text;
                    # execute one direct synthesis turn with higher token headroom.
                    retry_raw = await self.transport.chat_completion(
                        base_url=cfg.base_url,
                        api_key=key,
                        model=cfg.model,
                        messages=[
                            *conversation,
                            {
                                "role": "user",
                                "content": (
                                    "Output the concise final summary now with observed figures "
                                    "and evidence_id citations directly; skip long reasoning."
                                ),
                            },
                        ],
                        tools=[],
                        max_tokens=max(effective_max_tokens, 2600),
                        temperature=cfg.temperature,
                    )
                    r_usage = (
                        retry_raw.get("usage") if isinstance(retry_raw.get("usage"), dict) else {}
                    )
                    total_in += int(r_usage.get("prompt_tokens") or 0)
                    r_details = (
                        r_usage.get("prompt_tokens_details")
                        if isinstance(r_usage.get("prompt_tokens_details"), dict)
                        else {}
                    )
                    total_cached_in += int(r_details.get("cached_tokens") or 0)
                    total_out += int(r_usage.get("completion_tokens") or 0)
                    r_choices = (
                        retry_raw.get("choices")
                        if isinstance(retry_raw.get("choices"), list)
                        else []
                    )
                    if r_choices and isinstance(r_choices[0], dict):
                        r_msg = r_choices[0].get("message")
                        if isinstance(r_msg, dict):
                            final_answer = str(r_msg.get("content") or "").strip()
                break
        except Exception as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            await self.store.log_usage(
                {
                    "user_id": user_id,
                    "model": cfg.model,
                    "status": "ERROR",
                    "prompt_summary": last_user_prompt,
                    "tools_called": tools_used,
                    "tool_calls_count": tool_calls_count,
                    "latency_ms": latency_ms,
                    "error_code": exc.__class__.__name__,
                }
            )
            return None, (502, f"CoinTrac AI upstream error: {exc}", {})

        if not final_answer:
            final_answer = (
                "Analisis selesai, namun model tidak mengembalikan ringkasan teks."
                if request.locale == "id"
                else "Analysis completed without a text summary."
            )

        latency_ms = max(1, int((time.perf_counter() - started) * 1000))
        total_tok = total_in + total_out
        est_cost = estimate_muse_cost_usd(total_in, total_cached_in, total_out)
        evidence_list = list(citations.values())

        await self.store.log_usage(
            {
                "user_id": user_id,
                "model": cfg.model,
                "status": "OK",
                "prompt_summary": last_user_prompt,
                "tools_called": tools_used,
                "evidence_ids": [c.evidence_id for c in evidence_list],
                "tool_calls_count": tool_calls_count,
                "input_tokens": total_in,
                "cached_input_tokens": total_cached_in,
                "output_tokens": total_out,
                "total_tokens": total_tok,
                "estimated_cost_usd": est_cost,
                "latency_ms": latency_ms,
                "cache_hit": False,
            }
        )

        updated_quota = await self.get_quota_snapshot(user_id)
        structured_cards = build_structured_summary(collected_envelopes, locale=request.locale)
        response_obj = AIChatResponse(
            answer=final_answer,
            model=cfg.model,
            locale=request.locale,
            tools_used=tools_used,
            evidence_refs=evidence_list,
            tool_calls_count=tool_calls_count,
            usage=AITokenUsage(
                input_tokens=total_in,
                cached_input_tokens=total_cached_in,
                output_tokens=total_out,
                total_tokens=total_tok,
                estimated_cost_usd=est_cost,
            ),
            latency_ms=latency_ms,
            cache_hit=False,
            quota=updated_quota,
            structured_cards=structured_cards,
        )
        if cache_key is not None and cfg.response_cache_ttl_seconds > 0:
            self._response_cache[cache_key] = (
                time.monotonic() + cfg.response_cache_ttl_seconds,
                response_obj,
            )
        return response_obj, None


_default_ai_service: AIAnalystService | None = None


def get_ai_analyst_service() -> AIAnalystService:
    global _default_ai_service
    if _default_ai_service is None:
        _default_ai_service = AIAnalystService()
    return _default_ai_service


def install_ai_analyst_service(service: AIAnalystService | None) -> None:
    global _default_ai_service
    _default_ai_service = service


def reset_ai_analyst_service() -> None:
    global _default_ai_service
    _default_ai_service = None
