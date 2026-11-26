import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import uuid4

from app.adapters.cmc_client import FetchMeta

EXCERPT_LIMIT = 8000
_SECRET_KEYS = {"api_key", "cmc_api_key", "x-cmc_pro_api_key", "authorization", "service_role"}


@dataclass
class EvidenceDraft:
    evidence_id: str
    tool_name: str
    asset_cmc_ids: list[int]
    endpoints_called: list[str]
    data_mode: str
    freshness: str
    credit_cost: int
    engine_version: str
    methodology: dict[str, object]
    limitations: list[str]
    raw_excerpt: dict[str, object]


@dataclass
class RequestLog:
    api_key_id: str | None
    surface: str
    tool_name: str
    status_code: int
    latency_ms: int
    cache_hit: bool
    credit_cost: int
    evidence_id: str | None
    user_id: str | None = None


@dataclass
class CallRecord:
    endpoint: str
    payload: dict[str, object] | None = None
    meta: FetchMeta | None = None
    error: str | None = None
    error_category: str | None = None


@dataclass
class CallSummary:
    data_mode: str
    freshness: str
    credit_cost: int
    cache_hit: bool
    source_timestamps: dict[str, datetime]
    retrieved_at: datetime
    endpoints: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)


class EvidenceWriter(Protocol):
    async def persist(self, draft: EvidenceDraft) -> None: ...

    async def log_request(self, entry: RequestLog) -> None: ...


class MemoryEvidence:
    def __init__(self) -> None:
        self.records: list[EvidenceDraft] = []
        self.logs: list[RequestLog] = []

    async def persist(self, draft: EvidenceDraft) -> None:
        self.records.append(draft)

    async def log_request(self, entry: RequestLog) -> None:
        self.logs.append(entry)


class SupabaseEvidenceWriter:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _db(self) -> Any:
        if self._client is not None:
            return self._client
        from app.core.db import supabase_client

        return supabase_client()

    async def persist(self, draft: EvidenceDraft) -> None:
        allowed_db_modes = {"LIVE", "CACHED", "VERIFIED_SNAPSHOT_FALLBACK"}
        db_mode = (
            draft.data_mode if draft.data_mode in allowed_db_modes else "VERIFIED_SNAPSHOT_FALLBACK"
        )
        methodology = dict(draft.methodology)
        if draft.data_mode not in allowed_db_modes:
            methodology["actual_data_mode"] = draft.data_mode
        from app.api.deps import current_principal

        principal = current_principal.get()
        api_key_id = (
            principal.key_id
            if principal is not None
            and principal.key_id is not None
            and not principal.key_id.startswith("oauth:")
            else None
        )
        row = {
            "evidence_id": draft.evidence_id,
            "user_id": principal.user_id if principal is not None and principal.scoped else None,
            "api_key_id": api_key_id,
            "tool_name": draft.tool_name,
            "asset_cmc_ids": draft.asset_cmc_ids,
            "endpoints_called": draft.endpoints_called,
            "data_mode": db_mode,
            "freshness": draft.freshness,
            "credit_cost": draft.credit_cost,
            "engine_version": draft.engine_version,
            "methodology": methodology,
            "limitations": dedupe_limitations(draft.limitations),
            "raw_excerpt": draft.raw_excerpt,
        }
        await asyncio.to_thread(lambda: self._db().table("evidence_records").insert(row).execute())
        from app.api.v1.evidence import invalidate_evidence_cache

        invalidate_evidence_cache()

    async def log_request(self, entry: RequestLog) -> None:
        row = {
            "api_key_id": entry.api_key_id,
            "user_id": entry.user_id,
            "surface": entry.surface,
            "tool_name": entry.tool_name,
            "status_code": entry.status_code,
            "latency_ms": entry.latency_ms,
            "cache_hit": entry.cache_hit,
            "credit_cost": entry.credit_cost,
            "evidence_id": entry.evidence_id,
        }
        await asyncio.to_thread(lambda: self._db().table("request_logs").insert(row).execute())


def new_evidence_id() -> str:
    return f"ev_{uuid4().hex[:10]}"


def dedupe_limitations(items: list[str]) -> list[str]:
    """Deterministically deduplicate limitations while preserving first-seen order."""
    return list(dict.fromkeys(item.strip() for item in items if item and item.strip()))


def summarize_calls(records: list[CallRecord], now: datetime) -> CallSummary:
    metas = [record.meta for record in records if record.meta is not None]
    limitations = [record.error for record in records if record.error]
    for record in records:
        if record.meta is not None and record.meta.limitation:
            limitations.append(record.meta.limitation)
    if not metas:
        error_records = [record for record in records if record.error]
        all_plan_skipped = bool(error_records) and all(
            record.error_category == "tier_restricted" for record in error_records
        )
        fallback_note = (
            "No request was sent to CoinMarketCap (blocked by recorded capability metadata)."
            if all_plan_skipped
            else "No CoinMarketCap payload was available."
        )
        return CallSummary(
            data_mode="UNAVAILABLE",
            freshness="STALE",
            credit_cost=0,
            cache_hit=False,
            source_timestamps={},
            retrieved_at=now,
            endpoints=_endpoints(records),
            limitations=dedupe_limitations([*limitations, fallback_note]),
        )
    modes = {meta.data_mode for meta in metas}
    if "VERIFIED_SNAPSHOT_FALLBACK" in modes:
        data_mode = "VERIFIED_SNAPSHOT_FALLBACK"
        if len(modes) > 1:
            limitations.append(
                "Mixed data sources: verified snapshot fallback was combined with "
                "live or cached endpoints; inspect source_timestamps per endpoint."
            )
    elif modes == {"LIVE"}:
        data_mode = "LIVE"
    elif modes == {"CACHED"}:
        data_mode = "CACHED"
    else:
        data_mode = "CACHED"
        limitations.append(
            "Mixed data sources: some upstream endpoints were served from cache "
            "while others were fetched live; inspect source_timestamps per endpoint."
        )
    freshness = "FRESH"
    if any(meta.freshness == "STALE" for meta in metas):
        freshness = "STALE"
    elif any(meta.freshness == "AGING" for meta in metas):
        freshness = "AGING"
    stamps = {
        record.endpoint: record.meta.source_timestamp
        for record in records
        if record.meta is not None and record.meta.source_timestamp is not None
    }
    retrieved = [
        record.meta.retrieved_at
        for record in records
        if record.meta is not None and record.meta.retrieved_at is not None
    ]
    return CallSummary(
        data_mode=data_mode,
        freshness=freshness,
        credit_cost=sum(meta.credit_cost for meta in metas),
        cache_hit=all(meta.cache_hit for meta in metas),
        source_timestamps=stamps,
        retrieved_at=max(retrieved) if retrieved else now,
        endpoints=_endpoints(records),
        limitations=dedupe_limitations(limitations),
    )


def raw_excerpt(records: list[CallRecord]) -> dict[str, object]:
    payloads: dict[str, object] = {}
    for record in records:
        if record.payload is None:
            continue
        payloads[record.endpoint] = _shrink(record.payload)
    sanitized = sanitize(payloads)
    encoded = json.dumps(sanitized, default=str)
    if len(encoded) <= EXCERPT_LIMIT:
        return {"payloads": sanitized}
    return {"truncated": True, "endpoints": list(payloads)}


def sanitize(value: object) -> object:
    if isinstance(value, dict):
        cleaned: dict[str, object] = {}
        for key, item in value.items():
            if str(key).lower() in _SECRET_KEYS:
                continue
            cleaned[str(key)] = sanitize(item)
        return cleaned
    if isinstance(value, list):
        return [sanitize(item) for item in value[:20]]
    if isinstance(value, str) and len(value) > 500:
        return value[:500]
    return value


def _endpoints(records: list[CallRecord]) -> list[str]:
    seen: list[str] = []
    for record in records:
        if record.endpoint not in seen:
            seen.append(record.endpoint)
    return seen


def _shrink(payload: dict[str, object]) -> dict[str, object]:
    data = payload.get("data")
    status = payload.get("status") if isinstance(payload.get("status"), dict) else {}
    shrunk: dict[str, object] = {
        "status": {
            "timestamp": status.get("timestamp"),
            "error_code": status.get("error_code"),
            "credit_count": status.get("credit_count"),
        }
    }
    if isinstance(data, list):
        shrunk["data"] = data[:2]
    elif isinstance(data, dict):
        shrunk["data"] = data
    return shrunk


def utc_now() -> datetime:
    return datetime.now(UTC)
