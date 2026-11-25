"""Tier-revert simulation tests proving 100% resilience when Startup reverts to Basic."""

from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.adapters.cache import StoredSnapshot, cache_key, ttl_for_endpoint
from app.adapters.cmc_client import CMCClient
from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
from app.core.config import get_settings
from app.main import app
from app.schemas.envelope import DataMode, EvidenceStatus, Freshness
from app.schemas.tools import (
    AnalyzeAssetInput,
    AnalyzeMomentumInput,
    CompareAssetsInput,
    DerivativesAnalysisInput,
    DetectAnomaliesInput,
    HistoricalPerformanceInput,
    ScanMoversInput,
    SectorRotationInput,
)
from app.services import intelligence
from app.services.evidence import MemoryEvidence
from app.services.intelligence import SectorBook, ServiceDeps, install_deps

BASE = "https://pro-api.coinmarketcap.com"
NOW = datetime(2026, 12, 10, 12, 0, tzinfo=UTC)
SANDBOX = "ct_live_unit_test_fixture_001"


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
    async def resolve(self, symbols: list[str]):
        from app.adapters.normalizer import SymbolResolution

        table = {"BTC": 1, "ETH": 1027, "SOL": 5426, "AVAX": 5805, "NEAR": 6535}
        ids = {sym.upper(): table[sym.upper()] for sym in symbols if sym.upper() in table}
        return SymbolResolution(ids=ids, limitations=[])


class AllAllowedCapabilities(intelligence.CapabilityMap):
    def allows(self, endpoint: str) -> bool:
        return True


def _ok_status(credits: int = 1) -> dict[str, object]:
    return {
        "timestamp": "2026-12-10T11:59:00.000Z",
        "error_code": 0,
        "error_message": None,
        "credit_count": credits,
    }


def _ohlcv_payload(closes: list[float]) -> dict[str, object]:
    quotes = []
    start = datetime(2026, 11, 20, 0, 0, tzinfo=UTC)
    for index, close in enumerate(closes):
        stamp = (start + timedelta(days=index)).strftime("%Y-%m-%dT23:59:59.000Z")
        quotes.append({"time_close": stamp, "quote": {"USD": {"close": close}}})
    return {"data": {"quotes": quotes}, "status": _ok_status(1)}


def _listings_payload() -> dict[str, object]:
    coins = [
        ("BTC", 1, "Bitcoin", 90000.0, 1.8e12, 4.0e10, 1.5, 4.0, 12.0, ["layer-1"]),
        ("ETH", 1027, "Ethereum", 3200.0, 3.8e11, 2.2e10, 2.2, 6.0, 15.0, ["layer-1"]),
        ("SOL", 5426, "Solana", 180.0, 8.5e10, 7.5e9, 4.5, 11.0, 24.0, ["layer-1", "defi"]),
        ("AVAX", 5805, "Avalanche", 35.0, 1.4e10, 9.0e8, 3.1, 7.5, 14.0, ["layer-1", "defi"]),
        ("NEAR", 6535, "NEAR", 6.2, 7.0e9, 5.2e8, 2.8, 8.2, 18.0, ["ai-big-data", "layer-1"]),
        ("ONDO", 21159, "Ondo", 1.25, 2.2e9, 2.4e8, 5.1, 13.0, 28.0, ["real-world-assets", "defi"]),
        ("ARB", 11841, "Arbitrum", 0.95, 3.8e9, 3.1e8, 1.8, 5.0, 9.0, ["layer-2"]),
        ("IMX", 10603, "Immutable", 1.6, 2.6e9, 1.4e8, -1.2, 2.0, 6.0, ["gaming"]),
        ("PEPE", 24478, "Pepe", 0.000018, 7.5e9, 1.5e9, -11.0, -4.0, 10.0, ["memes"]),
    ]
    data = []
    for idx, (sym, cid, name, price, mcap, vol, c24, c7, c30, tags) in enumerate(coins, start=1):
        data.append(
            {
                "id": cid,
                "symbol": sym,
                "name": name,
                "cmc_rank": idx,
                "tags": tags,
                "circulating_supply": 100_000_000.0,
                "max_supply": 200_000_000.0,
                "quote": {
                    "USD": {
                        "price": price,
                        "market_cap": mcap,
                        "fully_diluted_market_cap": mcap * 1.5,
                        "volume_24h": vol,
                        "percent_change_1h": 0.4,
                        "percent_change_24h": c24,
                        "percent_change_7d": c7,
                        "percent_change_30d": c30,
                        "percent_change_60d": c30 * 1.2,
                        "percent_change_90d": c30 * 1.4,
                    }
                },
            }
        )
    return {"data": data, "status": _ok_status(1)}


def _quotes_payload() -> dict[str, object]:
    rows = _listings_payload()["data"]
    assert isinstance(rows, list)
    return {"data": {str(row["id"]): row for row in rows}, "status": _ok_status(1)}


def _global_payload() -> dict[str, object]:
    return {
        "data": {
            "btc_dominance": 54.2,
            "eth_dominance": 15.8,
            "btc_dominance_24h_percentage_change": -0.35,
            "quote": {
                "USD": {
                    "total_market_cap": 3_100_000_000_000.0,
                    "total_volume_24h": 145_000_000_000.0,
                    "total_market_cap_yesterday_percentage_change": 2.4,
                }
            },
        },
        "status": _ok_status(1),
    }


def _fear_payload() -> dict[str, object]:
    return {
        "data": {"value": 64, "value_classification": "Greed"},
        "status": _ok_status(1),
    }


def _info_payload() -> dict[str, object]:
    return {
        "data": {
            "5426": {"id": 5426, "symbol": "SOL", "tags": ["layer-1", "defi"]},
            "1": {"id": 1, "symbol": "BTC", "tags": ["pow", "layer-1"]},
        },
        "status": _ok_status(1),
    }


def _seeded_store() -> MemorySnapshotStore:
    retrieved = NOW - timedelta(hours=4)
    snapshots: dict[str, StoredSnapshot] = {}
    series_by_id = {
        1: [80000.0, 81000.0, 80500.0, 82000.0, 83500.0, 84000.0, 85000.0],
        5426: [150.0, 155.0, 152.0, 160.0, 166.0, 172.0, 180.0],
        5805: [30.0, 31.0, 30.5, 32.0, 33.0, 34.0, 35.0],
        6535: [5.0, 5.2, 5.1, 5.4, 5.6, 5.9, 6.2],
    }
    for cid, closes in series_by_id.items():
        params = {"id": cid, "count": 30, "interval": "daily", "convert": "USD"}
        key = cache_key("/v2/cryptocurrency/ohlcv/historical", params)
        snapshots[key] = StoredSnapshot(
            cache_key=key,
            endpoint="/v2/cryptocurrency/ohlcv/historical",
            params_json=params,
            payload=_ohlcv_payload(closes),
            source_timestamp=retrieved,
            retrieved_at=retrieved,
            ttl_seconds=ttl_for_endpoint("/v2/cryptocurrency/ohlcv/historical"),
            credit_cost=1,
            is_verified_fallback=True,
        )

    perf_params = {"id": "5426"}
    perf_key = cache_key("/v2/cryptocurrency/price-performance-stats/latest", perf_params)
    snapshots[perf_key] = StoredSnapshot(
        cache_key=perf_key,
        endpoint="/v2/cryptocurrency/price-performance-stats/latest",
        params_json=perf_params,
        payload={
            "data": {
                "5426": {
                    "periods": {
                        "30d": {
                            "quote": {"USD": {"high": 195.0, "low": 140.0, "percent_change": 24.0}}
                        }
                    }
                }
            },
            "status": _ok_status(1),
        },
        source_timestamp=retrieved,
        retrieved_at=retrieved,
        ttl_seconds=ttl_for_endpoint("/v2/cryptocurrency/price-performance-stats/latest"),
        credit_cost=1,
        is_verified_fallback=True,
    )
    return MemorySnapshotStore(snapshots)


def _mock_basic_routes(router: respx.MockRouter) -> dict[str, respx.Route]:
    routes = {
        "global": router.get(f"{BASE}/v1/global-metrics/quotes/latest").mock(
            return_value=httpx.Response(200, json=_global_payload())
        ),
        "fear": router.get(f"{BASE}/v3/fear-and-greed/latest").mock(
            return_value=httpx.Response(200, json=_fear_payload())
        ),
        "listings": router.get(f"{BASE}/v1/cryptocurrency/listings/latest").mock(
            return_value=httpx.Response(200, json=_listings_payload())
        ),
        "quotes": router.get(f"{BASE}/v2/cryptocurrency/quotes/latest").mock(
            return_value=httpx.Response(200, json=_quotes_payload())
        ),
        "info": router.get(f"{BASE}/v2/cryptocurrency/info").mock(
            return_value=httpx.Response(200, json=_info_payload())
        ),
        "ohlcv": router.get(f"{BASE}/v2/cryptocurrency/ohlcv/historical").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        ),
        "perf": router.get(f"{BASE}/v2/cryptocurrency/price-performance-stats/latest").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        ),
        "derivs": router.get(f"{BASE}/v5/cryptocurrency/derivatives/market-pairs/list/latest").mock(
            return_value=httpx.Response(403, json={"status": {"error_code": 1006}})
        ),
    }
    return routes


async def _noop_sleep(_seconds: float) -> None:
    return None


@pytest.mark.asyncio
async def test_all_10_workflows_survive_simulated_basic_tier_revert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FORCE_SIMULATE_BASIC_TIER", "true")
    get_settings.cache_clear()
    try:
        store = _seeded_store()
        evidence = MemoryEvidence()
        with respx.mock(assert_all_called=False) as router:
            routes = _mock_basic_routes(router)
            async with CMCClient(
                api_key="test-key",
                base_url=BASE,
                snapshot_store=store,
                sleep=_noop_sleep,
                now=lambda: NOW,
            ) as gateway:
                deps = ServiceDeps(
                    gateway=gateway,
                    evidence=evidence,
                    assets=StaticAssets(),
                    sectors=SectorBook(),
                    capabilities=AllAllowedCapabilities(),
                    now=lambda: NOW,
                )

                overview = await intelligence.get_market_overview(deps=deps)
                regime = await intelligence.analyze_market_regime(deps=deps)
                movers = await intelligence.scan_market_movers(
                    ScanMoversInput(limit=5, max_24h_gain_pct=20),
                    deps=deps,
                )
                momentum = await intelligence.analyze_momentum(
                    AnalyzeMomentumInput(symbols=["SOL", "AVAX", "NEAR"]),
                    deps=deps,
                )
                anomalies = await intelligence.detect_market_anomalies(
                    DetectAnomaliesInput(universe_size=50),
                    deps=deps,
                )
                sectors = await intelligence.analyze_sector_rotation(
                    SectorRotationInput(),
                    deps=deps,
                )
                compared = await intelligence.compare_assets(
                    CompareAssetsInput(symbols=["SOL", "AVAX", "NEAR"]),
                    deps=deps,
                )
                profile = await intelligence.analyze_asset(
                    AnalyzeAssetInput(symbol="SOL"),
                    deps=deps,
                )
                history = await intelligence.get_historical_performance(
                    HistoricalPerformanceInput(symbol="SOL", count=30),
                    deps=deps,
                )
                derivs = await intelligence.analyze_derivatives(
                    DerivativesAnalysisInput(symbol="SOL"),
                    deps=deps,
                )

        # Startup-only routes must NEVER be hit over HTTP when FORCE_SIMULATE_BASIC_TIER=true
        assert routes["ohlcv"].call_count == 0
        assert routes["perf"].call_count == 0
        assert routes["derivs"].call_count == 0

        # Basic-tier workflows stay LIVE / CACHED with OK status
        for basic_env in (overview, regime, movers, momentum, anomalies):
            assert basic_env.status == EvidenceStatus.OK
            assert basic_env.evidence.data_mode in {DataMode.LIVE, DataMode.CACHED}
            assert basic_env.evidence.evidence_id.startswith("ev_")
        # Sectors returns PARTIAL when thin sectors (< 5 constituents) are INSUFFICIENT_DATA
        assert sectors.status == EvidenceStatus.PARTIAL
        assert sectors.evidence.data_mode in {DataMode.LIVE, DataMode.CACHED}
        assert sectors.evidence.evidence_id.startswith("ev_")

        # Startup-backed workflows automatically fall back to verified snapshots with limitations
        assert compared.status == EvidenceStatus.OK
        assert compared.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
        assert any("1006" in note for note in compared.limitations)
        assert all(asset.annualized_volatility is not None for asset in compared.data.assets)

        assert profile.status == EvidenceStatus.OK
        assert profile.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
        assert profile.data.price_performance
        assert any("1006" in note for note in profile.limitations)

        assert history.status == EvidenceStatus.OK
        assert history.evidence.data_mode == DataMode.VERIFIED_SNAPSHOT_FALLBACK
        assert history.evidence.freshness == Freshness.AGING
        assert history.data.overlap_days == 7
        assert history.data.annualized_volatility is not None
        assert any("1006" in note for note in history.limitations)

        # Derivatives returns transparent spot stress proxy with PARTIAL status
        assert derivs.status == EvidenceStatus.PARTIAL
        assert derivs.data.mode == "spot_stress_proxy"
        assert derivs.data.spot_volume_24h is not None
        assert derivs.data.annualized_volatility is not None
        assert any("proxy" in note.lower() for note in derivs.limitations)

        # Every workflow persisted an audit row
        assert len(evidence.records) == 10
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_unseeded_startup_route_returns_tier_restricted_without_500(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FORCE_SIMULATE_BASIC_TIER", "true")
    get_settings.cache_clear()
    try:
        empty_store = MemorySnapshotStore()
        with respx.mock(assert_all_called=False) as router:
            _mock_basic_routes(router)
            async with CMCClient(
                api_key="test-key",
                base_url=BASE,
                snapshot_store=empty_store,
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
                install_deps(deps)
                try:
                    api = TestClient(app)
                    hist_resp = api.get(
                        "/v1/intelligence/assets/SOL/historical",
                        headers={"x-cointrac-key": SANDBOX},
                    )
                    deriv_resp = api.get(
                        "/v1/intelligence/assets/SOL/derivatives",
                        headers={"x-cointrac-key": SANDBOX},
                    )
                finally:
                    install_deps(None)

        assert hist_resp.status_code == 200
        hist_body = hist_resp.json()
        assert hist_body["status"] == "TIER_RESTRICTED"
        assert hist_body["data"]["annualized_volatility"] is None
        assert hist_body["limitations"]

        assert deriv_resp.status_code == 200
        deriv_body = deriv_resp.json()
        assert deriv_body["status"] == "PARTIAL"
        assert deriv_body["data"]["mode"] == "spot_stress_proxy"
        assert deriv_body["data"]["spot_volume_24h"] is not None
        assert deriv_body["limitations"]
    finally:
        get_settings.cache_clear()
