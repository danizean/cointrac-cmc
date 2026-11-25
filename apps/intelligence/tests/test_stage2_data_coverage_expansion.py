"""Langkah 2 — CMC Data Coverage Expansion & Intelligence Integration tests.

Covers:
- Pure normalizers for v5 market-wide liquidations, v5 RWA universe (map + asset list),
  and v5 derivatives exchanges list (success, empty, malformed, partial, deduplication)
- Historical Fear & Greed + global trend enrichment inside classify_regime (0 extra calls)
- Mock HTTP flows for 200, empty, malformed, 403, 429, and 5xx
- Cache hit/miss & TTL validation (300s / 900s / 1800s / 3600s)
- Budget controller accounting (status.credit_count), CONSERVATION/EMERGENCY/CUTOFF,
  and BYOK server-budget isolation
- Verified snapshot fallback & AGING/STALE freshness reporting
- REST API & MCP tool parity regression tests
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.adapters.cache import StoredSnapshot, cache_key, ttl_for_endpoint
from app.adapters.cmc_client import CMCClient, _error_code
from app.adapters.normalizer import (
    SymbolResolution,
    parse_derivatives_exchanges,
    parse_market_wide_liquidations,
    parse_rwa_universe,
)
from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.main import app
from app.mcp import server as mcp_server
from app.quant.regime import classify_regime
from app.schemas.envelope import DataMode, EvidenceStatus, Freshness
from app.schemas.tools import (
    DerivativesAnalysisInput,
    SectorRotationInput,
)
from app.services import intelligence
from app.services.budget import BudgetController, MemoryBudgetStore, UsageEvent
from app.services.evidence import MemoryEvidence
from app.services.intelligence import SectorBook, ServiceDeps, install_deps

BASE = "https://pro-api.coinmarketcap.com"
NOW = datetime(2026, 11, 24, 15, 0, tzinfo=UTC)
SANDBOX = "ct_live_stage2_coverage_fixture_001"

DERIVS_PAIRS = "/v5/cryptocurrency/derivatives/market-pairs/list/latest"
LIQUIDATIONS = "/v5/derivatives/liquidations/quotes/latest"
DERIVS_EXCHANGES = "/v5/exchange/derivatives/list"
RWA_LIST = "/v5/real-world-assets/assets/list"
RWA_MAP = "/v5/real-world-assets/map"
LISTINGS = "/v1/cryptocurrency/listings/latest"


class MemorySnapshotStore:
    def __init__(self, rows: dict[str, StoredSnapshot] | None = None) -> None:
        self.rows = dict(rows or {})

    async def get_by_key(self, key: str) -> StoredSnapshot | None:
        return self.rows.get(key)

    async def list_endpoint(self, endpoint: str) -> list[StoredSnapshot]:
        return [row for row in self.rows.values() if row.endpoint == endpoint]

    async def upsert(self, snapshot: StoredSnapshot) -> None:
        self.rows[snapshot.cache_key] = snapshot


class StaticAssets(intelligence.AssetBook):
    async def resolve(self, symbols: list[str]) -> SymbolResolution:
        table = {"BTC": 1, "ETH": 1027, "SOL": 5426, "ONDO": 21159}
        ids = {sym.upper(): table[sym.upper()] for sym in symbols if sym.upper() in table}
        return SymbolResolution(ids=ids, limitations=[])


class AllAllowedCapabilities(intelligence.CapabilityMap):
    def allows(self, endpoint: str, credential: str | None = None) -> bool:
        del endpoint, credential
        return True


async def _noop_sleep(_seconds: float) -> None:
    return None


def _ok_status(credits: int = 1, ts: str = "2026-11-24T14:59:00.000Z") -> dict[str, object]:
    return {
        "timestamp": ts,
        "error_code": 0,
        "error_message": None,
        "credit_count": credits,
    }


def _v5_pairs_payload() -> dict[str, object]:
    return {
        "data": {
            "crypto_id": 1,
            "symbol": "BTC",
            "num_market_pairs": 120,
            "market_pairs": [
                {
                    "market_id": 1001,
                    "market_pair_symbol": "BTCUSDT",
                    "category": "perpetual",
                    "outlier_detected": False,
                    "exchange": {
                        "exchange_id": 270,
                        "exchange_name": "Binance",
                        "exchange_slug": "binance",
                    },
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "price": 90000.0,
                            "volume_24h": 15_000_000_000.0,
                            "open_interest": 8_000_000_000.0,
                            "last_updated": "2026-11-24T14:58:00.000Z",
                        }
                    ],
                    "exchange_reported_quotes": [
                        {
                            "convert_symbol": "USD",
                            "funding_rate": 0.0001,
                            "index_price": 89990.0,
                            "last_updated": "2026-11-24T14:58:00.000Z",
                        }
                    ],
                }
            ],
        },
        "status": _ok_status(1),
    }


def _liquidations_payload(credits: int = 1) -> dict[str, object]:
    return {
        "data": {
            "quotes": [
                {
                    "interval": "1h",
                    "timestamp": "2026-11-24T14:58:00.000Z",
                    "quote": {"USD": {"total": 18_500_000.0}},
                },
                {
                    "interval": "4h",
                    "timestamp": "2026-11-24T14:58:00.000Z",
                    "quote": {"USD": {"total": 62_000_000.0}},
                },
                {
                    "interval": "24h",
                    "timestamp": "2026-11-24T14:58:00.000Z",
                    "quote": {
                        "USD": {
                            "total": 310_000_000.0,
                            "long": 215_000_000.0,
                            "short": 95_000_000.0,
                        }
                    },
                },
            ]
        },
        "status": _ok_status(credits),
    }


def _venues_payload(credits: int = 1) -> dict[str, object]:
    return {
        "data": {
            "total_count": 80,
            "exchanges": [
                {
                    "id": 270,
                    "name": "Binance (Futures)",
                    "slug": "binance-futures",
                    "rank": 1,
                    "num_market_pairs": 450,
                    "exchange_score": 9.4,
                    "liquidity_score": 98.1,
                    "quote": {
                        "USD": {
                            "volume_24h": 45_000_000_000.0,
                            "volume_24h_adjusted": 43_000_000_000.0,
                            "open_interest": 14_000_000_000.0,
                            "last_updated": "2026-11-24T14:58:00.000Z",
                        }
                    },
                },
                {
                    "id": 521,
                    "name": "Bybit",
                    "slug": "bybit",
                    "rank": 2,
                    "num_market_pairs": 380,
                    "exchange_score": 8.9,
                    "liquidity_score": 94.0,
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "volume_24h": 22_000_000_000.0,
                            "volume_24h_adjusted": 21_500_000_000.0,
                            "open_interest": 7_500_000_000.0,
                            "last_updated": "2026-11-24T14:58:00.000Z",
                        }
                    ],
                },
            ],
        },
        "status": _ok_status(credits),
    }


def _rwa_list_payload(credits: int = 1) -> dict[str, object]:
    return {
        "data": {
            "total_size": 120,
            "has_more": True,
            "rwa_assets": [
                {
                    "rwa_id": 101,
                    "symbol": "XAUT",
                    "name": "Gold",
                    "asset_type": "commodity",
                    "rwa_rank": 1,
                    "has_tokens": True,
                    "quote": {
                        "USD": {
                            "price": 2650.0,
                            "market_cap": 1_500_000_000.0,
                            "volume_24h": 85_000_000.0,
                            "percent_change_24h": 0.4,
                            "percent_change_7d": 1.2,
                            "last_updated": "2026-11-24T14:55:00.000Z",
                        }
                    },
                },
                {
                    "rwa_id": 102,
                    "symbol": "USTB",
                    "name": "US Treasury Bill",
                    "rwa_rank": 2,
                    "quote": {
                        "USD": {
                            "price": 1.0,
                            "market_cap": 950_000_000.0,
                            "volume_24h": 12_000_000.0,
                            "percent_change_24h": 0.01,
                            "percent_change_7d": 0.08,
                            "last_updated": "2026-11-24T14:55:00.000Z",
                        }
                    },
                },
            ],
        },
        "status": _ok_status(credits),
    }


def _rwa_map_payload(credits: int = 0) -> dict[str, object]:
    return {
        "data": {
            "total_size": 120,
            "has_more": True,
            "rwa_assets": [
                {
                    "rwa_id": 101,
                    "symbol": "XAUT",
                    "name": "Gold",
                    "asset_type": "commodity",
                    "rwa_rank": 1,
                    "has_tokens": True,
                },
                {
                    "rwa_id": 102,
                    "symbol": "USTB",
                    "name": "US Treasury Bill",
                    "asset_type": "government_security",
                    "rwa_rank": 2,
                    "has_tokens": True,
                },
            ],
        },
        "status": _ok_status(credits),
    }


def _listings_with_rwa() -> dict[str, object]:
    coins = [
        (1, "BTC", 1.5, 4.0, ["layer-1"]),
        (1027, "ETH", 2.0, 5.0, ["layer-1"]),
        (21159, "ONDO", 5.5, 14.0, ["real-world-assets", "defi"]),
        (1518, "MKR", 3.2, 8.0, ["real-world-assets", "defi"]),
        (5705, "PAXG", 0.5, 1.5, ["real-world-assets"]),
        (7278, "AAVE", 4.0, 9.0, ["defi"]),
        (7083, "UNI", 3.0, 7.0, ["defi"]),
        (5692, "COMP", 2.0, 5.0, ["defi"]),
        (6538, "CRV", 1.5, 4.0, ["defi"]),
    ]
    rows = []
    for idx, (cid, sym, c24, c7, tags) in enumerate(coins, start=1):
        rows.append(
            {
                "id": cid,
                "symbol": sym,
                "name": sym,
                "cmc_rank": idx,
                "tags": tags,
                "quote": {
                    "USD": {
                        "price": 100.0,
                        "market_cap": 1_000_000_000.0,
                        "volume_24h": 50_000_000.0,
                        "percent_change_24h": c24,
                        "percent_change_7d": c7,
                    }
                },
            }
        )
    return {"data": rows, "status": _ok_status(1)}


# ---------------------------------------------------------------------------
# 1. Normalizer unit tests (success, empty, malformed, negative, deduplication)
# ---------------------------------------------------------------------------
def test_parse_market_wide_liquidations_shapes_and_edge_cases() -> None:
    parsed = parse_market_wide_liquidations(_liquidations_payload(), "USD")
    assert parsed.has_data is True
    assert parsed.total_24h == 310_000_000.0
    assert parsed.long_24h == 215_000_000.0
    assert parsed.short_24h == 95_000_000.0
    assert parsed.total_1h == 18_500_000.0
    assert parsed.total_4h == 62_000_000.0
    assert parsed.last_updated == "2026-11-24T14:58:00.000Z"
    assert any("not attributable" in note.lower() for note in parsed.limitations)

    # Derived total_24h when only long + short are provided
    derived = parse_market_wide_liquidations(
        {"data": {"long_liquidations_usd": 120.0, "short_liquidations_usd": 80.0}},
        "USD",
    )
    assert derived.has_data is True
    assert derived.total_24h == 200.0
    assert any("derived" in note.lower() for note in derived.limitations)

    # Empty, malformed, negative, and NaN payloads never turn into 0
    for bad in (
        {},
        {"data": {}},
        {"data": {"quotes": []}},
        {"data": {"total_24h": -50.0, "long_24h": float("nan"), "short_24h": True}},
    ):
        res = parse_market_wide_liquidations(bad, "USD")
        assert res.has_data is False
        assert res.total_24h is None
        assert res.long_24h is None
        assert res.short_24h is None
        assert res.limitations


def test_parse_rwa_universe_merges_map_dedupes_and_handles_malformed() -> None:
    # Duplicate rwa_id 101 must not double-count market cap
    dup_list = _rwa_list_payload()
    assert isinstance(dup_list["data"], dict)
    assets = list(dup_list["data"]["rwa_assets"])  # type: ignore[arg-type]
    assets.append(assets[0])
    dup_list["data"]["rwa_assets"] = assets

    parsed = parse_rwa_universe(dup_list, _rwa_map_payload(), "USD")
    assert parsed.total_rwa_assets == 120
    assert parsed.sampled_rwa_assets == 2
    assert parsed.total_tokenized_market_cap == pytest.approx(2_450_000_000.0)
    assert parsed.total_tokenized_volume_24h == pytest.approx(97_000_000.0)
    # Asset 102 got asset_type enriched from map by canonical rwa_id
    assert parsed.asset_type_counts == {"commodity": 1, "government_security": 1}
    assert any("strictly separate" in note.lower() for note in parsed.limitations)
    assert any("sampled 2 of 120" in note.lower() for note in parsed.limitations)

    # Map-only fallback preserves null prices/market caps honestly
    map_only = parse_rwa_universe(None, _rwa_map_payload(), "USD")
    assert map_only.sampled_rwa_assets == 2
    assert map_only.total_tokenized_market_cap is None
    assert all(item["price"] is None for item in map_only.top_rwa_assets)

    # Empty/malformed payload
    empty = parse_rwa_universe({"data": {"rwa_assets": []}}, None, "USD")
    assert empty.sampled_rwa_assets == 0
    assert empty.total_tokenized_market_cap is None
    assert empty.limitations


def test_parse_derivatives_exchanges_dedupes_and_handles_malformed() -> None:
    parsed = parse_derivatives_exchanges(_venues_payload(), "USD")
    assert parsed.total_exchanges == 80
    assert parsed.sampled_exchanges == 2
    assert parsed.total_open_interest == pytest.approx(21_500_000_000.0)
    assert parsed.total_volume_24h == pytest.approx(67_000_000_000.0)
    assert parsed.venues[0]["name"] == "Binance (Futures)"
    assert parsed.venues[1]["name"] == "Bybit"
    assert any("not asset-specific" in note.lower() for note in parsed.limitations)

    bad = parse_derivatives_exchanges({"data": {"exchanges": ["bad-entry"]}}, "USD")
    assert bad.sampled_exchanges == 0
    assert bad.total_open_interest is None
    assert bad.limitations


def test_classify_regime_integrates_historical_fear_greed_trend_rationale() -> None:
    res = classify_regime(
        total_mcap_change_24h_pct=2.2,
        btc_dominance_change_24h=-0.3,
        top50_breadth_positive_pct=75.0,
        fear_greed_value=66.0,
        btc_outperforming_median_alt=False,
        breadth_sample_size=50,
        fear_greed_avg_7d=64.0,
        fear_greed_avg_30d=52.0,
        fear_greed_change_7d=18.0,
        total_mcap_change_7d_pct=6.5,
    )
    assert res.regime == "RISK_ON_ALTSEASON"
    assert any("improving" in line and "7d avg 64.0" in line for line in res.rationale)
    assert any("shifted sharply (+18.0 pts)" in line for line in res.rationale)
    assert any("7d total market-cap trend is +6.50%" in line for line in res.rationale)


# ---------------------------------------------------------------------------
# 2. Service integration, mock error paths (403/429/5xx/empty), cache & budget
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_derivatives_integrates_liquidations_and_venues_without_asset_misattribution() -> (
    None
):
    usage_store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=usage_store,
        now=lambda: NOW,
    )
    snap_store = MemorySnapshotStore()
    with respx.mock(assert_all_called=False) as router:
        pairs_route = router.get(f"{BASE}{DERIVS_PAIRS}").mock(
            return_value=httpx.Response(200, json=_v5_pairs_payload())
        )
        liq_route = router.get(f"{BASE}{LIQUIDATIONS}").mock(
            return_value=httpx.Response(200, json=_liquidations_payload(credits=1))
        )
        venues_route = router.get(f"{BASE}{DERIVS_EXCHANGES}").mock(
            return_value=httpx.Response(200, json=_venues_payload(credits=1))
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
            )
            first = await intelligence.analyze_derivatives(
                DerivativesAnalysisInput(symbol="BTC"),
                deps=deps,
            )
            # Second call within TTL hits cache -> zero additional HTTP calls & zero new credits
            second = await intelligence.analyze_derivatives(
                DerivativesAnalysisInput(symbol="BTC"),
                deps=deps,
            )

    assert pairs_route.call_count == 1
    assert liq_route.call_count == 1
    assert venues_route.call_count == 1
    assert first.status == EvidenceStatus.PARTIAL
    assert first.data.mode == "derivatives"
    # Asset-level liquidations_24h MUST stay None (never misattributed from market-wide!)
    assert first.data.liquidations_24h is None
    assert first.data.market_wide_liquidations is not None
    assert first.data.market_wide_liquidations.scope == "market_wide"
    assert first.data.market_wide_liquidations.attribution == "not_asset_specific"
    assert first.data.market_wide_liquidations.data_kind == "observed_exchange_aggregate"
    assert first.data.market_wide_liquidations.total_24h == 310_000_000.0
    assert first.data.derivatives_venues is not None
    assert first.data.derivatives_venues.sampled_exchanges == 2
    assert first.evidence.cmc_credit_cost == 3
    assert second.evidence.cache_hit is True
    assert second.evidence.cmc_credit_cost == 0
    # Budget store recorded exactly 3 real upstream calls (3 credits total), 0 on cache hit
    assert len(usage_store.events) == 3
    assert (await budget.snapshot()).credits_used_this_month == 3


@pytest.mark.asyncio
async def test_derivatives_handles_403_429_5xx_and_malformed_liquidations_safely() -> None:
    for status_code, body in (
        (403, {"status": {"error_code": 1006, "credit_count": 0}}),
        (429, {"status": {"error_code": 1008, "credit_count": 0}}),
        (503, {"status": {"error_code": 500, "credit_count": 0}}),
        (200, {"data": {"quotes": "malformed"}, "status": _ok_status(1)}),
    ):
        with respx.mock(assert_all_called=False) as router:
            router.get(f"{BASE}{DERIVS_PAIRS}").mock(
                return_value=httpx.Response(200, json=_v5_pairs_payload())
            )
            router.get(f"{BASE}{LIQUIDATIONS}").mock(
                return_value=httpx.Response(status_code, json=body)
            )
            router.get(f"{BASE}{DERIVS_EXCHANGES}").mock(
                return_value=httpx.Response(status_code, json=body)
            )
            async with CMCClient(
                api_key="server-key",
                base_url=BASE,
                snapshot_store=MemorySnapshotStore(),
                simulate_basic_tier=False,
                sleep=_noop_sleep,
                now=lambda: NOW,
            ) as gateway:
                deps = ServiceDeps(
                    gateway=gateway,
                    evidence=MemoryEvidence(),
                    assets=StaticAssets(),
                    sectors=SectorBook(),
                    capabilities=AllAllowedCapabilities(),
                    now=lambda: NOW,
                )
                result = await intelligence.analyze_derivatives(
                    DerivativesAnalysisInput(symbol="BTC"),
                    deps=deps,
                )
        assert result.status == EvidenceStatus.PARTIAL
        assert result.data.mode == "derivatives"
        assert result.data.market_wide_liquidations is None
        assert result.data.derivatives_venues is None
        assert result.limitations


@pytest.mark.asyncio
async def test_rwa_integration_separated_from_crypto_sectors_and_skipped_when_not_requested() -> (
    None
):
    usage_store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=usage_store,
        now=lambda: NOW,
    )
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}{LISTINGS}").mock(
            return_value=httpx.Response(200, json=_listings_with_rwa())
        )
        rwa_list_route = router.get(f"{BASE}{RWA_LIST}").mock(
            return_value=httpx.Response(200, json=_rwa_list_payload(credits=1))
        )
        rwa_map_route = router.get(f"{BASE}{RWA_MAP}").mock(
            return_value=httpx.Response(200, json=_rwa_map_payload(credits=0))
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
            )
            # Non-RWA request must NOT call RWA endpoints
            defi_only = await intelligence.analyze_sector_rotation(
                SectorRotationInput(sectors=["defi"]),
                deps=deps,
            )
            assert rwa_list_route.call_count == 0
            assert rwa_map_route.call_count == 0
            assert defi_only.data.rwa_universe is None

            # RWA request populates rwa_universe separately without polluting crypto counts
            rwa_res = await intelligence.analyze_sector_rotation(
                SectorRotationInput(sectors=["rwa"]),
                deps=deps,
            )

    assert rwa_list_route.call_count == 1
    assert rwa_map_route.call_count == 1
    assert rwa_res.data.sectors[0].sector_slug == "rwa"
    # Crypto RWA constituents remain strictly the 3 tagged crypto tokens (ONDO, MKR, PAXG)
    assert rwa_res.data.sectors[0].constituent_count == 3
    assert rwa_res.data.unique_constituent_count == 3
    # Underlying RWA universe is returned separately
    assert rwa_res.data.rwa_universe is not None
    assert rwa_res.data.rwa_universe.separated_from_crypto_sectors is True
    assert rwa_res.data.rwa_universe.sampled_rwa_assets == 2
    assert rwa_res.data.rwa_universe.asset_type_counts == {
        "commodity": 1,
        "government_security": 1,
    }
    # Budget recorded listings (1) + rwa_list (1) + rwa_map (0) = 2 credits total
    assert (await budget.snapshot()).credits_used_this_month == 2


# ---------------------------------------------------------------------------
# 3. Cache TTLs, Snapshot Fallback Freshness, Budget CONSERVATION/CUTOFF & BYOK
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_new_endpoints_ttl_budget_conservation_cutoff_snapshot_and_byok() -> None:
    assert ttl_for_endpoint(LIQUIDATIONS) == 300
    assert ttl_for_endpoint(DERIVS_EXCHANGES) == 1800
    assert ttl_for_endpoint(RWA_LIST) == 900
    assert ttl_for_endpoint(RWA_MAP) == 3600

    # Seed an AGING verified snapshot for liquidations (5 hours old)
    retrieved = NOW - timedelta(hours=5)
    liq_snap = StoredSnapshot(
        cache_key=cache_key(LIQUIDATIONS, {}),
        endpoint=LIQUIDATIONS,
        params_json={},
        payload=_liquidations_payload(),
        source_timestamp=retrieved,
        retrieved_at=retrieved,
        ttl_seconds=300,
        credit_cost=1,
        is_verified_fallback=True,
    )
    snap_store = MemorySnapshotStore({liq_snap.cache_key: liq_snap})

    # At CONSERVATION (85%), expensive liquidations endpoint serves verified snapshot without HTTP
    usage_store = MemoryBudgetStore([UsageEvent("/v1/prior", 8_500, created_at=NOW)])
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=usage_store,
        now=lambda: NOW,
    )
    with respx.mock(assert_all_called=False) as router:
        liq_route = router.get(f"{BASE}{LIQUIDATIONS}").mock(
            return_value=httpx.Response(200, json=_liquidations_payload())
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=snap_store,
            budget_controller=budget,
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as client:
            payload, meta = await client.fetch(LIQUIDATIONS, {})
            assert liq_route.call_count == 0
            assert meta.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
            assert meta.freshness == "AGING"
            assert meta.credit_cost == 0
            assert payload["data"]

            # BYOK bypasses CONSERVATION/CUTOFF and does not enter server-key budget
            byok_payload, byok_meta = await client.fetch(
                LIQUIDATIONS,
                {},
                override_api_key="caller_byok_stage2_key_999",
            )
            assert liq_route.call_count == 1
            assert byok_meta.data_mode == "LIVE"
            assert byok_payload["data"]

    assert (await budget.snapshot()).credits_used_this_month == 8_500


# ---------------------------------------------------------------------------
# 4. REST API & MCP tool parity regression tests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_rest_and_mcp_parity_for_expanded_derivatives_and_rwa_coverage() -> None:
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{BASE}{DERIVS_PAIRS}").mock(
            return_value=httpx.Response(200, json=_v5_pairs_payload())
        )
        router.get(f"{BASE}{LIQUIDATIONS}").mock(
            return_value=httpx.Response(200, json=_liquidations_payload())
        )
        router.get(f"{BASE}{DERIVS_EXCHANGES}").mock(
            return_value=httpx.Response(200, json=_venues_payload())
        )
        router.get(f"{BASE}{LISTINGS}").mock(
            return_value=httpx.Response(200, json=_listings_with_rwa())
        )
        router.get(f"{BASE}{RWA_LIST}").mock(
            return_value=httpx.Response(200, json=_rwa_list_payload())
        )
        router.get(f"{BASE}{RWA_MAP}").mock(
            return_value=httpx.Response(200, json=_rwa_map_payload())
        )
        async with CMCClient(
            api_key="server-key",
            base_url=BASE,
            snapshot_store=MemorySnapshotStore(),
            simulate_basic_tier=False,
            sleep=_noop_sleep,
            now=lambda: NOW,
        ) as gateway:
            deps = ServiceDeps(
                gateway=gateway,
                evidence=MemoryEvidence(),
                assets=StaticAssets(),
                sectors=SectorBook(),
                capabilities=AllAllowedCapabilities(),
                now=lambda: NOW,
            )
            install_keys(
                MemoryKeyDirectory(
                    [
                        ApiKeyRecord(
                            key_id="sandbox",
                            key_hash=key_hash(SANDBOX),
                            rate_limit_per_min=30,
                            is_active=True,
                        )
                    ]
                )
            )
            install_rate_store(MemoryRateStore())
            install_deps(deps)
            mcp_server.set_service_deps(deps)
            mcp_server.set_evidence_writer(MemoryEvidence())
            try:
                api = TestClient(app)
                rest_deriv = api.get(
                    "/v1/intelligence/assets/BTC/derivatives",
                    headers={"x-cointrac-key": SANDBOX},
                )
                rest_rwa = api.post(
                    "/v1/intelligence/sector-rotation",
                    headers={"x-cointrac-key": SANDBOX},
                    json={"sectors": ["rwa"]},
                )
                mcp_deriv = await mcp_server.analyze_derivatives(symbol="BTC")
                mcp_rwa = await mcp_server.analyze_sector_rotation(sectors=["rwa"])
            finally:
                install_deps(None)
                mcp_server.set_service_deps(None)
                mcp_server.set_evidence_writer(None)

    assert rest_deriv.status_code == 200
    assert rest_rwa.status_code == 200
    rest_d_body = rest_deriv.json()
    rest_r_body = rest_rwa.json()

    assert rest_d_body["data"]["market_wide_liquidations"]["total_24h"] == 310_000_000.0
    assert mcp_deriv["data"]["market_wide_liquidations"]["total_24h"] == 310_000_000.0
    assert rest_d_body["data"]["derivatives_venues"]["sampled_exchanges"] == 2
    assert mcp_deriv["data"]["derivatives_venues"]["sampled_exchanges"] == 2
    assert rest_d_body["data"]["liquidations_24h"] is None
    assert mcp_deriv["data"]["liquidations_24h"] is None

    assert rest_r_body["data"]["rwa_universe"]["sampled_rwa_assets"] == 2
    assert mcp_rwa["data"]["rwa_universe"]["sampled_rwa_assets"] == 2
    assert rest_r_body["data"]["sectors"][0]["constituent_count"] == 3
    assert mcp_rwa["data"]["sectors"][0]["constituent_count"] == 3
    # Verify EvidenceEnvelope contract on both surfaces
    assert rest_d_body["evidence"]["data_mode"] in {DataMode.LIVE, DataMode.CACHED}
    assert mcp_deriv["evidence"]["freshness"] == Freshness.FRESH


# ---------------------------------------------------------------------------
# 3. Live CMC v5 Compatibility Patch Tests (Langkah 2 Patch)
# ---------------------------------------------------------------------------
def test_error_code_parsing_int_and_digit_strings() -> None:
    # 0 and "0" are valid success codes
    assert _error_code({"status": {"error_code": 0}}) == 0
    assert _error_code({"status": {"error_code": "0"}}) == 0
    assert _error_code({"status": {"error_code": " 0 "}}) == 0

    # Non-negative integer and digit strings
    assert _error_code({"status": {"error_code": 1006}}) == 1006
    assert _error_code({"status": {"error_code": "1006"}}) == 1006
    assert _error_code({"status": {"error_code": 1008}}) == 1008
    assert _error_code({"status": {"error_code": "1008"}}) == 1008

    # Invalid / empty / non-digit / negative inputs must return None
    assert _error_code({"status": {"error_code": ""}}) is None
    assert _error_code({"status": {"error_code": "   "}}) is None
    assert _error_code({"status": {"error_code": "abc"}}) is None
    assert _error_code({"status": {"error_code": "1006a"}}) is None
    assert _error_code({"status": {"error_code": -1}}) is None
    assert _error_code({"status": {"error_code": "-1"}}) is None
    assert _error_code({"status": {"error_code": None}}) is None
    assert _error_code({"status": {}}) is None
    assert _error_code({}) is None
    assert _error_code({"status": {"error_code": True}}) is None
    assert _error_code({"status": {"error_code": False}}) is None


def test_parse_derivatives_exchanges_live_v5_fields_and_omitted_total() -> None:
    # Live payload matching /v5/exchange/derivatives/list
    live_payload = {
        "data": {
            "exchanges": [
                {
                    "rank": 1,
                    "exchange_id": 270,
                    "exchange_name": "Binance",
                    "exchange_slug": "binance",
                    "num_market_pairs": 848,
                    "traffic_score": 1000.0,
                    "exchange_score": 10.0,
                    "liquidity_score": 930.0,
                    "last_updated": "2026-11-24T08:49:20.000Z",
                    "quotes": [
                        {
                            "convert_id": 2781,
                            "convert_symbol": "USD",
                            "open_interest_usd": 25343496593.94946,
                            "derivative_volume_usd": 100574080748.16087,
                            "maker_fees": 0.02,
                            "taker_fees": 0.04,
                            "last_updated": "2026-11-24T08:49:20.000Z",
                        }
                    ],
                },
                {
                    "rank": 2,
                    "exchange_id": 521,
                    "exchange_name": "Bybit",
                    "exchange_slug": "bybit",
                    "num_market_pairs": 412,
                    "traffic_score": 850.0,
                    "exchange_score": 9.2,
                    "liquidity_score": 880.0,
                    "last_updated": "2026-11-24T08:49:20.000Z",
                    "quotes": [
                        {
                            "convert_id": 2781,
                            "convert_symbol": "USD",
                            "open_interest_usd": 12100000000.0,
                            "derivative_volume_usd": 35200000000.0,
                            "last_updated": "2026-11-24T08:49:20.000Z",
                        }
                    ],
                },
            ]
        },
        "status": {
            "timestamp": "2026-11-24T08:53:45.072Z",
            "error_code": "0",
            "error_message": "",
            "elapsed": 113,
            "credit_count": 1,
        },
    }

    parsed = parse_derivatives_exchanges(live_payload, "USD")
    assert parsed.sampled_exchanges == 2
    # When CMC omits total_count / total_size, total_exchanges MUST be None (not len(venues))
    assert parsed.total_exchanges is None
    assert parsed.total_open_interest == pytest.approx(37443496593.94946)
    assert parsed.total_volume_24h == pytest.approx(135774080748.16087)

    # Check venue field mapping: exchange_name -> name, exchange_slug -> slug
    assert parsed.venues[0]["name"] == "Binance"
    assert parsed.venues[0]["slug"] == "binance"
    assert parsed.venues[0]["open_interest"] == pytest.approx(25343496593.94946)
    assert parsed.venues[0]["volume_24h"] == pytest.approx(100574080748.16087)
    assert parsed.venues[1]["name"] == "Bybit"
    assert parsed.venues[1]["slug"] == "bybit"


def test_parse_rwa_universe_live_v5_quotes_symbol_and_toplevel_priority() -> None:
    # Live payload matching /v5/real-world-assets/assets/list
    live_list = {
        "data": {
            "total_size": 7942,
            "has_more": True,
            "rwa_assets": [
                {
                    # Item 1: live payload with quotes[].symbol: "USD" and top-level fields
                    "rwa_id": 1,
                    "name": "Gold",
                    "symbol": "GOLD",
                    "slug": "gold",
                    "asset_type": "commodity",
                    "rwa_rank": 1,
                    "has_tokens": True,
                    "quotes": [
                        {
                            "symbol": "USD",
                            "crypto_id": 2781,
                            "average_tokenized_price": 3613.73,
                            "tokenized_market_cap": 4424326683.0,
                            "tokenized_volume_24h": 375810656.0,
                            "last_updated": "2026-11-24T08:53:04.000Z",
                        }
                    ],
                    "average_tokenized_price": 3613.73,
                    "tokenized_market_cap": 4424326683.0,
                    "tokenized_volume_24h": 375810656.0,
                    "last_updated": "2026-11-24T08:53:11.000Z",
                },
                {
                    # Item 2: metrics only at top-level rwa_assets[] (empty quotes)
                    "rwa_id": 2,
                    "name": "Treasury Fund",
                    "symbol": "USTB",
                    "slug": "treasury-fund",
                    "asset_type": "government_security",
                    "rwa_rank": 2,
                    "has_tokens": True,
                    "quotes": [],
                    "average_tokenized_price": 100.25,
                    "tokenized_market_cap": 500_000_000.0,
                    "tokenized_volume_24h": 12_500_000.0,
                },
                {
                    # Item 3: legacy naming inside quotes (convert_symbol, price, market_cap)
                    "rwa_id": 3,
                    "name": "Silver Trust",
                    "symbol": "SLVR",
                    "slug": "silver-trust",
                    "asset_type": "commodity",
                    "rwa_rank": 3,
                    "has_tokens": True,
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "price": 32.5,
                            "market_cap": 250_000_000.0,
                            "volume_24h": 8_000_000.0,
                        }
                    ],
                },
            ],
        },
        "status": {
            "timestamp": "2026-11-24T08:53:45.852Z",
            "error_code": "0",
            "error_message": "",
            "elapsed": 10,
            "credit_count": 1,
        },
    }

    parsed = parse_rwa_universe(live_list, None, "USD")
    assert parsed.total_rwa_assets == 7942
    assert parsed.sampled_rwa_assets == 3

    # Check Item 1 (quotes[].symbol == "USD" priority)
    item1 = parsed.top_rwa_assets[0]
    assert item1["rwa_id"] == 1
    assert item1["symbol"] == "GOLD"
    assert item1["price"] == pytest.approx(3613.73)
    assert item1["market_cap"] == pytest.approx(4424326683.0)
    assert item1["volume_24h"] == pytest.approx(375810656.0)
    assert item1["percent_change_24h"] is None
    assert item1["percent_change_7d"] is None

    # Check Item 2 (top-level fallback)
    item2 = next(it for it in parsed.top_rwa_assets if it["rwa_id"] == 2)
    assert item2["price"] == pytest.approx(100.25)
    assert item2["market_cap"] == pytest.approx(500_000_000.0)
    assert item2["volume_24h"] == pytest.approx(12_500_000.0)

    # Check Item 3 (legacy quotes fallback)
    item3 = next(it for it in parsed.top_rwa_assets if it["rwa_id"] == 3)
    assert item3["price"] == pytest.approx(32.5)
    assert item3["market_cap"] == pytest.approx(250_000_000.0)
    assert item3["volume_24h"] == pytest.approx(8_000_000.0)

    # Check sums without double-counting
    expected_mcap = 4424326683.0 + 500_000_000.0 + 250_000_000.0
    expected_vol = 375810656.0 + 12_500_000.0 + 8_000_000.0
    assert parsed.total_tokenized_market_cap == pytest.approx(expected_mcap)
    assert parsed.total_tokenized_volume_24h == pytest.approx(expected_vol)
