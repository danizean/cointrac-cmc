import asyncio
import time
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.deps import AuthContext, require_api_key

router = APIRouter(
    prefix="/v1/telemetry",
    tags=["Telemetry"],
)

_CACHE_TTL_SECONDS = 10.0
_cached_summary: dict[str, tuple[float, dict[str, object]]] = {}
_EMPTY_SUMMARY: dict[str, object] = {
    "calls_by_surface": {"mcp": 0, "rest": 0, "playground": 0},
    "cache_hit_rate_pct": None,
    "total_cmc_credits": 0,
    "average_latency_ms": None,
    "active_data_mode": None,
}


class UsageReader(Protocol):
    async def read_user_logs(self, owner_id: str, limit: int = 1000) -> list[dict[str, Any]]: ...

    async def read_user_plan(self, owner_id: str) -> str: ...


def _normalize_scan_run_log(row: dict[str, Any]) -> dict[str, Any] | None:
    """Project an hg_scan_runs row into the request_logs ledger shape without duplication."""
    status = str(row.get("status") or "").upper()
    credits = int(row.get("cmc_credits_consumed") or 0)
    terminal_statuses = {"COMPLETED", "PARTIAL", "FAILED", "CANCELLED"}
    if status not in terminal_statuses and credits <= 0:
        return None

    started_dt = _parse_iso(row.get("started_at") or row.get("created_at"))
    completed_dt = _parse_iso(row.get("completed_at"))
    latency_ms = (
        max(0, int((completed_dt - started_dt).total_seconds() * 1000))
        if started_dt is not None and completed_dt is not None
        else 0
    )

    source_meta = row.get("source_metadata") if isinstance(row.get("source_metadata"), dict) else {}
    cache_hit = credits == 0 and bool(source_meta.get("reused_cache"))

    if status in {"COMPLETED", "PARTIAL"}:
        status_code = 200
    elif status == "CANCELLED":
        status_code = 499
    elif status == "FAILED":
        status_code = 500
    else:
        status_code = 202

    created_at = str(
        row.get("completed_at") or row.get("created_at") or row.get("started_at") or ""
    )
    return {
        "surface": "rest",
        "tool_name": "hidden_gem_scan",
        "status_code": status_code,
        "latency_ms": latency_ms,
        "cache_hit": cache_hit,
        "credit_cost": credits,
        "evidence_id": None,
        "created_at": created_at,
    }


def _summarize_rows(rows: list[dict[str, Any]]) -> dict[str, object]:
    """Aggregate surface counts, cache efficiency, latency, and CMC credits from usage logs."""
    counts = {"mcp": 0, "rest": 0, "playground": 0}
    credits = 0
    hits = 0
    latency = 0
    for row in rows:
        surface = str(row.get("surface") or "")
        if surface in counts:
            counts[surface] += 1
        credits += int(row.get("credit_cost") or 0)
        latency += int(row.get("latency_ms") or 0)
        if row.get("cache_hit") is True:
            hits += 1
    total = len(rows)
    hit_rate = None if total == 0 else round(100 * hits / total, 2)
    average = None if total == 0 else round(latency / total, 2)
    return {
        "calls_by_surface": counts,
        "cache_hit_rate_pct": hit_rate,
        "total_cmc_credits": credits,
        "average_latency_ms": average,
        "active_data_mode": None,
    }


class SupabaseUsageReader:
    async def read_user_logs(self, owner_id: str, limit: int = 1000) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        def read() -> list[dict[str, Any]]:
            client = supabase_client()
            req_response = (
                client.table("request_logs")
                .select(
                    "surface,tool_name,status_code,latency_ms,"
                    "cache_hit,credit_cost,evidence_id,created_at"
                )
                .eq("user_id", owner_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            scan_response = (
                client.table("hg_scan_runs")
                .select(
                    "id,status,cmc_credits_consumed,source_metadata,"
                    "started_at,completed_at,created_at"
                )
                .eq("user_id", owner_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            combined: list[dict[str, Any]] = [dict(r) for r in (req_response.data or [])]
            for raw_scan in scan_response.data or []:
                normalized = _normalize_scan_run_log(dict(raw_scan))
                if normalized is not None:
                    combined.append(normalized)

            epoch = datetime.min.replace(tzinfo=UTC)
            combined.sort(
                key=lambda item: _parse_iso(item.get("created_at")) or epoch,
                reverse=True,
            )
            return combined[:limit]

        return await asyncio.to_thread(read)

    async def read_user_plan(self, owner_id: str) -> str:
        from app.core.db import supabase_client

        def read() -> str:
            response = (
                supabase_client()
                .table("profiles")
                .select("base_plan_code")
                .eq("id", owner_id)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            if rows and rows[0].get("base_plan_code"):
                return str(rows[0]["base_plan_code"])
            return "free"

        try:
            return await asyncio.to_thread(read)
        except Exception:
            return "free"


_usage_reader: UsageReader = SupabaseUsageReader()


def install_usage_reader(reader: UsageReader) -> None:
    global _usage_reader
    _usage_reader = reader
    _cached_summary.clear()


def reset_usage_reader() -> None:
    global _usage_reader
    _usage_reader = SupabaseUsageReader()
    _cached_summary.clear()


@router.get(
    "/summary",
    summary="Infrastructure Telemetry Summary",
    description=(
        "Aggregated call counts by surface (mcp/rest/playground), cache hit ratio, "
        "total CMC credits logged, and average latency."
    ),
)
async def summary(auth: AuthContext = Depends(require_api_key)) -> dict[str, object]:
    if not auth.scoped or not auth.user_id:
        return dict(_EMPTY_SUMMARY)
    now = time.monotonic()
    cached = _cached_summary.get(auth.user_id)
    if cached is not None and cached[0] > now:
        return dict(cached[1])

    owner_id = auth.user_id

    try:
        rows = await _usage_reader.read_user_logs(owner_id, limit=1000)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Telemetry store is unavailable") from exc
    payload = _summarize_rows(rows)
    _cached_summary[auth.user_id] = (now + _CACHE_TTL_SECONDS, payload)
    return payload


def _parse_iso(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


async def _server_mode() -> dict[str, object]:
    from app.services.budget import get_budget_controller
    from app.services.tier_detection import get_tier_detector

    detector = get_tier_detector()
    detected = detector.observation.detected_tier
    effective = detector.effective_profile()
    try:
        snap = await get_budget_controller().snapshot()
    except Exception:
        return {
            "effective_profile": effective,
            "detected_tier": detected,
            "budget_state": None,
            "deep_scan_available": False,
            "deep_scan_reason": "Budget snapshot is unavailable.",
        }
    available = detector.startup_features_open(
        state=snap.state,
        warning_level=snap.warning_level,
        ledger_status=snap.ledger_status,
    )
    if available:
        reason = (
            "Deep Scan is available because the effective profile is startup "
            "and the budget state is NORMAL."
        )
    else:
        reason = (
            "Deep Scan is unavailable. "
            f"Effective profile is {effective} and budget state is {snap.state}."
        )
    return {
        "effective_profile": effective,
        "detected_tier": detected,
        "budget_state": snap.state,
        "deep_scan_available": available,
        "deep_scan_reason": reason,
    }


@router.get(
    "/usage",
    summary="Tenant-Scoped CoinTrac Usage & CMC Credit Telemetry",
    description=(
        "Separates CoinTrac per-user tool quota from upstream CoinMarketCap credits "
        "triggered by this account, plus daily, per-tool, and recent request history."
    ),
)
async def usage(
    response: Response,
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    now_utc = datetime.now(UTC)
    month_prefix = now_utc.strftime("%Y-%m")
    cutoff_24h = now_utc - timedelta(hours=24)
    cutoff_30d = now_utc - timedelta(days=30)

    if not auth.scoped or not auth.user_id:
        return {
            "tool_quota": {
                "active_tier": "free",
                "rate_limit_per_min": auth.rate_limit_per_min,
                "window_seconds": 60,
                "daily_quota_limit": None,
                "calls_last_24h": 0,
                "calls_last_30d": 0,
                "calls_by_surface": {"mcp": 0, "rest": 0, "playground": 0},
            },
            "cmc_credits": {
                "billing_month_utc": month_prefix,
                "credits_this_month": 0,
                "monthly_allowance": None,
                "remaining_credits": None,
                "cache_hit_rate_pct": None,
                "average_latency_ms": None,
            },
            "daily_usage": [],
            "tool_breakdown": [],
            "recent_requests": [],
            "server_mode": await _server_mode(),
        }

    try:
        rows = await _usage_reader.read_user_logs(auth.user_id, limit=1000)
        active_tier = await _usage_reader.read_user_plan(auth.user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Usage store is unavailable") from exc

    surface_counts = {"mcp": 0, "rest": 0, "playground": 0}
    calls_24h = 0
    calls_30d = 0
    cmc_credits_month = 0
    cache_hits = 0
    total_latency = 0

    daily_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"calls": 0, "cache_hits": 0, "cmc_credits": 0}
    )
    tool_map: dict[str, dict[str, int]] = defaultdict(
        lambda: {"calls": 0, "cache_hits": 0, "cmc_credits": 0}
    )

    for row in rows:
        surface = str(row.get("surface") or "")
        if surface in surface_counts:
            surface_counts[surface] += 1
        credits = int(row.get("credit_cost") or 0)
        latency = int(row.get("latency_ms") or 0)
        is_hit = row.get("cache_hit") is True
        tool_name = str(row.get("tool_name") or "unknown")
        if is_hit:
            cache_hits += 1
        total_latency += latency

        ts = _parse_iso(row.get("created_at"))
        if ts is not None:
            if ts >= cutoff_24h:
                calls_24h += 1
            if ts >= cutoff_30d:
                calls_30d += 1
                day_key = ts.strftime("%Y-%m-%d")
                daily_map[day_key]["calls"] += 1
                daily_map[day_key]["cache_hits"] += 1 if is_hit else 0
                daily_map[day_key]["cmc_credits"] += credits
            if ts.strftime("%Y-%m") == month_prefix:
                cmc_credits_month += credits

        tool_map[tool_name]["calls"] += 1
        tool_map[tool_name]["cache_hits"] += 1 if is_hit else 0
        tool_map[tool_name]["cmc_credits"] += credits

    total_rows = len(rows)
    hit_rate = None if total_rows == 0 else round(100.0 * cache_hits / total_rows, 2)
    avg_latency = None if total_rows == 0 else round(total_latency / total_rows, 2)

    daily_usage = [
        {"date_utc": day, **stats} for day, stats in sorted(daily_map.items(), reverse=True)
    ]
    tool_breakdown = [
        {"tool_name": name, **stats}
        for name, stats in sorted(tool_map.items(), key=lambda kv: (-kv[1]["calls"], kv[0]))
    ]
    recent_requests = [
        {
            "tool_name": str(row.get("tool_name") or ""),
            "surface": str(row.get("surface") or ""),
            "status_code": int(row.get("status_code") or 0),
            "latency_ms": int(row.get("latency_ms") or 0),
            "cache_hit": bool(row.get("cache_hit")),
            "credit_cost": int(row.get("credit_cost") or 0),
            "evidence_id": str(row["evidence_id"]) if row.get("evidence_id") else None,
            "created_at": str(row.get("created_at") or ""),
        }
        for row in rows[:25]
    ]

    return {
        "tool_quota": {
            "active_tier": active_tier,
            "rate_limit_per_min": auth.rate_limit_per_min,
            "window_seconds": 60,
            "daily_quota_limit": None,
            "calls_last_24h": calls_24h,
            "calls_last_30d": calls_30d,
            "calls_by_surface": surface_counts,
        },
        "cmc_credits": {
            "billing_month_utc": month_prefix,
            "credits_this_month": cmc_credits_month,
            "monthly_allowance": None,
            "remaining_credits": None,
            "cache_hit_rate_pct": hit_rate,
            "average_latency_ms": avg_latency,
        },
        "daily_usage": daily_usage,
        "tool_breakdown": tool_breakdown,
        "recent_requests": recent_requests,
        "server_mode": await _server_mode(),
    }
