"""Super Admin governance routes for CoinTrac AI limits, telemetry, and runtime config."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime
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

    now_utc = datetime.now(UTC)
    day_prefix = now_utc.strftime("%Y-%m-%d")

    req_24h = 0
    req_30d = 0
    rate_limited_24h = 0
    tokens_30d = 0
    cost_30d = 0.0
    cache_hits = 0
    tool_counts: dict[str, int] = defaultdict(int)

    per_user_today_req: dict[str, int] = defaultdict(int)
    per_user_today_tok: dict[str, int] = defaultdict(int)
    per_user_30d_req: dict[str, int] = defaultdict(int)
    per_user_30d_tok: dict[str, int] = defaultdict(int)
    per_user_30d_cost: dict[str, float] = defaultdict(float)

    email_by_uid = {str(p["id"]): p.get("email") for p in profiles if p.get("id")}

    for row in logs:
        uid = str(row.get("user_id") or "")
        status = str(row.get("status") or "")
        created_at = str(row.get("created_at") or "")
        is_today = created_at.startswith(day_prefix)
        tot_tok = int(row.get("total_tokens") or 0)
        est_cost = float(row.get("estimated_cost_usd") or 0.0)

        if status == "RATE_LIMITED" and is_today:
            rate_limited_24h += 1

        if status in {"OK", "CACHED"}:
            req_30d += 1
            tokens_30d += tot_tok
            cost_30d += est_cost
            if is_today:
                req_24h += 1
                per_user_today_req[uid] += 1
                per_user_today_tok[uid] += tot_tok
            per_user_30d_req[uid] += 1
            per_user_30d_tok[uid] += tot_tok
            per_user_30d_cost[uid] += est_cost
            if row.get("cache_hit") is True or status == "CACHED":
                cache_hits += 1
            for t in row.get("tools_called") or []:
                tool_counts[str(t)] += 1

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
            }
        )

    for uid in set(per_user_30d_req.keys()) - seen_uids:
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
        for r in logs[:30]
    ]

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
        },
        "top_tools": [
            {"tool_name": name, "calls": count}
            for name, count in sorted(tool_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
        "users": users_rows,
        "recent_logs": recent_logs,
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
