"""REST API endpoints for CoinTrac Hidden Gem Discovery Engine."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query, Response, status

from app.api.deps import AuthContext, require_api_key
from app.schemas.hidden_gems import (
    AlertEventItem,
    CandidateDetail,
    CandidateSummary,
    CreateScanRequest,
    QualityStatsRow,
    RejectionSummary,
    ScanAcceptedResponse,
    ScanConfigCreate,
    ScanConfigItem,
    ScanConfigUpdate,
    ScanRunSummary,
    WatchlistAddRequest,
    WatchlistItem,
)
from app.services.hidden_gems import get_hidden_gem_service

router = APIRouter(prefix="/v1/hidden-gems", tags=["Hidden Gems"])


def _require_scoped_user(auth: AuthContext) -> str:
    if not auth.scoped or not auth.user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account-scoped credentials or verified user session required.",
        )
    return auth.user_id


@router.post(
    "/scans",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=ScanAcceptedResponse,
    summary="Enqueue Hidden Gem Discovery Scan",
)
async def create_scan(
    body: CreateScanRequest,
    auth: AuthContext = Depends(require_api_key),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> ScanAcceptedResponse:
    user_id = _require_scoped_user(auth)
    service = get_hidden_gem_service()
    try:
        return await service.enqueue_scan(
            user_id=user_id,
            req=body,
            idempotency_key=idempotency_key.strip() if idempotency_key else None,
            override_cmc_key=auth.byok,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None


@router.get(
    "/scans",
    response_model=list[ScanRunSummary],
    summary="List User Hidden Gem Scan Runs",
)
async def list_scans(
    limit: int = Query(default=25, ge=1, le=100),
    auth: AuthContext = Depends(require_api_key),
) -> list[ScanRunSummary]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().list_scans(user_id, limit=limit)


def _require_valid_uuid(raw_id: str, label: str) -> str:
    try:
        return str(UUID(str(raw_id).strip()))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=f"{label} not found") from exc


@router.get(
    "/scans/{scan_run_id}",
    summary="Get Scan Run Detail & Rejections",
)
async def get_scan(
    scan_run_id: str = Path(..., min_length=1),
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    user_id = _require_scoped_user(auth)
    valid_id = _require_valid_uuid(scan_run_id, "Scan run")
    result = await get_hidden_gem_service().get_scan_detail(user_id, valid_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Scan run not found")
    run_summary, rejections = result
    return {
        "scan_run": run_summary.model_dump(),
        "rejections": [r.model_dump() for r in rejections],
    }


@router.post(
    "/scans/{scan_run_id}/cancel",
    response_model=ScanRunSummary,
    summary="Request Scan Run Cancellation",
)
async def cancel_scan(
    scan_run_id: str = Path(..., min_length=1),
    auth: AuthContext = Depends(require_api_key),
) -> ScanRunSummary:
    user_id = _require_scoped_user(auth)
    valid_id = _require_valid_uuid(scan_run_id, "Scan run")
    updated = await get_hidden_gem_service().cancel_scan(user_id, valid_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Scan run not found")
    return updated


@router.get(
    "/candidates",
    response_model=list[CandidateSummary],
    summary="List Hidden Gem Candidates",
)
async def list_candidates(
    track: str | None = Query(default=None, pattern="^(EARLY|CONFIRMED)$"),
    horizon: str | None = Query(default=None, pattern="^(SHORT_TERM|SWING)$"),
    min_score: float | None = Query(default=None, ge=0.0, le=100.0),
    confidence: str | None = Query(default=None, pattern="^(HIGH|MEDIUM|LOW|INSUFFICIENT)$"),
    classification: str | None = Query(default=None),
    eligibility: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(require_api_key),
) -> list[CandidateSummary]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().list_candidates(
        user_id,
        track=track,
        horizon=horizon,
        min_score=min_score,
        confidence=confidence,
        classification=classification,
        eligibility=eligibility,
        run_id=run_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/candidates/{candidate_id}",
    response_model=CandidateDetail,
    summary="Get Candidate Detail & Evidence",
)
async def get_candidate(
    candidate_id: str = Path(..., min_length=1),
    auth: AuthContext = Depends(require_api_key),
) -> CandidateDetail:
    user_id = _require_scoped_user(auth)
    valid_id = _require_valid_uuid(candidate_id, "Candidate")
    detail = await get_hidden_gem_service().get_candidate_detail(user_id, valid_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return detail


@router.get(
    "/configs",
    response_model=list[ScanConfigItem],
    summary="List Saved Hidden Gem Scan Configs",
)
async def list_configs(auth: AuthContext = Depends(require_api_key)) -> list[ScanConfigItem]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().list_configs(user_id)


@router.post(
    "/configs",
    status_code=status.HTTP_201_CREATED,
    response_model=ScanConfigItem,
    summary="Create Saved Hidden Gem Scan Config",
)
async def create_config(
    body: ScanConfigCreate,
    auth: AuthContext = Depends(require_api_key),
) -> ScanConfigItem:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().create_config(user_id, body)


@router.patch(
    "/configs/{config_id}",
    response_model=ScanConfigItem,
    summary="Update Saved Hidden Gem Scan Config",
)
async def update_config(
    body: ScanConfigUpdate,
    config_id: str = Path(..., min_length=1),
    auth: AuthContext = Depends(require_api_key),
) -> ScanConfigItem:
    user_id = _require_scoped_user(auth)
    updated = await get_hidden_gem_service().update_config(user_id, config_id, body)
    if updated is None:
        raise HTTPException(status_code=404, detail="Scan config not found")
    return updated


@router.get(
    "/watchlist",
    response_model=list[WatchlistItem],
    summary="List Hidden Gem Watchlist",
)
async def list_watchlist(auth: AuthContext = Depends(require_api_key)) -> list[WatchlistItem]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().list_watchlist(user_id)


@router.post(
    "/watchlist",
    status_code=status.HTTP_201_CREATED,
    response_model=WatchlistItem,
    summary="Add or Update Asset on Hidden Gem Watchlist",
)
async def add_watchlist(
    body: WatchlistAddRequest,
    auth: AuthContext = Depends(require_api_key),
) -> WatchlistItem:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().upsert_watchlist(user_id, body)


@router.delete(
    "/watchlist/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove Asset from Hidden Gem Watchlist",
)
async def delete_watchlist(
    item_id: str = Path(..., min_length=1),
    auth: AuthContext = Depends(require_api_key),
) -> Response:
    user_id = _require_scoped_user(auth)
    removed = await get_hidden_gem_service().delete_watchlist(user_id, item_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/alerts",
    response_model=list[AlertEventItem],
    summary="List Hidden Gem Alerts",
)
async def list_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    auth: AuthContext = Depends(require_api_key),
) -> list[AlertEventItem]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().list_alerts(user_id, limit=limit)


@router.get(
    "/quality-stats",
    response_model=list[QualityStatsRow],
    summary="Aggregate Discovery Forward Outcome Quality Metrics",
)
async def quality_stats(
    track: str | None = Query(default=None, pattern="^(EARLY|CONFIRMED)$"),
    score_version: str | None = Query(default=None),
    auth: AuthContext = Depends(require_api_key),
) -> list[QualityStatsRow]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().get_quality_stats(
        user_id,
        track=track,
        score_version=score_version,
    )


@router.post(
    "/outcomes/evaluate",
    summary="Evaluate Pending Forward Outcome Checkpoints",
)
async def evaluate_outcomes(
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, int]:
    _require_scoped_user(auth)
    evaluated = await get_hidden_gem_service().evaluate_outcome_checkpoints()
    return {"evaluated": evaluated}


@router.post(
    "/alerts/test-telegram",
    summary="Send Test Hidden Gem Alert to Telegram",
)
async def test_telegram_alert(
    chat_id: str | None = Query(default=None),
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    user_id = _require_scoped_user(auth)
    return await get_hidden_gem_service().send_test_telegram(user_id, chat_id=chat_id)


__all__ = ["RejectionSummary", "router"]
