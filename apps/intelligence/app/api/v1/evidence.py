import asyncio
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path

from app.api.deps import AuthContext, require_api_key

router = APIRouter(
    prefix="/v1/evidence",
    tags=["Evidence"],
)

_LIST_COLUMNS = (
    "evidence_id,tool_name,asset_cmc_ids,endpoints_called,"
    "data_mode,freshness,credit_cost,engine_version,limitations,created_at"
)
_LIST_TTL_SECONDS = 5.0
_DETAIL_TTL_SECONDS = 60.0

_list_cache: dict[str, tuple[float, list[dict[str, object]]]] = {}
_detail_cache: dict[tuple[str, str], tuple[float, dict[str, object]]] = {}


def invalidate_evidence_cache() -> None:
    _list_cache.clear()
    _detail_cache.clear()


@router.get(
    "",
    summary="List Recent Evidence Records",
    description=(
        "Returns the 50 most recent persisted CoinMarketCap provenance rows "
        "(lean projection without raw_excerpt)."
    ),
)
async def list_evidence(auth: AuthContext = Depends(require_api_key)) -> dict[str, object]:
    if not auth.scoped or not auth.user_id:
        return {"records": []}
    now = time.monotonic()
    cached = _list_cache.get(auth.user_id)
    if cached is not None and cached[0] > now:
        return {"records": cached[1]}
    rows = await _rows(owner_id=auth.user_id, limit=50, include_excerpt=False)
    _list_cache[auth.user_id] = (now + _LIST_TTL_SECONDS, rows)
    return {"records": rows}


@router.get(
    "/{evidence_id}",
    summary="Inspect Full Evidence Record",
    description=(
        "Returns the complete immutable provenance record by evidence_id, "
        "including methodology, limitations, and sanitized raw CMC JSON excerpt."
    ),
)
async def read_evidence(
    evidence_id: str = Path(
        pattern=r"^ev_[A-Za-z0-9_-]{4,40}$",
        description="Evidence record identifier (e.g. ev_41376eb4ea)",
    ),
    auth: AuthContext = Depends(require_api_key),
) -> dict[str, object]:
    if not auth.scoped or not auth.user_id:
        raise HTTPException(status_code=404, detail="Evidence was not found")
    now = time.monotonic()
    cache_key = (auth.user_id, evidence_id)
    cached = _detail_cache.get(cache_key)
    if cached is not None and cached[0] > now:
        return cached[1]
    rows = await _rows(
        owner_id=auth.user_id,
        evidence_id=evidence_id,
        limit=1,
        include_excerpt=True,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Evidence was not found")
    record = rows[0]
    if len(_detail_cache) > 200:
        _detail_cache.clear()
    _detail_cache[cache_key] = (now + _DETAIL_TTL_SECONDS, record)
    return record


async def _rows(
    owner_id: str,
    evidence_id: str | None = None,
    limit: int = 50,
    include_excerpt: bool = True,
) -> list[dict[str, object]]:
    if not owner_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from app.core.db import supabase_client

    columns = "*" if include_excerpt else _LIST_COLUMNS

    def read() -> list[dict[str, object]]:
        query = supabase_client().table("evidence_records").select(columns).eq("user_id", owner_id)
        if evidence_id is not None:
            query = query.eq("evidence_id", evidence_id)
        response = query.order("created_at", desc=True).limit(limit).execute()
        return [_public_row(row) for row in response.data or []]

    try:
        return await asyncio.to_thread(read)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Evidence store is unavailable") from exc


def _public_row(row: dict[str, Any]) -> dict[str, object]:
    hidden = {"api_key", "key_hash"}
    public: dict[str, object] = {key: value for key, value in row.items() if key not in hidden}
    methodology = public.get("methodology")
    limitations = public.get("limitations")
    actual_mode = methodology.get("actual_data_mode") if isinstance(methodology, dict) else None
    no_payload = (
        public.get("credit_cost") == 0
        and isinstance(limitations, list)
        and "No CoinMarketCap payload was available." in limitations
    )
    if actual_mode == "UNAVAILABLE" or no_payload:
        public["data_mode"] = "UNAVAILABLE"
    return public
