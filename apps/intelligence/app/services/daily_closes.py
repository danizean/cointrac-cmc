"""Observed daily asset reference closes warehouse (`daily_asset_closes`).

The first observation stored for a canonical `cmc_id` and UTC date is immutable.
Later snapshots for that key are ignored. The UTC date comes from the CMC quote
or status timestamp when that timestamp exists, and `retrieved_at` is stored
separately. Nothing is backfilled. These rows are observed listing references,
not official CoinMarketCap OHLCV closes.
"""

from __future__ import annotations

import asyncio
import logging
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from app.adapters.cache import SnapshotStore, StoredSnapshot, cache_key, parse_timestamp
from app.adapters.normalizer import as_float, listing_rows, quote_of

logger = logging.getLogger("cointrac.daily_closes")

DAILY_CLOSE_SOURCE = "cmc_listings_snapshot_observed_reference"
MIN_WAREHOUSE_DAYS = 30
TOP_200_LISTINGS_ENDPOINT = "/v1/cryptocurrency/listings/latest"


@dataclass(frozen=True)
class DailyCloseRow:
    cmc_id: int
    utc_date: date
    close_price: float
    market_cap: float | None
    volume_24h: float | None
    source: str = DAILY_CLOSE_SOURCE
    observed_at: datetime | None = None
    source_timestamp: datetime | None = None
    retrieved_at: datetime | None = None


@dataclass(frozen=True)
class DailyCloseCaptureResult:
    utc_date: date
    rows_written: int
    used_existing_snapshot: bool
    skipped_existing_date: bool
    source_timestamp: datetime | None = None
    observed_at: datetime | None = None


class DailyCloseStore(Protocol):
    async def upsert_many(self, rows: Sequence[DailyCloseRow]) -> int: ...

    async def has_date(self, utc_date: date) -> bool: ...

    async def list_asset_closes(self, cmc_id: int, limit: int = 90) -> list[DailyCloseRow]: ...


class MemoryDailyCloseStore:
    def __init__(self, initial_rows: Sequence[DailyCloseRow] = ()) -> None:
        self._rows: dict[tuple[int, date], DailyCloseRow] = {
            (row.cmc_id, row.utc_date): row for row in initial_rows
        }

    @property
    def all_rows(self) -> list[DailyCloseRow]:
        return list(self._rows.values())

    async def upsert_many(self, rows: Sequence[DailyCloseRow]) -> int:
        """Insert missing keys only. An existing (cmc_id, utc_date) is left unchanged."""
        count = 0
        for row in rows:
            if row.cmc_id <= 0 or not math.isfinite(row.close_price) or row.close_price <= 0:
                continue
            key = (row.cmc_id, row.utc_date)
            if key in self._rows:
                continue
            self._rows[key] = row
            count += 1
        return count

    async def has_date(self, utc_date: date) -> bool:
        return any(key[1] == utc_date for key in self._rows)

    async def list_asset_closes(self, cmc_id: int, limit: int = 90) -> list[DailyCloseRow]:
        matched = [row for (cid, _day), row in self._rows.items() if cid == cmc_id]
        matched.sort(key=lambda row: row.utc_date)
        if limit > 0 and len(matched) > limit:
            return matched[-limit:]
        return matched


class SupabaseDailyCloseStore:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _table(self) -> Any:
        if self._client is not None:
            return self._client.table("daily_asset_closes")
        from app.core.db import supabase_client

        return supabase_client().table("daily_asset_closes")

    async def upsert_many(self, rows: Sequence[DailyCloseRow]) -> int:
        payload: list[dict[str, object]] = []
        for row in rows:
            if row.cmc_id <= 0 or not math.isfinite(row.close_price) or row.close_price <= 0:
                continue
            obs = (row.observed_at or datetime.now(UTC)).astimezone(UTC)
            source_ts = (row.source_timestamp or obs).astimezone(UTC)
            retrieved = (row.retrieved_at or obs).astimezone(UTC)
            payload.append(
                {
                    "cmc_id": row.cmc_id,
                    "utc_date": row.utc_date.isoformat(),
                    "close_price": row.close_price,
                    "market_cap": row.market_cap,
                    "volume_24h": row.volume_24h,
                    "source": row.source,
                    "observed_at": obs.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "source_timestamp": source_ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "retrieved_at": retrieved.strftime("%Y-%m-%dT%H:%M:%SZ"),
                }
            )
        if not payload:
            return 0

        def write() -> int:
            written = 0
            by_day: dict[str, list[dict[str, object]]] = {}
            for item in payload:
                by_day.setdefault(str(item["utc_date"]), []).append(item)
            for day, items in by_day.items():
                existing = self._table().select("cmc_id").eq("utc_date", day).execute()
                have = {
                    int(raw["cmc_id"])
                    for raw in (existing.data or [])
                    if isinstance(raw, dict) and isinstance(raw.get("cmc_id"), int)
                }
                missing = [item for item in items if item["cmc_id"] not in have]
                if not missing:
                    continue
                self._table().insert(missing).execute()
                written += len(missing)
            return written

        return await asyncio.to_thread(write)

    async def has_date(self, utc_date: date) -> bool:
        iso = utc_date.isoformat()

        def read() -> bool:
            resp = self._table().select("cmc_id").eq("utc_date", iso).limit(1).execute()
            return bool(resp.data)

        try:
            return await asyncio.to_thread(read)
        except Exception as exc:
            logger.warning("daily_asset_closes has_date failed (%s)", exc.__class__.__name__)
            return False

    async def list_asset_closes(self, cmc_id: int, limit: int = 90) -> list[DailyCloseRow]:
        def read() -> list[DailyCloseRow]:
            resp = (
                self._table()
                .select(
                    "cmc_id,utc_date,close_price,market_cap,volume_24h,source,"
                    "observed_at,source_timestamp,retrieved_at"
                )
                .eq("cmc_id", cmc_id)
                .order("utc_date", desc=True)
                .limit(limit)
                .execute()
            )
            out: list[DailyCloseRow] = []
            for raw in resp.data or []:
                if not isinstance(raw, dict):
                    continue
                row = _row_from_db(raw)
                if row is not None:
                    out.append(row)
            out.sort(key=lambda item: item.utc_date)
            return out

        try:
            return await asyncio.to_thread(read)
        except Exception as exc:
            logger.warning("daily_asset_closes read failed (%s)", exc.__class__.__name__)
            return []


def _as_utc(value: datetime) -> datetime:
    return value.astimezone(UTC) if value.tzinfo else value.replace(tzinfo=UTC)


def extract_daily_closes_from_listings(
    payload: dict[str, object],
    *,
    utc_date: date,
    observed_at: datetime,
    retrieved_at: datetime | None = None,
    quote_currency: str = "USD",
    source: str = DAILY_CLOSE_SOURCE,
) -> list[DailyCloseRow]:
    """Extract observed reference closes. The UTC date follows the quote timestamp."""
    deduped: dict[int, DailyCloseRow] = {}
    obs_utc = _as_utc(observed_at)
    retrieved = _as_utc(retrieved_at or observed_at)
    status = payload.get("status")
    status_ts = parse_timestamp(status.get("timestamp")) if isinstance(status, dict) else None
    for row in listing_rows(payload):
        cmc_id = row.get("id")
        if not isinstance(cmc_id, int) or isinstance(cmc_id, bool) or cmc_id <= 0:
            continue
        quote = quote_of(row, quote_currency)
        price = as_float(quote.get("price"))
        if price is None or price <= 0:
            continue
        market_cap = as_float(quote.get("market_cap"))
        if market_cap is not None and market_cap < 0:
            market_cap = None
        volume_24h = as_float(quote.get("volume_24h"))
        if volume_24h is not None and volume_24h < 0:
            volume_24h = None
        quote_ts = parse_timestamp(quote.get("last_updated")) or status_ts or obs_utc
        quote_ts = _as_utc(quote_ts)
        deduped[cmc_id] = DailyCloseRow(
            cmc_id=cmc_id,
            utc_date=quote_ts.date(),
            close_price=price,
            market_cap=market_cap,
            volume_24h=volume_24h,
            source=source,
            observed_at=quote_ts,
            source_timestamp=quote_ts,
            retrieved_at=retrieved,
        )
    if not deduped and utc_date:
        return []
    return list(deduped.values())


def snapshot_source_date(snapshot: StoredSnapshot) -> date:
    stamp = snapshot.source_timestamp or snapshot.retrieved_at
    return _as_utc(stamp).date()


async def find_listings_snapshot_for_date(
    snapshot_store: SnapshotStore,
    target_date: date,
    *,
    quote_currency: str = "USD",
) -> StoredSnapshot | None:
    """Find an already-stored verified Top-200 listings snapshot for the requested UTC date."""
    params: dict[str, object] = {"start": 1, "limit": 200, "convert": quote_currency}
    candidates = await snapshot_store.list_endpoint(TOP_200_LISTINGS_ENDPOINT)
    exact = await snapshot_store.get_by_key(cache_key(TOP_200_LISTINGS_ENDPOINT, params))
    if exact is not None:
        candidates = [*candidates, exact]
    matching = [
        snap
        for snap in candidates
        if snap.is_verified_fallback
        and snapshot_source_date(snap) == target_date
        and str(snap.params_json.get("convert") or "USD").upper() == quote_currency.upper()
    ]
    if not matching:
        return None
    return min(matching, key=lambda snap: _as_utc(snap.source_timestamp or snap.retrieved_at))


async def capture_daily_closes_from_listings(
    *,
    snapshot_store: SnapshotStore,
    close_store: DailyCloseStore,
    now: datetime | None = None,
    quote_currency: str = "USD",
) -> DailyCloseCaptureResult:
    """Populate `daily_asset_closes` from an existing listings snapshot with zero new CMC calls."""
    current = _as_utc(now or datetime.now(UTC))
    target_date = current.date()
    snapshot = await find_listings_snapshot_for_date(
        snapshot_store,
        target_date,
        quote_currency=quote_currency,
    )
    if snapshot is None:
        yesterday = target_date - timedelta(days=1)
        if not await close_store.has_date(yesterday):
            snapshot = await find_listings_snapshot_for_date(
                snapshot_store,
                yesterday,
                quote_currency=quote_currency,
            )
            if snapshot is not None:
                target_date = yesterday
    if snapshot is None:
        return DailyCloseCaptureResult(
            utc_date=target_date,
            rows_written=0,
            used_existing_snapshot=False,
            skipped_existing_date=False,
        )

    source_timestamp = snapshot.source_timestamp or snapshot.retrieved_at
    already_stored = await close_store.has_date(target_date)
    rows = extract_daily_closes_from_listings(
        snapshot.payload,
        utc_date=target_date,
        observed_at=source_timestamp,
        retrieved_at=snapshot.retrieved_at,
        quote_currency=quote_currency,
    )
    written = await close_store.upsert_many(rows)
    return DailyCloseCaptureResult(
        utc_date=target_date,
        rows_written=written,
        used_existing_snapshot=True,
        skipped_existing_date=already_stored and written == 0,
        source_timestamp=snapshot.source_timestamp,
        observed_at=snapshot.retrieved_at,
    )


def _row_from_db(raw: dict[str, Any]) -> DailyCloseRow | None:
    cmc_id = raw.get("cmc_id")
    if not isinstance(cmc_id, int) or isinstance(cmc_id, bool) or cmc_id <= 0:
        return None
    raw_date = raw.get("utc_date")
    parsed_date: date | None = None
    if isinstance(raw_date, date) and not isinstance(raw_date, datetime):
        parsed_date = raw_date
    elif isinstance(raw_date, str):
        try:
            parsed_date = date.fromisoformat(raw_date[:10])
        except ValueError:
            parsed_date = None
    if parsed_date is None:
        return None
    close_price = as_float(raw.get("close_price"))
    if close_price is None or close_price <= 0:
        return None
    return DailyCloseRow(
        cmc_id=cmc_id,
        utc_date=parsed_date,
        close_price=close_price,
        market_cap=as_float(raw.get("market_cap")),
        volume_24h=as_float(raw.get("volume_24h")),
        source=str(raw.get("source") or DAILY_CLOSE_SOURCE),
        observed_at=parse_timestamp(raw.get("observed_at")),
        source_timestamp=parse_timestamp(raw.get("source_timestamp")),
        retrieved_at=parse_timestamp(raw.get("retrieved_at")),
    )
