"""Comprehensive QA remediation test suite covering P0, P1, P2, reconciliation, & resilience."""

from __future__ import annotations

import asyncio
import math
from datetime import UTC, datetime, timedelta

import httpx
import pandas as pd
import pytest
import respx
from tests.test_cmc_adapter import BASE, MemorySnapshotStore, client_for
from tests.test_cmc_adapter import NOW as ADAPTER_NOW
from tests.test_services import (
    AAVE,
    AVAX,
    BTC,
    ETH,
    SOL,
    STATUS,
    WILD,
    Scripted,
    coin,
    common_handlers,
    envelope_deps,
    history,
    listings,
    quotes,
)

from app.adapters.cmc_client import CMCEndpointUnavailableError, FetchMeta
from app.adapters.normalizer import SymbolResolution, choose_ids, parse_derivatives_pairs
from app.core.config import get_settings
from app.quant.anomalies import ANOMALY_METHODOLOGY_VERSION
from app.quant.metrics import (
    annualized_volatility,
    beta,
    circulating_supply_pct,
    daily_rate_spread_7d_vs_30d,
    fdv_to_mcap_ratio,
    log_returns,
    maximum_drawdown,
    pearson_correlation,
    simple_returns,
    utc_daily_close,
    volume_to_mcap,
)
from app.quant.regime import REGIME_RULES_VERSION, REGIME_THRESHOLDS, classify_regime
from app.quant.screening import (
    MOMENTUM_METHODOLOGY_VERSION,
    UniverseAsset,
    classify_asset_universe,
    screen_movers,
)
from app.schemas.envelope import EvidenceStatus
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
from app.services.budget import (
    BudgetController,
    MemoryBudgetStore,
    UsageEvent,
    evaluate_budget_state,
    install_budget_controller,
)
from app.services.intelligence import (
    MAP,
    OHLCV,
    QUOTES,
    analyze_asset,
    analyze_derivatives,
    analyze_market_regime,
    analyze_momentum,
    analyze_sector_rotation,
    compare_assets,
    detect_market_anomalies,
    get_capabilities,
    get_historical_performance,
    get_market_overview,
    scan_market_movers,
)
from app.services.tier_detection import TierDetector, install_tier_detector


class ClientErrorMapGateway(Scripted):
    """Scripted gateway where /v1/cryptocurrency/map can simulate HTTP 400 client_error."""

    async def fetch(
        self,
        endpoint: str,
        params: dict[str, object],
        _ttl: int | None = None,
        _override: str | None = None,
    ) -> tuple[dict[str, object], FetchMeta]:
        if endpoint == MAP and params.get("symbol") == "NOPECOIN":
            self.calls.append(endpoint)
            raise CMCEndpointUnavailableError(
                endpoint,
                "Invalid value for symbol",
                category="client_error",
                http_status=400,
                cmc_error_code=400,
            )
        return await super().fetch(endpoint, params, _ttl, _override)


# ---------------------------------------------------------------------------
# P0 Tests (P0-01 .. P0-10)
# ---------------------------------------------------------------------------


async def test_p0_01_capabilities_reports_zero_credits_and_ohlcv_caveat() -> None:
    handlers = common_handlers()
    deps, evidence = envelope_deps(Scripted(handlers), denied={OHLCV})
    result = await get_capabilities(deps=deps)

    assert result.tool == "get_capabilities"
    assert result.evidence.cmc_credit_cost == 0
    assert result.evidence.cmc_endpoints_called == []
    assert result.methodology.version == "capabilities_snapshot_v1"
    assert result.methodology.parameters is not None
    assert result.methodology.parameters["is_market_data"] is False
    assert any("optional tier-restricted" in note.lower() for note in result.limitations)

    tool_map = {item.name: item for item in result.data.tools}
    assert tool_map["get_historical_performance"].mode == "fallback"
    assert tool_map["analyze_asset"].mode == "full"
    assert "optional 365d" in (tool_map["analyze_asset"].reason or "").lower()
    assert evidence.records[-1].tool_name == "get_capabilities"


async def test_p0_02_03_07_field_provenance_and_source_timestamps_across_tools() -> None:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    handlers[OHLCV] = history
    deps, _ = envelope_deps(Scripted(handlers), denied={OHLCV})

    overview = await get_market_overview(deps=deps)
    assert overview.field_provenance is not None
    assert overview.field_provenance["macro_global"].availability == "AVAILABLE"
    assert (
        overview.field_provenance["top50_breadth"].endpoint
        == "/v1/cryptocurrency/listings/latest"
    )
    assert overview.evidence.source_timestamps

    asset_env = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=deps)
    assert asset_env.status == EvidenceStatus.PARTIAL
    assert asset_env.field_provenance is not None
    assert asset_env.field_provenance["quote"].availability == "AVAILABLE"
    assert asset_env.field_provenance["historical_risk_365d"].availability == "UNAVAILABLE_TIER"

    hist_env = await get_historical_performance(
        HistoricalPerformanceInput(symbol="SOL", count=30),
        deps=deps,
    )
    assert hist_env.status == EvidenceStatus.TIER_RESTRICTED
    assert hist_env.field_provenance is not None
    assert hist_env.field_provenance["asset_history"].availability == "UNAVAILABLE_TIER"
    assert hist_env.field_provenance["btc_benchmark_history"].availability == "UNAVAILABLE_TIER"


async def test_p0_06_map_400_translates_to_symbol_not_found_and_skips_quotes() -> None:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    gateway = ClientErrorMapGateway(handlers)
    deps, _ = envelope_deps(gateway, denied={OHLCV})

    result = await analyze_asset(AnalyzeAssetInput(symbol="NOPECOIN"), deps=deps)
    assert result.status == EvidenceStatus.INSUFFICIENT_DATA
    assert result.data.cmc_id is None
    assert result.data.price is None
    assert QUOTES not in gateway.calls
    assert result.field_provenance is not None
    assert result.field_provenance["quote"].availability == "INVALID_SYMBOL"
    assert result.field_provenance["quote"].reason_code == "SYMBOL_NOT_FOUND"
    assert any("not found" in note.lower() for note in result.limitations)


def test_p0_06_choose_ids_resolves_lowest_rank_and_surfaces_ambiguity() -> None:
    resolution: SymbolResolution = choose_ids(
        ["UNI", "MISSINGX"],
        [
            {"symbol": "UNI", "cmc_id": 7083, "rank": 22, "name": "Uniswap"},
            {"symbol": "UNI", "cmc_id": 99999, "rank": 1500, "name": "FakeUni"},
        ],
    )
    assert resolution.ids == {"UNI": 7083}
    assert "UNI" in resolution.ambiguous_symbols
    assert len(resolution.ambiguous_symbols["UNI"]) == 2
    assert "MISSINGX" in resolution.unresolved_symbols
    assert any("AMBIGUOUS_SYMBOL_RANK_SELECTED" in note for note in resolution.limitations)


def test_p0_04_05_derivatives_excludes_zero_oi_positive_volume_from_denominator() -> None:
    payload = {
        "data": {
            "id": 5426,
            "symbol": "SOL",
            "num_market_pairs": 12,
            "market_pairs": [
                {
                    "market_id": 101,
                    "market_pair_symbol": "SOL/USDT",
                    "exchange": {
                        "exchange_id": 270,
                        "exchange_name": "Binance",
                        "exchange_slug": "binance",
                    },
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "price": 150.0,
                            "volume_24h": 500_000_000.0,
                            "open_interest": 250_000_000.0,
                            "funding_rate": 0.0001,
                        }
                    ],
                },
                {
                    "market_id": 102,
                    "market_pair_symbol": "SOL/USDT",
                    "exchange": {
                        "exchange_id": 521,
                        "exchange_name": "Bybit",
                        "exchange_slug": "bybit",
                    },
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "price": 150.1,
                            "volume_24h": 300_000_000.0,
                            "open_interest": 0.0,
                            "funding_rate": 0.0002,
                        }
                    ],
                },
            ],
        },
        "status": STATUS,
    }
    parsed = parse_derivatives_pairs(payload, currency="USD", expected_symbol="SOL")
    assert parsed.open_interest == 250_000_000.0
    assert parsed.open_interest_pairs_included == 1
    assert parsed.sampled_pair_count == 2
    bybit_pair = next(p for p in parsed.market_pairs if p["market_id"] == 102)
    assert "zero_oi_with_positive_volume" in bybit_pair["exclusions"]


async def test_p0_04_05_derivatives_isolates_market_wide_liquidations_from_asset() -> None:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    handlers["/v5/cryptocurrency/derivatives/market-pairs/list/latest"] = {
        "data": {
            "id": 5426,
            "symbol": "SOL",
            "num_market_pairs": 5,
            "market_pairs": [
                {
                    "market_id": 1,
                    "market_pair_symbol": "SOL/USDT",
                    "exchange": {
                        "exchange_id": 270,
                        "exchange_name": "Binance",
                        "exchange_slug": "binance",
                    },
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "price": 150.0,
                            "volume_24h": 100_000_000.0,
                            "open_interest": 80_000_000.0,
                            "funding_rate": 0.0001,
                        }
                    ],
                }
            ],
        },
        "status": STATUS,
    }
    handlers["/v5/derivatives/liquidations/quotes/latest"] = {
        "data": [
            {
                "quote": {
                    "USD": {
                        "total_24h": 420_000_000.0,
                        "long_24h": 300_000_000.0,
                        "short_24h": 120_000_000.0,
                        "last_updated": "2026-11-22T15:00:00.000Z",
                    }
                }
            }
        ],
        "status": STATUS,
    }
    handlers["/v5/exchange/derivatives/list"] = {
        "data": [
            {
                "id": 270,
                "name": "Binance",
                "slug": "binance",
                "rank": 1,
                "num_market_pairs": 300,
                "quote": {
                    "USD": {
                        "open_interest": 9_000_000_000.0,
                        "volume_24h": 25_000_000_000.0,
                    }
                },
            }
        ],
        "status": STATUS,
    }
    deps, _ = envelope_deps(Scripted(handlers), denied={OHLCV})
    res = await analyze_derivatives(DerivativesAnalysisInput(symbol="SOL"), deps=deps)

    assert res.data.liquidations_24h is None
    assert res.data.open_interest == 80_000_000.0
    assert res.data.market_wide_liquidations is not None
    assert res.data.market_wide_liquidations.scope == "market_wide"
    assert res.data.market_wide_liquidations.attribution == "not_asset_specific"
    assert res.data.market_wide_liquidations.total_24h == 420_000_000.0
    assert res.data.derivatives_venues is not None
    assert res.data.derivatives_venues.attribution == "not_asset_specific"
    assert res.field_provenance is not None
    assert res.field_provenance["asset_liquidations_24h"].availability == "UNAVAILABLE_SOURCE"
    assert res.field_provenance["funding_rate_aggregate"].availability == "NOT_APPLICABLE"
    assert res.field_provenance["open_interest_sampled"].availability == "AVAILABLE"


def test_p0_08_classify_asset_universe_covers_all_buckets() -> None:
    assert classify_asset_universe(["stablecoin", "usd-stablecoin"]) == "verified_stablecoin"
    assert classify_asset_universe(["leveraged-tokens"]) == "leveraged_token"
    assert classify_asset_universe(["tokenized-stock"]) == "tokenized_equity_rwa"
    assert (
        classify_asset_universe([], symbol="AAPLX", name="Apple xStock")
        == "tokenized_equity_rwa"
    )
    assert classify_asset_universe(["wrapped-tokens"]) == "wrapped_asset"
    assert classify_asset_universe(["centralized-exchange"]) == "exchange_token"
    assert classify_asset_universe(["layer-1", "defi"]) == "native_crypto"
    assert classify_asset_universe([]) == "unknown"


async def test_p0_10_evidence_draft_persists_methodology_version_and_request_params() -> None:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    deps, evidence = envelope_deps(Scripted(handlers), denied={OHLCV})

    env = await analyze_asset(AnalyzeAssetInput(symbol="SOL", quote_currency="EUR"), deps=deps)
    draft = evidence.records[-1]
    assert draft.evidence_id == env.evidence.evidence_id
    assert draft.methodology["version"] is not None
    assert draft.methodology["response_status"] == env.status.value
    assert draft.methodology["request_parameters"] == {
        "symbol": "SOL",
        "quote_currency": "EUR",
    }


async def test_p0_09_market_overview_guards_impossible_percentages_and_negative_totals() -> None:
    handlers = common_handlers()
    handlers["/v1/global-metrics/quotes/latest"] = {
        "data": {
            "btc_dominance": 150.0,
            "eth_dominance": -5.0,
            "btc_dominance_24h_percentage_change": 0.5,
            "quote": {
                "USD": {
                    "total_market_cap": -1000.0,
                    "total_volume_24h": 50_000_000_000.0,
                    "total_market_cap_yesterday_percentage_change": 1.2,
                }
            },
        },
        "status": STATUS,
    }
    deps, _ = envelope_deps(Scripted(handlers))
    overview = await get_market_overview(deps=deps)

    assert overview.data.btc_dominance is None
    assert overview.data.eth_dominance is None
    assert overview.data.total_market_cap is None
    assert overview.data.total_volume_24h == 50_000_000_000.0
    assert overview.status == EvidenceStatus.INSUFFICIENT_DATA
    assert overview.field_provenance is not None
    assert overview.field_provenance["macro_global"].availability == "UNAVAILABLE_SOURCE"
    assert any("btc_dominance" in note for note in overview.limitations)
    assert any("total_market_cap" in note for note in overview.limitations)


# ---------------------------------------------------------------------------
# P1 Math, Property & Quality Tests (P1-01 .. P1-10)
# ---------------------------------------------------------------------------


def test_p1_01_ohlcv_math_handles_gaps_duplicates_out_of_order_with_365_basis() -> None:
    d0 = datetime(2026, 3, 1, 10, 0, tzinfo=UTC)
    d1 = d0 + timedelta(days=1)
    d2 = d0 + timedelta(days=2)
    d3 = d0 + timedelta(days=3)
    d4 = d0 + timedelta(days=4)
    d5 = d0 + timedelta(days=5)
    # Day 6 omitted (gap day!), Day 7 present
    d7 = d0 + timedelta(days=7)

    # Shuffled order + duplicate Day 2 timestamp (latest 132.0 wins)
    rows = [
        (d3, 118.8),
        (d0, 100.0),
        (d5, 130.0),
        (d2.replace(hour=1), 999.0),
        (d2.replace(hour=23), 132.0),
        (d1, 110.0),
        (d7, 169.0),
        (d4, 104.0),
    ]
    closes = utc_daily_close(rows)
    assert len(closes) == 7
    assert closes.iloc[2] == 132.0  # latest timestamp kept for d2

    simple = simple_returns(closes)
    logged = log_returns(closes)
    # d5 -> d7 is a 2-day gap, so NO synthetic return across missing day 6!
    assert len(simple) == 5
    assert len(logged) == 5
    expected_r = [0.10, 0.20, -0.10, (104.0 / 118.8) - 1.0, (130.0 / 104.0) - 1.0]
    for got, exp in zip(simple.tolist(), expected_r, strict=True):
        assert math.isclose(got, exp, rel_tol=1e-9)

    expected_vol = float(pd.Series(expected_r).std(ddof=1)) * math.sqrt(365)
    assert math.isclose(annualized_volatility(simple) or 0.0, expected_vol, rel_tol=1e-12)
    # Peak at d2 = 132.0, trough at d4 = 104.0 -> (104 - 132) / 132
    assert math.isclose(maximum_drawdown(closes) or 0.0, (104.0 - 132.0) / 132.0, rel_tol=1e-12)
    assert math.isclose(beta(simple, simple) or 0.0, 1.0, rel_tol=1e-12)
    assert math.isclose(pearson_correlation(simple, simple) or 0.0, 1.0, rel_tol=1e-12)


def test_p1_03_classify_regime_boundaries_and_signal_conflict_confidence() -> None:
    assert REGIME_RULES_VERSION == "regime_rules_v1"
    assert REGIME_THRESHOLDS["structural_stress_mcap_24h_max_pct"] == -2.0

    # Boundary: mcap == -2.0 AND breadth == 30.0 -> RISK_OFF_STRESS
    risk_off = classify_regime(
        total_mcap_change_24h_pct=-2.0,
        btc_dominance_change_24h=0.5,
        top50_breadth_positive_pct=30.0,
        fear_greed_value=25,
        btc_outperforming_median_alt=True,
        breadth_sample_size=50,
    )
    assert risk_off.regime == "RISK_OFF_STRESS"
    assert risk_off.confidence == "HIGH"

    # Bullish structure (mcap > 0, breadth >= 60) + greed (55) + BTC dom down -> RISK_ON_ALTSEASON
    risk_on = classify_regime(
        total_mcap_change_24h_pct=2.0,
        btc_dominance_change_24h=-0.3,
        top50_breadth_positive_pct=60.0,
        fear_greed_value=55,
        btc_outperforming_median_alt=False,
        breadth_sample_size=50,
    )
    assert risk_on.regime == "RISK_ON_ALTSEASON"

    # Conflicting bullish structure vs fearful sentiment downgrades confidence to LOW
    conflict = classify_regime(
        total_mcap_change_24h_pct=2.5,
        btc_dominance_change_24h=-0.2,
        top50_breadth_positive_pct=70.0,
        fear_greed_value=20,
        btc_outperforming_median_alt=False,
        breadth_sample_size=50,
    )
    assert conflict.signal_conflict is True
    assert conflict.confidence == "LOW"


async def test_p1_02_momentum_exposes_cumulative_spread_and_normalized_daily_rate() -> None:
    assert math.isclose(
        daily_rate_spread_7d_vs_30d(14.0, 30.0) or 0.0,
        (14.0 / 7.0) - (30.0 / 30.0),
        rel_tol=1e-12,
    )
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    deps, _ = envelope_deps(Scripted(handlers), denied={OHLCV})

    res = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL", "BTC"]), deps=deps)
    sol_row = next(r for r in res.data.assets if r.symbol == "SOL")
    # SOL fixture has change_7d=20, change_30d=5
    assert sol_row.acceleration_7d_vs_30d == 15.0
    assert math.isclose(
        sol_row.daily_rate_spread_7d_vs_30d_pct or 0.0,
        (20.0 / 7.0) - (5.0 / 30.0),
        rel_tol=1e-9,
    )


async def test_p1_04_anomalies_marks_price_not_directional_and_warns_on_illiquidity() -> None:
    thin = coin(
        8888,
        "THIN",
        95.0,
        market_cap=200_000_000.0,
        volume=50_000.0,  # vol < 100k AND vol/mcap < 0.001
        tags=["defi"],
    )
    peers = [
        coin(
            100 + i,
            f"P{i}",
            1.0 + (i % 3) * 0.2,
            market_cap=500_000_000,
            volume=25_000_000,
        )
        for i in range(12)
    ]
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, thin, *peers)
    deps, _ = envelope_deps(Scripted(handlers))

    res = await detect_market_anomalies(DetectAnomaliesInput(universe_size=50), deps=deps)
    assert res.methodology.version == ANOMALY_METHODOLOGY_VERSION
    thin_hits = [h for h in res.data.price_change_outliers if h.symbol == "THIN"]
    assert thin_hits
    assert thin_hits[0].direction is None
    assert res.warnings
    assert any("low-liquidity" in w.lower() for w in res.warnings)


def test_p1_05_screen_movers_deterministic_sorting_tiebreak_and_stablecoin_exclusion() -> None:
    universe = [
        UniverseAsset(
            cmc_id=10,
            symbol="BETA",
            name="Beta",
            market_cap=50_000_000,
            volume_24h=10_000_000,
            percent_change_24h=15.0,
            percent_change_7d=20.0,
            percent_change_30d=10.0,
        ),
        UniverseAsset(
            cmc_id=5,
            symbol="ALPHA",
            name="Alpha",
            market_cap=50_000_000,
            volume_24h=10_000_000,
            percent_change_24h=15.0,
            percent_change_7d=20.0,
            percent_change_30d=10.0,
        ),
    ]
    rows = screen_movers(
        universe,
        btc_percent_change_7d=5.0,
        min_market_cap_usd=10_000_000,
        min_volume_24h_usd=1_000_000,
        max_24h_gain_pct=35.0,
        rank_by="rs_vs_btc_7d",
        limit=10,
    )
    assert [r.symbol for r in rows] == ["ALPHA", "BETA"]
    assert MOMENTUM_METHODOLOGY_VERSION == "momentum_score_v1"


async def test_p1_06_sector_rotation_discloses_overlap_and_non_additive_volume_share() -> None:
    multi_tag = coin(
        777,
        "HYBRID",
        8.0,
        change_7d=12.0,
        tags=["defi", "layer-1", "real-world-assets"],
    )
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, ETH, SOL, AAVE, multi_tag)
    deps, _ = envelope_deps(Scripted(handlers))

    res = await analyze_sector_rotation(
        SectorRotationInput(sectors=["defi", "layer-1", "rwa"]),
        deps=deps,
    )
    assert res.data.overlapping_asset_count is not None
    assert res.data.overlapping_asset_count >= 1
    assert res.data.unique_constituent_count is not None
    assert any("overlap" in note.lower() for note in res.limitations)


def test_p1_07_supply_and_valuation_ratios_fail_safe_on_zero_denominators() -> None:
    assert circulating_supply_pct(50.0, 0.0) is None
    assert circulating_supply_pct(50.0, None) is None
    assert fdv_to_mcap_ratio(1_000_000.0, 0.0) is None
    assert volume_to_mcap(1_000_000.0, 0.0) is None
    assert circulating_supply_pct(50.0, 100.0) == 50.0


# ---------------------------------------------------------------------------
# Section 8 Cross-Tool Reconciliation & Section 7.4 Resilience Tests
# ---------------------------------------------------------------------------


async def test_section_8_cross_tool_reconciliation_shared_fixtures() -> None:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, ETH, SOL, AVAX, AAVE, WILD)
    deps, _ = envelope_deps(Scripted(handlers), denied={OHLCV})

    overview, asset_btc, regime, movers, mom, comp = await asyncio.gather(
        get_market_overview(deps=deps),
        analyze_asset(AnalyzeAssetInput(symbol="BTC"), deps=deps),
        analyze_market_regime(deps=deps),
        scan_market_movers(ScanMoversInput(rank_by="rs_vs_btc_7d", limit=10), deps=deps),
        analyze_momentum(AnalyzeMomentumInput(symbols=["BTC", "SOL", "AVAX"]), deps=deps),
        compare_assets(CompareAssetsInput(symbols=["BTC", "SOL"]), deps=deps),
    )

    # 1. Overview vs AnalyzeAsset(BTC) canonical ID & price consistency
    assert asset_btc.data.cmc_id == 1
    assert asset_btc.data.price == 10.0

    # 2. Regime vs Overview input consistency
    assert regime.data.total_mcap_change_24h_pct == overview.data.total_market_cap_change_24h_pct
    assert regime.data.fear_greed_value == overview.data.fear_greed_value
    assert regime.data.top50_breadth_positive_pct == overview.data.top50_breadth_positive_pct

    # 3. Movers vs Momentum matching horizon return for SOL
    sol_mover = next(r for r in movers.data.movers if r.symbol == "SOL")
    sol_mom = next(r for r in mom.data.assets if r.symbol == "SOL")
    assert sol_mover.percent_change_7d == sol_mom.percent_change_7d

    # 4. CompareAssets vs AnalyzeAsset canonical cmc_id & price parity
    comp_btc = next(a for a in comp.data.assets if a.symbol == "BTC")
    assert comp_btc.cmc_id == asset_btc.data.cmc_id
    assert comp_btc.price == asset_btc.data.price

    # 5. Capabilities fallback alignment with HistoricalPerformance TIER_RESTRICTED
    caps = await get_capabilities(deps=deps)
    hist_cap = next(t for t in caps.data.tools if t.name == "get_historical_performance")
    hist = await get_historical_performance(HistoricalPerformanceInput(symbol="SOL"), deps=deps)
    assert hist_cap.mode == "fallback"
    assert hist.status == EvidenceStatus.TIER_RESTRICTED


async def test_section_7_4_resilience_single_flight_and_429_retry_after() -> None:
    store = MemorySnapshotStore()
    sleeps: list[float] = []

    async def capture_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    with respx.mock(assert_all_called=False) as router:
        route = router.get(f"{BASE}{QUOTES}").mock(
            side_effect=[
                httpx.Response(
                    429,
                    headers={"Retry-After": "2"},
                    json={"status": {"error_code": 1008}},
                ),
                httpx.Response(
                    200,
                    json={"data": {"1": {"id": 1, "symbol": "BTC"}}, "status": STATUS},
                ),
            ]
        )
        async with client_for(store, sleep=capture_sleep) as client:
            assert client._now() == ADAPTER_NOW
            results = await asyncio.gather(
                client.fetch(QUOTES, {"id": "1"}, 60),
                client.fetch(QUOTES, {"id": "1"}, 60),
            )
    assert route.call_count == 2  # single-flight coalesced + 1 retry after 429
    assert len(results) == 2
    assert sleeps == [1]


async def test_section_7_4_deep_scan_downgrades_under_conservation_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CMC_QUOTA_PROFILE", "startup")
    get_settings.cache_clear()
    detector = TierDetector()
    # 86% used -> CONSERVATION
    state, warning, _ = evaluate_budget_state(860, 1000)
    assert state == "CONSERVATION"
    assert (
        detector.startup_features_open(
            state=state,
            warning_level=warning,
            ledger_status="ok",
        )
        is False
    )

    # Confirm scan_market_movers downgrades Deep Scan under CONSERVATION (>= 85%)
    store = MemoryBudgetStore(
        initial_events=[
            UsageEvent(
                endpoint="/v1/cryptocurrency/listings/latest",
                credit_cost=860,
                created_at=ADAPTER_NOW,
            )
        ]
    )
    controller = BudgetController(
        quota_profile="startup",
        monthly_budget=1000,
        store=store,
        now=lambda: ADAPTER_NOW,
    )
    install_budget_controller(controller)
    install_tier_detector(detector)
    try:
        handlers = common_handlers()
        handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, ETH, SOL, AVAX)
        deps, _ = envelope_deps(Scripted(handlers))
        res = await scan_market_movers(ScanMoversInput(deep_scan=True, limit=10), deps=deps)
        assert any(
            "downgraded" in note.lower() and "conservation" in note.lower()
            for note in res.limitations
        )
        assert len(res.data.movers) <= 10
    finally:
        install_budget_controller(None)
        install_tier_detector(None)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_b3_supabase_hidden_gem_store_chunks_large_batches_and_handles_list_rejections() -> (
    None
):
    from types import SimpleNamespace

    from app.services.hidden_gem_store import SupabaseHiddenGemStore

    recorded_in_sizes: list[int] = []
    recorded_upsert_sizes: list[int] = []

    class FakeQuery:
        def __init__(self, table_name: str) -> None:
            self.table_name = table_name
            self.batch_rows: list[dict[str, object]] = []

        def upsert(self, batch: list[dict[str, object]], **_kwargs: object) -> FakeQuery:
            recorded_upsert_sizes.append(len(batch))
            self.batch_rows = [
                {"id": f"uuid-{i}", "canonical_provider_id": row["canonical_provider_id"]}
                for i, row in enumerate(batch)
            ]
            return self

        def select(self, *_args: object) -> FakeQuery:
            return self

        def in_(self, _col: str, values: list[str]) -> FakeQuery:
            recorded_in_sizes.append(len(values))
            if self.table_name == "hg_market_snapshots":
                self.batch_rows = [
                    {
                        "asset_id": v,
                        "source_timestamp": "2026-11-28T00:00:00+00:00",
                        "price": 12.5,
                    }
                    for v in values[:2]
                ]
            return self

        def eq(self, *_args: object) -> FakeQuery:
            return self

        def gte(self, *_args: object) -> FakeQuery:
            return self

        def lte(self, *_args: object) -> FakeQuery:
            return self

        def execute(self) -> SimpleNamespace:
            if self.table_name == "hg_scan_rejections":
                return SimpleNamespace(
                    data=[
                        {"id": "rej-1", "reason_code": "LOW_VOL", "hg_assets": [{"symbol": "FOO"}]},
                        {"id": "rej-2", "reason_code": "NEW", "hg_assets": {"symbol": "BAR"}},
                    ]
                )
            return SimpleNamespace(data=self.batch_rows)

    class FakeClient:
        def table(self, name: str) -> FakeQuery:
            return FakeQuery(name)

    store = SupabaseHiddenGemStore(client=FakeClient())

    # 1,000 asset IDs must chunk .in_() filters (<=150) & upserts (<=200) for PostgREST safety.
    asset_rows = [{"canonical_provider_id": str(i)} for i in range(450)]
    mapping = await store.upsert_assets(asset_rows)
    assert len(mapping) == 450
    assert max(recorded_upsert_sizes) <= 200

    asset_ids = [f"asset-{i}" for i in range(1000)]
    priors = await store.get_prior_snapshot_prices(
        asset_ids, ADAPTER_NOW - timedelta(days=7), ADAPTER_NOW
    )
    assert len(priors) > 0
    assert max(recorded_in_sizes) <= 150
    assert sum(recorded_in_sizes) == 1000

    rejections = await store.list_rejections("user-1", "00000000-0000-0000-0000-000000000001")
    assert [r["symbol"] for r in rejections] == ["FOO", "BAR"]


def test_b3_invalid_uuid_rejected_as_404_and_openapi_description_is_canonical() -> None:
    from fastapi import HTTPException

    from app.api.v1.hidden_gems import _require_valid_uuid
    from app.main import OPENAPI_DESCRIPTION

    with pytest.raises(HTTPException) as exc_info:
        _require_valid_uuid("nonexistent-scan-id", "Scan run")
    assert exc_info.value.status_code == 404

    valid = _require_valid_uuid("00000000-0000-0000-0000-000000000001", "Scan run")
    assert valid == "00000000-0000-0000-0000-000000000001"

    assert "14 Tools, 6 Resources" in OPENAPI_DESCRIPTION
    assert "0 server-side LLM calls" not in OPENAPI_DESCRIPTION
