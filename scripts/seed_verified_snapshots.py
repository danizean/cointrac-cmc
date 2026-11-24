"""Seed verified CoinMarketCap snapshots and canonical market_assets in Supabase.

Run while Startup-tier access is active so post-deadline Basic-tier fallback has
verified snapshots for the core demo universe (30 major assets + macro + 7 sectors).
Reads credentials from root .env via apps/intelligence config; never prints secrets.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
INTELLIGENCE_DIR = REPO_ROOT / "apps" / "intelligence"
if str(INTELLIGENCE_DIR) not in sys.path:
    sys.path.insert(0, str(INTELLIGENCE_DIR))

from app.adapters.cmc_client import CMCClient, CMCEndpointUnavailableError
from app.adapters.normalizer import choose_ids, listing_rows, map_rows
from app.core.config import get_settings
from app.core.db import supabase_client

MAJOR_SYMBOLS: tuple[str, ...] = (
    "BTC",
    "ETH",
    "SOL",
    "AVAX",
    "NEAR",
    "LINK",
    "AAVE",
    "UNI",
    "ARB",
    "OP",
    "SUI",
    "APT",
    "TAO",
    "FET",
    "RNDR",
    "ONDO",
    "PAXG",
    "MKR",
    "PENDLE",
    "INJ",
    "TIA",
    "SEI",
    "DOGE",
    "PEPE",
    "WIF",
    "IMX",
    "GALA",
    "TON",
    "ADA",
    "XRP",
)

DEMO_COMPARE_SYMBOLS: tuple[str, ...] = ("BTC", "SOL", "AVAX", "NEAR")
PAUSE_SECONDS = 0.35


def _asset_upsert_rows(rows: list[dict[str, Any]], now_iso: str) -> list[dict[str, Any]]:
    by_id: dict[int, dict[str, Any]] = {}
    for row in rows:
        cmc_id = row.get("id")
        symbol = str(row.get("symbol") or "").strip().upper()
        name = str(row.get("name") or symbol).strip()
        slug = str(row.get("slug") or symbol.lower()).strip()
        if not isinstance(cmc_id, int) or not symbol:
            continue
        rank = row.get("cmc_rank")
        if not isinstance(rank, int):
            rank = row.get("rank") if isinstance(row.get("rank"), int) else None
        raw_tags = row.get("tags")
        tags = [str(tag) for tag in raw_tags] if isinstance(raw_tags, list) else []
        by_id[cmc_id] = {
            "cmc_id": cmc_id,
            "symbol": symbol,
            "name": name,
            "slug": slug,
            "rank": rank,
            "tags": tags,
            "updated_at": now_iso,
        }
    return list(by_id.values())


async def _upsert_market_assets(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    now_iso = datetime.now(UTC).isoformat()
    records = _asset_upsert_rows(rows, now_iso)
    if not records:
        return 0

    def write() -> None:
        client = supabase_client()
        for start in range(0, len(records), 100):
            batch = records[start : start + 100]
            client.table("market_assets").upsert(batch, on_conflict="cmc_id").execute()

    await asyncio.to_thread(write)
    return len(records)


async def _load_sector_mappings() -> list[dict[str, Any]]:
    def read() -> list[dict[str, Any]]:
        response = supabase_client().table("sector_mappings").select("*").execute()
        return [row for row in (response.data or []) if isinstance(row, dict)]

    return await asyncio.to_thread(read)


async def seed() -> int:
    settings = get_settings()
    if not settings.cmc_api_key.get_secret_value().strip():
        print("CMC_API_KEY is missing in .env.", file=sys.stderr)
        return 1
    if not settings.supabase_url.strip() or not settings.supabase_service_role_key.get_secret_value().strip():
        print("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.", file=sys.stderr)
        return 1

    total_credits = 0
    cache_hits = 0
    fetched = 0
    unavailable: list[str] = []

    async def call(
        client: CMCClient,
        endpoint: str,
        params: dict[str, object],
        label: str,
    ) -> dict[str, object] | None:
        nonlocal total_credits, cache_hits, fetched
        try:
            payload, meta = await client.fetch(endpoint, params)
        except CMCEndpointUnavailableError as exc:
            unavailable.append(f"{label}: {exc.reason}")
            print(f"[SKIP]  {label:<42} {exc.reason}")
            return None
        total_credits += meta.credit_cost
        if meta.cache_hit:
            cache_hits += 1
        fetched += 1
        print(
            f"[OK]    {label:<42} mode={meta.data_mode:<10} "
            f"credits={meta.credit_cost} cache_hit={meta.cache_hit}"
        )
        await asyncio.sleep(PAUSE_SECONDS)
        return payload

    async with CMCClient(simulate_basic_tier=False) as client:
        # 1. Core macro + listings snapshots matching Overview, Screener, Anomalies, Sector Rotation
        await call(client, "/v1/global-metrics/quotes/latest", {"convert": "USD"}, "global-metrics/latest")
        await call(client, "/v3/fear-and-greed/latest", {}, "fear-and-greed/latest")
        await call(
            client,
            "/v1/cryptocurrency/listings/latest",
            {"start": 1, "limit": 50, "convert": "USD"},
            "listings/latest (top 50)",
        )
        await call(
            client,
            "/v1/cryptocurrency/listings/latest",
            {"start": 1, "limit": 150, "convert": "USD"},
            "listings/latest (top 150)",
        )
        listings_200 = await call(
            client,
            "/v1/cryptocurrency/listings/latest",
            {"start": 1, "limit": 200, "convert": "USD"},
            "listings/latest (top 200)",
        )

        # 2. Seed market_assets from top-200 listings + resolve all 30 major demo symbols
        rows_200 = listing_rows(listings_200 or {})
        upserted = await _upsert_market_assets(rows_200)
        print(f"[DB]    market_assets upserted from listings: {upserted}")

        listing_candidates = map_rows(listings_200 or {})
        resolved = choose_ids(list(MAJOR_SYMBOLS), listing_candidates)
        missing_symbols = [sym for sym in MAJOR_SYMBOLS if sym not in resolved.ids]

        if missing_symbols:
            map_payload = await call(
                client,
                "/v1/cryptocurrency/map",
                {"symbol": ",".join(missing_symbols)},
                f"map ({len(missing_symbols)} missing symbols)",
            )
            map_list = listing_rows(map_payload or {})
            extra_upserted = await _upsert_market_assets(map_list)
            print(f"[DB]    market_assets upserted from map: {extra_upserted}")
            extra = choose_ids(missing_symbols, map_rows(map_payload or {}))
            resolved.ids.update(extra.ids)

        ordered_ids = sorted(set(resolved.ids.values()))
        print(f"[INFO]  Resolved {len(resolved.ids)}/{len(MAJOR_SYMBOLS)} major symbols -> {len(ordered_ids)} canonical cmc_ids")

        # 3. Verify all 7 sectors in sector_mappings and seed categories snapshot
        sectors = await _load_sector_mappings()
        print(f"[DB]    sector_mappings present: {len(sectors)} ({', '.join(str(s.get('sector_slug')) for s in sectors)})")
        await call(
            client,
            "/v1/cryptocurrency/categories",
            {"start": 1, "limit": 50},
            "categories (top 50)",
        )
        for sector in sectors:
            category_id = sector.get("cmc_category_id")
            if isinstance(category_id, str) and category_id.strip():
                await call(
                    client,
                    "/v1/cryptocurrency/category",
                    {"id": category_id.strip(), "limit": 100, "convert": "USD"},
                    f"category ({sector.get('sector_slug')})",
                )

        # 4. Seed quotes/latest + info for all 30 major assets (batch) and demo compare preset
        if ordered_ids:
            id_csv = ",".join(str(cid) for cid in ordered_ids)
            await call(
                client,
                "/v2/cryptocurrency/quotes/latest",
                {"id": id_csv, "convert": "USD"},
                f"quotes/latest ({len(ordered_ids)} major assets)",
            )
            await call(
                client,
                "/v2/cryptocurrency/info",
                {"id": id_csv},
                f"info ({len(ordered_ids)} major assets)",
            )

        demo_ids = sorted({resolved.ids[s] for s in DEMO_COMPARE_SYMBOLS if s in resolved.ids})
        if demo_ids:
            await call(
                client,
                "/v2/cryptocurrency/quotes/latest",
                {"id": ",".join(str(cid) for cid in demo_ids), "convert": "USD"},
                "quotes/latest (SOL/AVAX/NEAR/BTC preset)",
            )

        # 5. Seed 30d daily OHLCV historical snapshots for all 30 major assets (Startup-only fallback)
        ohlcv_ok = 0
        ohlcv_blocked = False
        for symbol in MAJOR_SYMBOLS:
            cmc_id = resolved.ids.get(symbol)
            if cmc_id is None:
                continue
            payload = await call(
                client,
                "/v2/cryptocurrency/ohlcv/historical",
                {"id": cmc_id, "count": 30, "interval": "daily", "convert": "USD"},
                f"ohlcv/historical 30d ({symbol} #{cmc_id})",
            )
            if payload is not None:
                ohlcv_ok += 1
            elif unavailable and "1006" in unavailable[-1]:
                ohlcv_blocked = True
                print("[INFO]  OHLCV endpoint returned plan restriction (1006); stopping remaining OHLCV calls.")
                break

        # 6. Seed price-performance-stats for BTC, ETH, SOL when available
        if not ohlcv_blocked:
            for symbol in ("BTC", "ETH", "SOL"):
                cmc_id = resolved.ids.get(symbol)
                if cmc_id is None:
                    continue
                res = await call(
                    client,
                    "/v2/cryptocurrency/price-performance-stats/latest",
                    {"id": str(cmc_id)},
                    f"price-performance-stats ({symbol} #{cmc_id})",
                )
                if res is None and unavailable and "1006" in unavailable[-1]:
                    break

    print("\n=== Verified Snapshot Seed Summary ===")
    print(f"Snapshots fetched/verified : {fetched} (cache hits: {cache_hits})")
    print(f"OHLCV 30d seeded assets    : {ohlcv_ok}/{len(resolved.ids)}")
    print(f"Total CMC credits used     : {total_credits}")
    if unavailable:
        print(f"Unavailable/tier-restricted: {len(unavailable)}")
        for note in unavailable[:10]:
            print(f"  - {note}")
    return 0


def main() -> int:
    return asyncio.run(seed())


if __name__ == "__main__":
    raise SystemExit(main())
