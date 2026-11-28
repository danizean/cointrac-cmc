"""Super Admin governance routes for CoinTrac AI limits, telemetry, and runtime config."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.jwt_auth import AuthenticatedUser, require_super_admin
from app.services.ai_analyst import (
    AIRuntimeConfigPublic,
    AIRuntimeConfigUpdate,
    AIUserLimitsRecord,
    AIUserLimitsUpdate,
    AIUserRoleUpdate,
    _to_public_config,
    get_ai_analyst_service,
)

router = APIRouter(prefix="/v1/admin/ai", tags=["Super Admin AI"])


@router.get(
    "/config",
    response_model=AIRuntimeConfigPublic,
    summary="Read CoinTrac AI Global Config",
)
async def get_ai_config(
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> AIRuntimeConfigPublic:
    del admin
    response.headers["Cache-Control"] = "no-store"
    stored = await get_ai_analyst_service().store.get_config()
    return _to_public_config(stored)


@router.patch(
    "/config",
    response_model=AIRuntimeConfigPublic,
    summary="Update CoinTrac AI Global Config",
)
async def update_ai_config(
    payload: AIRuntimeConfigUpdate,
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> AIRuntimeConfigPublic:
    response.headers["Cache-Control"] = "no-store"
    updated = await get_ai_analyst_service().store.update_config(payload, actor_id=admin.user_id)
    return _to_public_config(updated)


@router.get(
    "/overview",
    summary="Super Admin CoinTrac AI Usage & Per-User Quota Overview",
)
async def get_admin_ai_overview(
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> dict[str, Any]:
    del admin
    response.headers["Cache-Control"] = "no-store"
    store = get_ai_analyst_service().store
    stored_cfg = await store.get_config()
    public_cfg = _to_public_config(stored_cfg)
    limits_by_user = await store.list_all_user_limits()
    profiles = await store.list_profiles(limit=200)
    logs = await store.list_recent_usage_logs(days=30, limit=2000)
    platform_logs_fn = getattr(store, "list_recent_platform_request_logs", None)
    platform_logs: list[dict[str, Any]] = (
        await platform_logs_fn(days=30, limit=2000) if callable(platform_logs_fn) else []
    )

    now_utc = datetime.now(UTC)
    day_prefix = now_utc.strftime("%Y-%m-%d")

    req_24h = 0
    req_30d = 0
    rate_limited_24h = 0
    error_count_30d = 0
    tokens_30d = 0
    cost_30d = 0.0
    cache_hits = 0
    latency_sum_30d = 0
    latency_samples_30d = 0
    tool_counts: dict[str, int] = defaultdict(int)

    per_user_today_req: dict[str, int] = defaultdict(int)
    per_user_today_tok: dict[str, int] = defaultdict(int)
    per_user_30d_req: dict[str, int] = defaultdict(int)
    per_user_30d_tok: dict[str, int] = defaultdict(int)
    per_user_30d_cost: dict[str, float] = defaultdict(float)

    api_req_24h = 0
    api_req_30d = 0
    mcp_req_24h = 0
    mcp_req_30d = 0
    rest_req_30d = 0
    playground_req_30d = 0
    oauth_mcp_req_30d = 0
    api_key_mcp_req_30d = 0
    cmc_credits_30d = 0
    api_cache_hits_30d = 0
    api_error_count_30d = 0
    api_latency_sum_30d = 0
    api_latency_samples_30d = 0
    platform_tool_stats: dict[str, dict[str, Any]] = {}

    per_user_api_today: dict[str, int] = defaultdict(int)
    per_user_mcp_30d: dict[str, int] = defaultdict(int)
    per_user_rest_30d: dict[str, int] = defaultdict(int)
    per_user_credits_30d: dict[str, int] = defaultdict(int)
    per_user_last_api_at: dict[str, str] = {}

    daily_buckets: dict[str, dict[str, Any]] = {}
    for offset in range(13, -1, -1):
        day_key = (now_utc - timedelta(days=offset)).strftime("%Y-%m-%d")
        daily_buckets[day_key] = {
            "date_utc": day_key,
            "requests": 0,
            "cached": 0,
            "rate_limited": 0,
            "errors": 0,
            "tokens": 0,
            "estimated_cost_usd": 0.0,
            "mcp_requests": 0,
            "rest_requests": 0,
            "api_credits": 0,
        }

    email_by_uid = {str(p["id"]): p.get("email") for p in profiles if p.get("id")}

    for row in logs:
        uid = str(row.get("user_id") or "")
        status = str(row.get("status") or "")
        created_at = str(row.get("created_at") or "")
        log_day = created_at[:10]
        is_today = created_at.startswith(day_prefix)
        tot_tok = int(row.get("total_tokens") or 0)
        est_cost = float(row.get("estimated_cost_usd") or 0.0)
        lat_ms = int(row.get("latency_ms") or 0)

        if status == "RATE_LIMITED":
            if is_today:
                rate_limited_24h += 1
            if log_day in daily_buckets:
                daily_buckets[log_day]["rate_limited"] += 1

        if status == "ERROR":
            error_count_30d += 1
            if log_day in daily_buckets:
                daily_buckets[log_day]["errors"] += 1

        if status in {"OK", "CACHED"}:
            req_30d += 1
            tokens_30d += tot_tok
            cost_30d += est_cost
            if lat_ms > 0:
                latency_sum_30d += lat_ms
                latency_samples_30d += 1
            is_cached = row.get("cache_hit") is True or status == "CACHED"
            if is_today:
                req_24h += 1
                per_user_today_req[uid] += 1
                per_user_today_tok[uid] += tot_tok
            per_user_30d_req[uid] += 1
            per_user_30d_tok[uid] += tot_tok
            per_user_30d_cost[uid] += est_cost
            if is_cached:
                cache_hits += 1
            for t in row.get("tools_called") or []:
                tool_counts[str(t)] += 1
            if log_day in daily_buckets:
                daily_buckets[log_day]["requests"] += 1
                daily_buckets[log_day]["tokens"] += tot_tok
                daily_buckets[log_day]["estimated_cost_usd"] += est_cost
                if is_cached:
                    daily_buckets[log_day]["cached"] += 1

    for row in platform_logs:
        uid = str(row.get("user_id") or "")
        surface = str(row.get("surface") or "rest").lower()
        tool_name = str(row.get("tool_name") or "unknown")
        status_code = int(row.get("status_code") or 200)
        lat_ms = int(row.get("latency_ms") or 0)
        credits = int(row.get("credit_cost") or 0)
        is_cached = bool(row.get("cache_hit"))
        created_at = str(row.get("created_at") or "")
        log_day = created_at[:10]
        is_today = created_at.startswith(day_prefix)
        has_key = row.get("api_key_id") is not None

        api_req_30d += 1
        cmc_credits_30d += credits
        if is_today:
            api_req_24h += 1
        if is_cached:
            api_cache_hits_30d += 1
        if status_code >= 400:
            api_error_count_30d += 1
        if lat_ms > 0:
            api_latency_sum_30d += lat_ms
            api_latency_samples_30d += 1

        if surface == "mcp":
            mcp_req_30d += 1
            if is_today:
                mcp_req_24h += 1
            if has_key:
                api_key_mcp_req_30d += 1
            else:
                oauth_mcp_req_30d += 1
        elif surface == "playground":
            playground_req_30d += 1
        else:
            rest_req_30d += 1

        if uid:
            if is_today:
                per_user_api_today[uid] += 1
            if surface == "mcp":
                per_user_mcp_30d[uid] += 1
            elif surface != "playground":
                per_user_rest_30d[uid] += 1
            per_user_credits_30d[uid] += credits
            prev_ts = per_user_last_api_at.get(uid)
            if created_at and (prev_ts is None or created_at > prev_ts):
                per_user_last_api_at[uid] = created_at

        tool_entry = platform_tool_stats.setdefault(
            tool_name,
            {
                "tool_name": tool_name,
                "calls": 0,
                "mcp_calls": 0,
                "rest_calls": 0,
                "credits": 0,
            },
        )
        tool_entry["calls"] += 1
        tool_entry["credits"] += credits
        if surface == "mcp":
            tool_entry["mcp_calls"] += 1
        elif surface != "playground":
            tool_entry["rest_calls"] += 1

        if log_day in daily_buckets:
            if surface == "mcp":
                daily_buckets[log_day]["mcp_requests"] += 1
            elif surface != "playground":
                daily_buckets[log_day]["rest_requests"] += 1
            daily_buckets[log_day]["api_credits"] += credits

    users_rows: list[dict[str, Any]] = []
    seen_uids: set[str] = set()
    for p in profiles:
        uid = str(p.get("id") or "")
        if not uid:
            continue
        seen_uids.add(uid)
        lim = limits_by_user.get(uid)
        users_rows.append(
            {
                "user_id": uid,
                "email": p.get("email"),
                "display_name": p.get("display_name"),
                "base_plan_code": p.get("base_plan_code") or "free",
                "platform_role": p.get("platform_role") or "user",
                "ai_enabled": lim.ai_enabled if lim else True,
                "rate_limit_per_min": lim.rate_limit_per_min if lim else None,
                "daily_requests_limit": lim.daily_requests_limit if lim else None,
                "daily_tokens_limit": lim.daily_tokens_limit if lim else None,
                "effective_rate_limit_per_min": (
                    lim.rate_limit_per_min
                    if lim and lim.rate_limit_per_min is not None
                    else public_cfg.default_rate_limit_per_min
                ),
                "effective_daily_requests_limit": (
                    lim.daily_requests_limit
                    if lim and lim.daily_requests_limit is not None
                    else public_cfg.default_daily_requests
                ),
                "effective_daily_tokens_limit": (
                    lim.daily_tokens_limit
                    if lim and lim.daily_tokens_limit is not None
                    else public_cfg.default_daily_tokens
                ),
                "notes": lim.notes if lim else None,
                "used_today_requests": per_user_today_req[uid],
                "used_today_tokens": per_user_today_tok[uid],
                "used_30d_requests": per_user_30d_req[uid],
                "used_30d_tokens": per_user_30d_tok[uid],
                "estimated_cost_30d_usd": round(per_user_30d_cost[uid], 6),
                "mcp_calls_30d": per_user_mcp_30d[uid],
                "rest_calls_30d": per_user_rest_30d[uid],
                "api_calls_today": per_user_api_today[uid],
                "cmc_credits_30d": per_user_credits_30d[uid],
                "last_api_activity_at": per_user_last_api_at.get(uid),
            }
        )

    extra_active_uids = (
        set(per_user_30d_req.keys())
        | set(per_user_mcp_30d.keys())
        | set(per_user_rest_30d.keys())
        | set(per_user_api_today.keys())
    ) - seen_uids - {""}
    for uid in sorted(extra_active_uids):
        lim = limits_by_user.get(uid)
        users_rows.append(
            {
                "user_id": uid,
                "email": None,
                "display_name": None,
                "base_plan_code": "free",
                "platform_role": "user",
                "ai_enabled": lim.ai_enabled if lim else True,
                "rate_limit_per_min": lim.rate_limit_per_min if lim else None,
                "daily_requests_limit": lim.daily_requests_limit if lim else None,
                "daily_tokens_limit": lim.daily_tokens_limit if lim else None,
                "effective_rate_limit_per_min": (
                    lim.rate_limit_per_min
                    if lim and lim.rate_limit_per_min is not None
                    else public_cfg.default_rate_limit_per_min
                ),
                "effective_daily_requests_limit": (
                    lim.daily_requests_limit
                    if lim and lim.daily_requests_limit is not None
                    else public_cfg.default_daily_requests
                ),
                "effective_daily_tokens_limit": (
                    lim.daily_tokens_limit
                    if lim and lim.daily_tokens_limit is not None
                    else public_cfg.default_daily_tokens
                ),
                "notes": lim.notes if lim else None,
                "used_today_requests": per_user_today_req[uid],
                "used_today_tokens": per_user_today_tok[uid],
                "used_30d_requests": per_user_30d_req[uid],
                "used_30d_tokens": per_user_30d_tok[uid],
                "estimated_cost_30d_usd": round(per_user_30d_cost[uid], 6),
                "mcp_calls_30d": per_user_mcp_30d[uid],
                "rest_calls_30d": per_user_rest_30d[uid],
                "api_calls_today": per_user_api_today[uid],
                "cmc_credits_30d": per_user_credits_30d[uid],
                "last_api_activity_at": per_user_last_api_at.get(uid),
            }
        )

    recent_logs = [
        {
            "id": r.get("id"),
            "user_id": r.get("user_id"),
            "user_email": email_by_uid.get(str(r.get("user_id") or "")),
            "model": r.get("model"),
            "status": r.get("status"),
            "prompt_summary": r.get("prompt_summary"),
            "tools_called": r.get("tools_called") or [],
            "evidence_ids": r.get("evidence_ids") or [],
            "total_tokens": int(r.get("total_tokens") or 0),
            "estimated_cost_usd": float(r.get("estimated_cost_usd") or 0.0),
            "latency_ms": int(r.get("latency_ms") or 0),
            "cache_hit": bool(r.get("cache_hit")),
            "error_code": r.get("error_code"),
            "created_at": r.get("created_at"),
        }
        for r in logs[:100]
    ]

    daily_series = [
        {
            **bucket,
            "estimated_cost_usd": round(float(bucket["estimated_cost_usd"]), 6),
        }
        for bucket in daily_buckets.values()
    ]

    super_admin_count = sum(1 for u in users_rows if u["platform_role"] == "super_admin")
    ai_paused_count = sum(1 for u in users_rows if not u["ai_enabled"])
    custom_limit_count = sum(
        1
        for u in users_rows
        if (
            not u["ai_enabled"]
            or u["rate_limit_per_min"] is not None
            or u["daily_requests_limit"] is not None
            or u["daily_tokens_limit"] is not None
        )
    )

    recent_api_logs = [
        {
            "id": str(r.get("id") or idx),
            "user_id": str(r.get("user_id") or ""),
            "user_email": email_by_uid.get(str(r.get("user_id") or "")),
            "api_key_id": str(r["api_key_id"]) if r.get("api_key_id") is not None else None,
            "auth_mode": (
                "api_key"
                if r.get("api_key_id") is not None
                else ("oauth" if str(r.get("surface") or "").lower() == "mcp" else "session")
            ),
            "surface": str(r.get("surface") or "rest"),
            "tool_name": str(r.get("tool_name") or "unknown"),
            "status_code": int(r.get("status_code") or 200),
            "latency_ms": int(r.get("latency_ms") or 0),
            "cache_hit": bool(r.get("cache_hit")),
            "credit_cost": int(r.get("credit_cost") or 0),
            "evidence_id": str(r["evidence_id"]) if r.get("evidence_id") else None,
            "created_at": str(r.get("created_at") or ""),
        }
        for idx, r in enumerate(platform_logs[:100])
    ]

    api_active_users = len(
        {str(r.get("user_id") or "") for r in platform_logs if r.get("user_id")}
    )

    return {
        "config": public_cfg.model_dump(mode="json"),
        "summary": {
            "requests_today": req_24h,
            "requests_30d": req_30d,
            "tokens_30d": tokens_30d,
            "estimated_cost_30d_usd": round(cost_30d, 6),
            "cache_hit_rate_pct": round(100.0 * cache_hits / req_30d, 2) if req_30d > 0 else None,
            "rate_limited_today": rate_limited_24h,
            "active_users_30d": sum(1 for v in per_user_30d_req.values() if v > 0),
            "error_count_30d": error_count_30d,
            "avg_latency_ms": (
                round(latency_sum_30d / latency_samples_30d) if latency_samples_30d > 0 else None
            ),
            "total_registered_users": len(users_rows),
            "super_admin_count": super_admin_count,
            "ai_paused_users": ai_paused_count,
            "custom_limit_users": custom_limit_count,
        },
        "platform_summary": {
            "requests_today": api_req_24h,
            "requests_30d": api_req_30d,
            "mcp_requests_today": mcp_req_24h,
            "mcp_requests_30d": mcp_req_30d,
            "rest_requests_30d": rest_req_30d,
            "playground_requests_30d": playground_req_30d,
            "oauth_mcp_requests_30d": oauth_mcp_req_30d,
            "api_key_mcp_requests_30d": api_key_mcp_req_30d,
            "cmc_credits_30d": cmc_credits_30d,
            "cache_hit_rate_pct": (
                round(100.0 * api_cache_hits_30d / api_req_30d, 2) if api_req_30d > 0 else None
            ),
            "error_count_30d": api_error_count_30d,
            "avg_latency_ms": (
                round(api_latency_sum_30d / api_latency_samples_30d)
                if api_latency_samples_30d > 0
                else None
            ),
            "active_users_30d": api_active_users,
        },
        "daily_series": daily_series,
        "top_tools": [
            {"tool_name": name, "calls": count}
            for name, count in sorted(tool_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "platform_top_tools": sorted(
            platform_tool_stats.values(),
            key=lambda item: (-int(item["calls"]), str(item["tool_name"])),
        ),
        "users": users_rows,
        "recent_logs": recent_logs,
        "recent_api_logs": recent_api_logs,
    }


@router.put(
    "/users/{target_user_id}/limits",
    response_model=AIUserLimitsRecord,
    summary="Upsert Per-User CoinTrac AI Rate Limit",
)
async def upsert_user_ai_limits(
    target_user_id: str,
    payload: AIUserLimitsUpdate,
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> AIUserLimitsRecord:
    response.headers["Cache-Control"] = "no-store"
    return await get_ai_analyst_service().store.set_user_limits(
        target_user_id, payload, actor_id=admin.user_id
    )


@router.delete(
    "/users/{target_user_id}/limits",
    summary="Reset Per-User CoinTrac AI Limits to Global Default",
)
async def reset_user_ai_limits(
    target_user_id: str,
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> dict[str, object]:
    del admin
    response.headers["Cache-Control"] = "no-store"
    await get_ai_analyst_service().store.delete_user_limits(target_user_id)
    return {"reset": True, "user_id": target_user_id}


@router.patch(
    "/users/{target_user_id}/role",
    summary="Promote or Demote User Platform Role",
)
async def update_user_role(
    target_user_id: str,
    payload: AIUserRoleUpdate,
    response: Response,
    admin: AuthenticatedUser = Depends(require_super_admin),
) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    if target_user_id == admin.user_id and payload.platform_role != "super_admin":
        raise HTTPException(
            status_code=400, detail="Cannot demote your own active super_admin session."
        )
    updated = await get_ai_analyst_service().store.update_user_platform_role(
        target_user_id, payload.platform_role
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="User profile not found")
    return {
        "user_id": target_user_id,
        "platform_role": updated.get("platform_role", payload.platform_role),
    }
