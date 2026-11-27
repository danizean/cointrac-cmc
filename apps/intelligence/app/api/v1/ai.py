"""CoinTrac AI Analyst user-facing routes (/v1/ai/*)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app.api.jwt_auth import AuthenticatedUser, require_verified_supabase_user
from app.services.ai_analyst import (
    AIChatRequest,
    AIChatResponse,
    AIStatusResponse,
    get_ai_analyst_service,
)

router = APIRouter(prefix="/v1/ai", tags=["CoinTrac AI"])


@router.get(
    "/status",
    response_model=AIStatusResponse,
    summary="CoinTrac AI Quota & Recent History",
    description=(
        "Returns the authenticated user's CoinTrac AI rate limits, remaining daily quota, "
        "and recent queries."
    ),
)
async def ai_status(
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> AIStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    return await get_ai_analyst_service().get_status(user.user_id)


@router.post(
    "/chat",
    response_model=AIChatResponse,
    summary="Query CoinTrac AI Analyst (Muse Spark 1.3)",
    description=(
        "Executes Muse Spark 1.3 with native tool calling over CoinTrac's deterministic "
        "market intelligence tools under per-user rate limits and daily quotas."
    ),
)
async def ai_chat(
    payload: AIChatRequest,
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
    x_cmc_api_key: str | None = Header(default=None, include_in_schema=False),
) -> AIChatResponse:
    response.headers["Cache-Control"] = "no-store"
    byok = (
        x_cmc_api_key.strip() if isinstance(x_cmc_api_key, str) and x_cmc_api_key.strip() else None
    )
    result, err = await get_ai_analyst_service().chat(
        user_id=user.user_id,
        request=payload,
        byok_cmc_key=byok,
    )
    if err is not None:
        status_code, detail, headers = err
        raise HTTPException(status_code=status_code, detail=detail, headers=headers)
    assert result is not None
    return result
