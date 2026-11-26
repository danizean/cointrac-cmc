from datetime import UTC, datetime

import pytest

from app.adapters.cmc_client import CMCEndpointUnavailableError, FetchMeta
from app.adapters.normalizer import SymbolResolution
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
from app.services.evidence import EvidenceDraft, MemoryEvidence, RequestLog, sanitize
from app.services.intelligence import (
    DERIVATIVES,
    OHLCV,
    AssetBook,
    CapabilityMap,
    SectorBook,
    ServiceDeps,
    analyze_asset,
    analyze_derivatives,
    analyze_market_regime,
    analyze_momentum,
    analyze_sector_rotation,
    compare_assets,
    detect_market_anomalies,
    get_historical_performance,
    get_market_overview,
    scan_market_movers,
)

NOW = datetime(2026, 11, 22, 15, 0, tzinfo=UTC)
STATUS = {"timestamp": "2026-11-22T15:00:00.000Z", "error_code": 0, "credit_count": 1}


def coin(
    cmc_id: int,
    symbol: str,
    change_24h: float,
    *,
    change_7d: float = 4,
    change_30d: float = 6,
    market_cap: float = 1_000_000_000,
    volume: float = 100_000_000,
    tags: list[str] | None = None,
) -> dict[str, object]:
    return {
        "id": cmc_id,
        "name": symbol.title(),
        "symbol": symbol,
        "tags": tags or [],
        "circulating_supply": 50.0,
        "total_supply": 80.0,
        "max_supply": 100.0,
        "quote": {
            "USD": {
                "price": 10.0,
                "market_cap": market_cap,
                "volume_24h": volume,
                "fully_diluted_market_cap": market_cap * 2,
                "percent_change_1h": 0.2,
                "percent_change_24h": change_24h,
                "percent_change_7d": change_7d,
                "percent_change_30d": change_30d,
                "percent_change_60d": 3.0,
                "percent_change_90d": 2.0,
            }
        },
    }


BTC = coin(1, "BTC", 1.0, change_7d=1, change_30d=2, tags=["layer-1"])
ETH = coin(1027, "ETH", 4.0, tags=["layer-1"])
SOL = coin(5426, "SOL", 6.0, change_7d=20, change_30d=5, tags=["layer-1"])
AVAX = coin(5805, "AVAX", 3.0, change_7d=8, change_30d=4, tags=["layer-1"])
AAVE = coin(7278, "AAVE", 5.0, change_7d=7, tags=["defi"])
WILD = coin(999, "WILD", 40.0, market_cap=10_000_000, volume=500_000_000, tags=["defi"])


class Book(AssetBook):
    async def resolve(self, symbols: list[str]) -> SymbolResolution:
        known = {"BTC": 1, "ETH": 1027, "SOL": 5426, "AVAX": 5805, "AAVE": 7278, "WILD": 999}
        ids = {symbol: known[symbol] for symbol in symbols if symbol in known}
        missing = [symbol for symbol in symbols if symbol not in ids]
        notes = [f"{symbol} was not found in market_assets" for symbol in missing]
        return SymbolResolution(ids, notes)


class Caps(CapabilityMap):
    def __init__(self, denied: set[str] | None = None) -> None:
        self.denied = denied or set()

    def allows(self, endpoint: str) -> bool:
        return endpoint not in self.denied


class Scripted:
    def __init__(self, handlers: dict[str, object], denied: set[str] | None = None) -> None:
        self.handlers = handlers
        self.denied = denied or set()
        self.calls: list[str] = []

    async def fetch(
        self,
        endpoint: str,
        params: dict[str, object],
        _ttl: int | None = None,
        _override: str | None = None,
    ) -> tuple[dict[str, object], FetchMeta]:
        self.calls.append(endpoint)
        if endpoint in self.denied:
            raise CMCEndpointUnavailableError(endpoint, "plan")
        handler = self.handlers[endpoint]
        payload = handler(params) if callable(handler) else handler
        return payload, FetchMeta(
            data_mode="LIVE",
            freshness="FRESH",
            cache_hit=False,
            credit_cost=1,
            source_timestamp=NOW,
            retrieved_at=NOW,
        )


def envelope_deps(
    gateway: Scripted,
    denied: set[str] | None = None,
) -> tuple[ServiceDeps, MemoryEvidence]:
    evidence = MemoryEvidence()
    deps = ServiceDeps(
        gateway=gateway,
        evidence=evidence,
        assets=Book(),
        sectors=SectorBook(),
        capabilities=Caps(denied),
        now=lambda: NOW,
    )
    return deps, evidence


def assert_evidence(result: object, evidence: MemoryEvidence, tool: str) -> None:
    assert result.tool == tool
    assert result.evidence.evidence_id.startswith("ev_")
    assert result.evidence.cmc_endpoints_called
    assert result.methodology.annualization_basis == "365d"
    assert result.methodology.metrics
    assert isinstance(result.limitations, list)
    assert evidence.records[-1].evidence_id == result.evidence.evidence_id
    assert evidence.records[-1].endpoints_called == result.evidence.cmc_endpoints_called


def listings(*rows: dict[str, object]) -> dict[str, object]:
    return {"data": list(rows), "status": STATUS}


def quotes(params: dict[str, object]) -> dict[str, object]:
    wanted = {item.strip() for item in str(params.get("id", "")).split(",") if item.strip()}
    catalog = {str(row["id"]): row for row in (BTC, ETH, SOL, AVAX, AAVE, WILD)}
    return {"data": {item: catalog[item] for item in wanted if item in catalog}, "status": STATUS}


def history(params: dict[str, object]) -> dict[str, object]:
    closes = [100, 110, 99, 120, 108, 130, 117]
    if int(params["id"]) == 1:
        closes = [100, 101, 99, 103, 102, 106, 104]
    quotes_rows = []
    for index, close in enumerate(closes, start=1):
        quotes_rows.append(
            {
                "time_close": f"2026-01-{index:02d}T00:00:00.000Z",
                "quote": {"USD": {"close": close}},
            }
        )
    return {"data": {"id": int(params["id"]), "quotes": quotes_rows}, "status": STATUS}


def common_handlers() -> dict[str, object]:
    return {
        "/v1/global-metrics/quotes/latest": {
            "data": {
                "btc_dominance": 55,
                "eth_dominance": 12,
                "btc_dominance_24h_percentage_change": -0.4,
                "quote": {
                    "USD": {
                        "total_market_cap": 2_000_000_000_000,
                        "total_volume_24h": 80_000_000_000,
                        "total_market_cap_yesterday_percentage_change": 1.5,
                    }
                },
            },
            "status": STATUS,
        },
        "/v3/fear-and-greed/latest": {
            "data": [{"value": 60, "value_classification": "Greed"}],
            "status": STATUS,
        },
        "/v1/cryptocurrency/listings/latest": listings(BTC, ETH, SOL, AAVE),
        "/v2/cryptocurrency/quotes/latest": quotes,
        "/v2/cryptocurrency/info": {
            "data": {"5426": {"id": 5426, "tags": ["layer-1"]}},
            "status": STATUS,
        },
        "/v2/cryptocurrency/ohlcv/historical": history,
        "/v2/cryptocurrency/price-performance-stats/latest": {
            "data": {
                "5426": {
                    "id": 5426,
                    "periods": {
                        "30d": {"quote": {"USD": {"high": 20, "low": 8, "percent_change": 12}}}
                    },
                }
            },
            "status": STATUS,
        },
        "/v5/cryptocurrency/derivatives/market-pairs/list/latest": {
            "data": {
                "funding_rate": 0.01,
                "open_interest": 1000,
                "liquidations_24h": 25,
                "market_pairs": [{}, {}],
            },
            "status": STATUS,
        },
    }


@pytest.mark.asyncio
async def test_market_overview_envelope() -> None:
    gateway = Scripted(common_handlers())
    deps, evidence = envelope_deps(gateway)
    result = await get_market_overview(deps=deps)
    assert_evidence(result, evidence, "get_market_overview")
    assert result.data.total_market_cap == 2_000_000_000_000
    assert result.data.fear_greed_value == 60
    assert result.data.top50_breadth_positive_pct == 100
    assert result.data.btc is not None and result.data.btc.symbol == "BTC"
    assert result.status == EvidenceStatus.OK


@pytest.mark.asyncio
async def test_scan_movers_filters_parabolic_names() -> None:
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(
        BTC,
        coin(5426, "SOL", 6, market_cap=2_000_000_000, volume=200_000_000),
        coin(99, "PUMP", 80, market_cap=2_000_000_000, volume=200_000_000),
    )
    deps, evidence = envelope_deps(Scripted(handlers))
    result = await scan_market_movers(
        ScanMoversInput(min_market_cap_usd=1_000_000_000, max_24h_gain_pct=20),
        deps=deps,
    )
    assert_evidence(result, evidence, "scan_market_movers")
    assert [row.symbol for row in result.data.movers] == ["SOL"]
    assert result.data.movers[0].rs_vs_btc_7d == 3


@pytest.mark.asyncio
async def test_compare_assets_includes_relative_strength() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await compare_assets(CompareAssetsInput(symbols=["SOL", "AVAX"]), deps=deps)
    assert_evidence(result, evidence, "compare_assets")
    sol = result.data.assets[0]
    assert sol.symbol == "SOL"
    assert sol.volume_to_mcap == 0.1
    assert sol.rs_vs_btc_7d == 19
    assert sol.annualized_volatility is not None
    assert result.status == EvidenceStatus.OK


@pytest.mark.asyncio
async def test_analyze_asset_profile() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=deps)
    assert_evidence(result, evidence, "analyze_asset")
    assert result.data.cmc_id == 5426
    assert result.data.tags == ["layer-1"]
    assert result.data.circulating_supply_pct == 50
    assert result.data.price_performance[0].period == "30d"
    assert result.data.rs_vs_btc_7d == 19


@pytest.mark.asyncio
async def test_analyze_momentum_acceleration() -> None:
    from app.quant.metrics import composite_momentum_score

    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL"]), deps=deps)
    assert_evidence(result, evidence, "analyze_momentum")
    row = result.data.assets[0]
    expected_score, expected_tfs = composite_momentum_score(
        {"24h": 6.0, "7d": 20.0, "30d": 5.0, "60d": 3.0}
    )
    assert row.acceleration_7d_vs_30d == 15
    assert row.rs_vs_btc_7d == 19
    assert row.composite_momentum_score == pytest.approx(expected_score)
    assert row.timeframes_available == expected_tfs == 4


@pytest.mark.asyncio
async def test_detect_anomalies_finds_divergence_and_outlier() -> None:
    handlers = common_handlers()
    calm = [
        coin(10 + index, f"C{index}", 1.0, market_cap=100, volume=10.0 * (index + 1))
        for index in range(5)
    ]
    handlers["/v1/cryptocurrency/listings/latest"] = listings(
        coin(1, "BTC", -9.0, market_cap=100, volume=25),
        *calm,
        coin(999, "WILD", 20.0, market_cap=100, volume=10_000),
    )
    deps, evidence = envelope_deps(Scripted(handlers))
    result = await detect_market_anomalies(DetectAnomaliesInput(), deps=deps)
    assert_evidence(result, evidence, "detect_market_anomalies")
    assert any(hit.symbol == "WILD" for hit in result.data.volume_mcap_outliers)
    assert any(row.symbol == "WILD" for row in result.data.btc_divergences)


@pytest.mark.asyncio
async def test_market_regime_is_risk_on() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await analyze_market_regime(deps=deps)
    assert_evidence(result, evidence, "analyze_market_regime")
    assert result.data.regime == "RISK_ON_ALTSEASON"
    assert result.data.rationale
    assert result.data.btc_outperforming_median_alt is False


@pytest.mark.asyncio
async def test_sector_rotation_uses_fallback_tags() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await analyze_sector_rotation(SectorRotationInput(sectors=["defi"]), deps=deps)
    assert_evidence(result, evidence, "analyze_sector_rotation")
    sector = result.data.sectors[0]
    assert sector.sector_slug == "defi"
    assert sector.constituent_count == 1
    assert sector.median_change_24h_pct == 5
    assert sector.taxonomy_source == "listings_tag_fallback"
    assert sector.sample_sufficient is False
    assert sector.rotation_signal == "INSUFFICIENT_DATA"
    assert result.status == EvidenceStatus.PARTIAL
    assert any("minimum sample size" in note for note in result.limitations)


@pytest.mark.asyncio
async def test_historical_performance_uses_overlap() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    result = await get_historical_performance(HistoricalPerformanceInput(symbol="SOL"), deps=deps)
    assert_evidence(result, evidence, "get_historical_performance")
    assert result.data.overlap_days == 7
    assert result.data.simple_return == pytest.approx(117 / 100 - 1)
    assert result.data.annualized_volatility is not None
    assert result.data.max_drawdown is not None
    assert result.status == EvidenceStatus.OK


@pytest.mark.asyncio
async def test_historical_without_ohlcv_is_tier_restricted() -> None:
    gateway = Scripted(common_handlers(), denied={OHLCV})
    deps, evidence = envelope_deps(gateway, {OHLCV})
    result = await get_historical_performance(HistoricalPerformanceInput(symbol="SOL"), deps=deps)
    assert_evidence(result, evidence, "get_historical_performance")
    assert result.status == EvidenceStatus.TIER_RESTRICTED
    assert result.data.annualized_volatility is None
    assert any("unavailable" in note for note in result.limitations)


@pytest.mark.asyncio
async def test_derivatives_live_and_spot_proxy() -> None:
    deps, evidence = envelope_deps(Scripted(common_handlers()))
    live = await analyze_derivatives(DerivativesAnalysisInput(symbol="SOL"), deps=deps)
    assert_evidence(live, evidence, "analyze_derivatives")
    assert live.data.mode == "derivatives"
    assert live.data.funding_rate == 0.01
    assert live.data.market_pair_count == 2
    proxy_gateway = Scripted(common_handlers(), {DERIVATIVES})
    proxy_deps, proxy_evidence = envelope_deps(proxy_gateway, {DERIVATIVES})
    proxy = await analyze_derivatives(DerivativesAnalysisInput(symbol="SOL"), deps=proxy_deps)
    assert_evidence(proxy, proxy_evidence, "analyze_derivatives")
    assert proxy.status == EvidenceStatus.PARTIAL
    assert proxy.data.mode == "spot_stress_proxy"
    assert proxy.data.spot_volume_24h == 100_000_000
    assert any("Spot volume" in note for note in proxy.limitations)


def test_excerpt_sanitizer_drops_secrets() -> None:
    cleaned = sanitize(
        {"api_key": "secret", "price": 1, "nested": [{"authorization": "hidden", "ok": True}]}
    )
    assert cleaned == {"price": 1, "nested": [{"ok": True}]}


class FakeTable:
    def __init__(self) -> None:
        self.rows: list[dict[str, object]] = []

    def insert(self, row: dict[str, object]) -> "FakeTable":
        self.rows.append(row)
        return self

    def execute(self) -> object:
        return self.rows[-1]


class FakeDb:
    def __init__(self) -> None:
        self.evidence = FakeTable()
        self.logs = FakeTable()

    def table(self, name: str) -> FakeTable:
        return self.evidence if name == "evidence_records" else self.logs


@pytest.mark.asyncio
async def test_supabase_evidence_writer_persists_and_logs() -> None:
    from app.services.evidence import SupabaseEvidenceWriter

    database = FakeDb()
    writer = SupabaseEvidenceWriter(database)
    draft = EvidenceDraft(
        evidence_id="ev_abc1234567",
        tool_name="get_market_overview",
        asset_cmc_ids=[1],
        endpoints_called=["/v1/global-metrics/quotes/latest"],
        data_mode="LIVE",
        freshness="FRESH",
        credit_cost=1,
        engine_version="tradeguard-quant-v1.0.0",
        methodology={"annualization_basis": "365d"},
        limitations=[],
        raw_excerpt={"payloads": {}},
    )
    await writer.persist(draft)
    await writer.log_request(
        RequestLog(None, "rest", "get_market_overview", 200, 12, False, 1, draft.evidence_id)
    )
    assert database.evidence.rows[0]["evidence_id"] == "ev_abc1234567"
    assert database.logs.rows[0]["surface"] == "rest"


@pytest.mark.asyncio
async def test_shared_listings_universe_reuses_single_cmc_call_and_slices_top50() -> None:
    captured_limits: list[object] = []
    universe = [
        coin(1, "BTC", 2.0, tags=["layer-1"]),
        *[coin(100 + idx, f"C{idx}", 1.0, tags=["defi"]) for idx in range(49)],
        *[coin(500 + idx, f"TAIL{idx}", -50.0, tags=["memes"]) for idx in range(10)],
    ]
    handlers = common_handlers()

    def handle_listings(params: dict[str, object]) -> dict[str, object]:
        captured_limits.append(params.get("limit"))
        return listings(*universe)

    handlers["/v1/cryptocurrency/listings/latest"] = handle_listings
    deps, _evidence = envelope_deps(Scripted(handlers))

    overview = await get_market_overview(deps=deps)
    regime = await analyze_market_regime(deps=deps)
    movers = await scan_market_movers(ScanMoversInput(universe_size=150), deps=deps)
    anomalies = await detect_market_anomalies(DetectAnomaliesInput(universe_size=100), deps=deps)
    sectors = await analyze_sector_rotation(SectorRotationInput(sectors=["defi"]), deps=deps)

    assert captured_limits == [200, 200, 200, 200, 200]
    # All 50 top coins are positive; negative tail coins beyond index 50 are excluded from Top-50
    assert overview.data.top50_breadth_positive_pct == 100.0
    assert regime.data.top50_breadth_positive_pct == 100.0
    assert movers.tool == "scan_market_movers"
    assert anomalies.tool == "detect_market_anomalies"
    assert sectors.data.sectors[0].constituent_count == 49


def _sanitized_v5_derivatives_fixture() -> dict[str, object]:
    """Sanitized fixture reproducing live CMC v5 response ev_3b9e8bca61 (plus a duplicate ID)."""
    binance_pair = {
        "market_id": 47150,
        "category": "perpetual",
        "market_pair_symbol": "BTC/USDT",
        "outlier_detected": False,
        "exclusions": [],
        "exchange": {"exchange_id": 270, "exchange_name": "Binance", "exchange_slug": "binance"},
        "quotes": [
            {
                "price": 61374.63,
                "convert_id": 2781,
                "convert_symbol": "USD",
                "volume_24h": 13199124162.76,
                "open_interest": 5641269746.74,
                "last_updated": "2026-11-23T05:36:17.000Z",
            }
        ],
        "exchange_reported_quotes": [
            {
                "price": 61459.9,
                "convert_id": 2781,
                "convert_symbol": "USD",
                "index_price": 61376.63,
                "index_basis": 3.25e-05,
                "funding_rate": 4.806e-05,
                "open_interest": 5641269746.74,
                "last_updated": "2026-11-23T05:36:17.000Z",
            }
        ],
    }
    return {
        "data": {
            "symbol": "BTC",
            "crypto_id": 1,
            "crypto_name": "Bitcoin",
            "num_market_pairs": 183,
            "market_pairs": [
                binance_pair,
                # Duplicate market_id should be deduplicated cleanly
                dict(binance_pair),
                {
                    "market_id": 1308539,
                    "category": "perpetual",
                    "market_pair_symbol": "BTC/USDT",
                    "outlier_detected": False,
                    "exclusions": ["volume"],
                    "exchange": {
                        "exchange_id": 9449,
                        "exchange_name": "Echobit",
                        "exchange_slug": "echobit",
                    },
                    "quotes": [
                        {
                            "price": 61376.73,
                            "convert_symbol": "USD",
                            "volume_24h": 18654146016.82,
                            "open_interest": 1074157885.57,
                            "last_updated": "2026-11-23T05:36:17.000Z",
                        }
                    ],
                    "exchange_reported_quotes": [
                        {
                            "price": 61462.0,
                            "convert_symbol": "USD",
                            "funding_rate": -3.030721e-06,
                            "open_interest": 1074157885.57,
                            "last_updated": "2026-11-23T05:36:17.000Z",
                        }
                    ],
                },
                {
                    "market_id": 1621789,
                    "category": "perpetual",
                    "market_pair_symbol": "BTC/USDT",
                    "outlier_detected": True,
                    "exclusions": ["price", "volume"],
                    "exchange": {
                        "exchange_id": 9999,
                        "exchange_name": "SunX",
                        "exchange_slug": "sunx",
                    },
                    "quotes": [
                        {
                            "price": 61379.53,
                            "convert_symbol": "USD",
                            "volume_24h": 8981152995.93,
                            "open_interest": 1796113715.0,
                            "last_updated": "2026-11-23T05:36:19.000Z",
                        }
                    ],
                    "exchange_reported_quotes": [
                        {
                            "price": 61464.8,
                            "convert_symbol": "USD",
                            "funding_rate": 4.806e-05,
                            "open_interest": 1796113715.0,
                            "last_updated": "2026-11-23T05:36:19.000Z",
                        }
                    ],
                },
            ],
        },
        "status": STATUS,
    }


@pytest.mark.asyncio
async def test_derivatives_v5_nested_parser_preserves_pairs_and_documents_limits() -> None:
    handlers = common_handlers()
    handlers[DERIVATIVES] = _sanitized_v5_derivatives_fixture()
    deps, evidence = envelope_deps(Scripted(handlers))

    result = await analyze_derivatives(DerivativesAnalysisInput(symbol="BTC"), deps=deps)
    assert_evidence(result, evidence, "analyze_derivatives")
    assert result.status == EvidenceStatus.PARTIAL
    assert result.data.mode == "derivatives"
    assert result.data.market_pair_count == 183
    assert result.data.sampled_pair_count == 3
    assert result.data.open_interest_pairs_included == 2
    assert result.data.outlier_pairs_excluded == 1
    assert result.data.open_interest == pytest.approx(5641269746.74 + 1074157885.57)
    # Cross-exchange funding rate must NOT be blindly aggregated without funding intervals
    assert result.data.funding_rate is None
    # Market-wide liquidations must NOT be attributed to a single asset
    assert result.data.liquidations_24h is None
    assert len(result.data.market_pairs) == 3
    assert result.data.market_pairs[0].exchange_name == "Binance"
    assert result.data.market_pairs[0].funding_rate == pytest.approx(4.806e-05)
    assert result.data.market_pairs[2].outlier_detected is True
    joined_limits = " ".join(result.limitations)
    assert "3 of 183" in joined_limits
    assert "SunX" in joined_limits
    assert "funding intervals" in joined_limits
    assert "liquidations_24h" in joined_limits


@pytest.mark.asyncio
async def test_derivatives_empty_or_malformed_payload_never_claims_ok() -> None:
    for bad_payload in (
        {"data": {"symbol": "BTC", "num_market_pairs": 0, "market_pairs": []}, "status": STATUS},
        {"data": {"symbol": "BTC", "market_pairs": ["bad", None]}, "status": STATUS},
        {"data": None, "status": STATUS},
    ):
        handlers = common_handlers()
        handlers[DERIVATIVES] = bad_payload
        deps, _evidence = envelope_deps(Scripted(handlers))
        result = await analyze_derivatives(DerivativesAnalysisInput(symbol="BTC"), deps=deps)
        assert result.status == EvidenceStatus.INSUFFICIENT_DATA
        assert result.data.open_interest is None
        assert result.data.funding_rate is None
        assert result.data.liquidations_24h is None


def test_global_quote_dominance_delta_never_substitutes_yesterday_level() -> None:
    from app.adapters.normalizer import global_quote

    # Both current and prior present -> percentage-point delta (current - prior)
    computed = global_quote(
        {"data": {"btc_dominance": 58.92, "btc_dominance_yesterday": 58.49}},
        "USD",
    )
    assert computed["btc_dominance_change_24h"] == pytest.approx(0.43)

    # Current missing, prior present -> MUST stay None (never 58.49!)
    missing_current = global_quote({"data": {"btc_dominance_yesterday": 58.49}}, "USD")
    assert missing_current["btc_dominance_change_24h"] is None

    # Prior missing -> MUST stay None
    missing_prior = global_quote({"data": {"btc_dominance": 58.92}}, "USD")
    assert missing_prior["btc_dominance_change_24h"] is None

    # Zero prior with valid current -> valid delta
    zero_prior = global_quote(
        {"data": {"btc_dominance": 1.5, "btc_dominance_yesterday": 0.0}},
        "USD",
    )
    assert zero_prior["btc_dominance_change_24h"] == pytest.approx(1.5)

    # Out-of-range / malformed -> None
    malformed = global_quote(
        {"data": {"btc_dominance": 150.0, "btc_dominance_yesterday": 58.0}},
        "USD",
    )
    assert malformed["btc_dominance_change_24h"] is None
    bad_type = global_quote(
        {"data": {"btc_dominance": "58.9", "btc_dominance_yesterday": True}},
        "USD",
    )
    assert bad_type["btc_dominance_change_24h"] is None


@pytest.mark.asyncio
async def test_byok_per_key_capability_isolation_and_concurrency() -> None:
    import asyncio
    from pathlib import Path

    from app.services.intelligence import CapabilityMap

    class ServerRestrictedMap(CapabilityMap):
        def _server_allows(self, endpoint: str) -> bool:
            return endpoint != OHLCV

    class KeyScopedGateway:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str | None]] = []

        async def fetch(
            self,
            endpoint: str,
            params: dict[str, object],
            _ttl: int | None = None,
            override: str | None = None,
        ) -> tuple[dict[str, object], FetchMeta]:
            self.calls.append((endpoint, override))
            if endpoint == OHLCV:
                if override == "byok_pro_key_alpha_12345":
                    return history(params), FetchMeta(
                        data_mode="LIVE",
                        freshness="FRESH",
                        cache_hit=False,
                        credit_cost=1,
                        source_timestamp=NOW,
                        retrieved_at=NOW,
                    )
                raise CMCEndpointUnavailableError(
                    endpoint,
                    "HTTP 403 CMC 1006 Plan Upgrade Required",
                    tier_restricted=True,
                )
            handler = common_handlers()[endpoint]
            payload = handler(params) if callable(handler) else handler
            return payload, FetchMeta(
                data_mode="LIVE",
                freshness="FRESH",
                cache_hit=False,
                credit_cost=1,
                source_timestamp=NOW,
                retrieved_at=NOW,
            )

    cap_map = ServerRestrictedMap()
    gateway = KeyScopedGateway()
    evidence = MemoryEvidence()
    deps = ServiceDeps(
        gateway=gateway,
        evidence=evidence,
        assets=Book(),
        sectors=SectorBook(),
        capabilities=cap_map,
        now=lambda: NOW,
    )

    # Run server key, entitled BYOK A, and restricted BYOK B concurrently
    server_res, key_a_res, key_b_res = await asyncio.gather(
        get_historical_performance(HistoricalPerformanceInput(symbol="SOL"), deps=deps),
        get_historical_performance(
            HistoricalPerformanceInput(symbol="SOL"),
            override_cmc_key="byok_pro_key_alpha_12345",
            deps=deps,
        ),
        get_historical_performance(
            HistoricalPerformanceInput(symbol="SOL"),
            override_cmc_key="byok_basic_key_beta_67890",
            deps=deps,
        ),
    )

    assert server_res.status == EvidenceStatus.TIER_RESTRICTED
    assert key_a_res.status == EvidenceStatus.OK
    assert key_a_res.data.annualized_volatility is not None
    assert key_b_res.status == EvidenceStatus.TIER_RESTRICTED
    assert key_b_res.data.annualized_volatility is None

    # Key A success must NOT contaminate server key or Key B
    assert cap_map.state(OHLCV, None) == "DENIED"
    assert cap_map.state(OHLCV, "byok_pro_key_alpha_12345") == "ALLOWED"
    assert cap_map.state(OHLCV, "byok_basic_key_beta_67890") == "DENIED"
    # Key A's OHLCV success must NOT imply PERFORMANCE is allowed (stays UNKNOWN)
    perf_ep = "/v2/cryptocurrency/price-performance-stats/latest"
    assert cap_map.state(perf_ep, "byok_pro_key_alpha_12345") == "UNKNOWN"

    # Raw BYOK keys must NEVER appear in capability map keys or returned payloads
    raw_keys_blob = str(list(cap_map._byok_states.keys()))
    assert "byok_pro_key_alpha_12345" not in raw_keys_blob
    assert "byok_basic_key_beta_67890" not in raw_keys_blob
    assert "byok_pro_key_alpha_12345" not in key_a_res.model_dump_json()
    assert "byok_basic_key_beta_67890" not in key_b_res.model_dump_json()

    # Second call for restricted Key B skips repeat OHLCV HTTP attempt due to cached DENIED
    beta_key = "byok_basic_key_beta_67890"
    calls_before = sum(1 for ep, cred in gateway.calls if ep == OHLCV and cred == beta_key)
    key_b_second = await get_historical_performance(
        HistoricalPerformanceInput(symbol="SOL"),
        override_cmc_key=beta_key,
        deps=deps,
    )
    calls_after = sum(1 for ep, cred in gateway.calls if ep == OHLCV and cred == beta_key)
    assert key_b_second.status == EvidenceStatus.TIER_RESTRICTED
    assert calls_after == calls_before
    _ = Path  # keep scope clean


@pytest.mark.asyncio
async def test_byok_401_429_5xx_do_not_cache_denied_and_report_accurate_status() -> None:
    import httpx
    import respx
    from tests.test_cmc_adapter import MemorySnapshotStore

    from app.adapters.cmc_client import CMCClient
    from app.services.intelligence import CapabilityMap

    async def noop_sleep(_seconds: float) -> None:
        return None

    base = "https://pro-api.coinmarketcap.com"
    cap_map = CapabilityMap()
    store = MemorySnapshotStore()
    evidence = MemoryEvidence()
    key_401 = "byok_invalid_auth_401_key"
    key_403 = "byok_plan_denied_403_key"
    key_429 = "byok_rate_limited_429_key"
    key_503 = "byok_upstream_err_503_key"
    calls_by_key: dict[str, int] = {}
    recover_429 = [False]
    fail_503_after_ok = [False]

    def ohlcv_responder(request: httpx.Request) -> httpx.Response:
        sent_key = request.headers.get("X-CMC_PRO_API_KEY", "")
        calls_by_key[sent_key] = calls_by_key.get(sent_key, 0) + 1
        cid = int(request.url.params.get("id", "1"))
        if sent_key == key_401:
            return httpx.Response(401, json={"status": {"error_code": 1001}})
        if sent_key == key_403:
            return httpx.Response(403, json={"status": {"error_code": 1006}})
        if sent_key == key_429:
            if recover_429[0]:
                return httpx.Response(200, json=history({"id": cid}))
            return httpx.Response(429, json={"status": {"error_code": 1008}})
        if sent_key == key_503:
            if fail_503_after_ok[0]:
                return httpx.Response(503, json={"status": {"error_code": 500}})
            return httpx.Response(200, json=history({"id": cid}))
        return httpx.Response(403, json={"status": {"error_code": 1006}})

    with respx.mock(assert_all_called=False) as router:
        router.get(f"{base}{OHLCV}").mock(side_effect=ohlcv_responder)
        async with CMCClient(
            api_key="server_key_restricted",
            base_url=base,
            snapshot_store=store,
            simulate_basic_tier=False,
            sleep=noop_sleep,
            now=lambda: NOW,
        ) as client:
            deps = ServiceDeps(
                gateway=client,
                evidence=evidence,
                assets=Book(),
                sectors=SectorBook(),
                capabilities=cap_map,
                now=lambda: NOW,
            )

            # 1. 401 Invalid Credential -> INSUFFICIENT_DATA, state stays UNKNOWN (not DENIED)
            res_401 = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_401,
                deps=deps,
            )
            assert res_401.status == EvidenceStatus.INSUFFICIENT_DATA
            assert cap_map.state(OHLCV, key_401) == "UNKNOWN"
            assert any("Invalid API Key" in note for note in res_401.limitations)

            # 2. 403/1006 Access Denied -> TIER_RESTRICTED, caches DENIED, skips repeat call
            res_403 = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_403,
                deps=deps,
            )
            assert res_403.status == EvidenceStatus.TIER_RESTRICTED
            assert cap_map.state(OHLCV, key_403) == "DENIED"
            count_403_first = calls_by_key[key_403]
            res_403_again = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_403,
                deps=deps,
            )
            assert res_403_again.status == EvidenceStatus.TIER_RESTRICTED
            assert calls_by_key[key_403] == count_403_first

            # 3. 429 Rate Limited -> INSUFFICIENT_DATA, never cached DENIED, recovers on retry
            res_429 = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_429,
                deps=deps,
            )
            assert res_429.status == EvidenceStatus.INSUFFICIENT_DATA
            assert cap_map.state(OHLCV, key_429) == "UNKNOWN"
            assert any("rate limit" in note.lower() for note in res_429.limitations)
            recover_429[0] = True
            res_429_ok = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_429,
                deps=deps,
            )
            assert res_429_ok.status == EvidenceStatus.OK
            assert cap_map.state(OHLCV, key_429) == "ALLOWED"

            # 4. 503 Transient Error -> never cached DENIED & preserves prior ALLOWED state
            res_503_ok = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_503,
                deps=deps,
            )
            assert res_503_ok.status == EvidenceStatus.OK
            assert cap_map.state(OHLCV, key_503) == "ALLOWED"
            fail_503_after_ok[0] = True
            res_503_err = await get_historical_performance(
                HistoricalPerformanceInput(symbol="SOL"),
                override_cmc_key=key_503,
                deps=deps,
            )
            assert res_503_err.status == EvidenceStatus.INSUFFICIENT_DATA
            assert cap_map.state(OHLCV, key_503) == "ALLOWED"
            assert any("upstream server error" in note.lower() for note in res_503_err.limitations)


@pytest.mark.asyncio
async def test_momentum_score_is_identical_across_scan_compare_and_momentum() -> None:
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, ETH, SOL, AVAX, AAVE)
    deps, _evidence = envelope_deps(Scripted(handlers))

    scanned = await scan_market_movers(ScanMoversInput(limit=10), deps=deps)
    compared = await compare_assets(CompareAssetsInput(symbols=["SOL", "AVAX"]), deps=deps)
    momentum = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL", "AVAX"]), deps=deps)

    scan_sol = next(row for row in scanned.data.movers if row.symbol == "SOL")
    cmp_sol = next(row for row in compared.data.assets if row.symbol == "SOL")
    mom_sol = next(row for row in momentum.data.assets if row.symbol == "SOL")

    assert scan_sol.composite_momentum_score is not None
    assert scan_sol.composite_momentum_score == pytest.approx(cmp_sol.composite_momentum_score)
    assert cmp_sol.composite_momentum_score == pytest.approx(mom_sol.composite_momentum_score)
    assert cmp_sol.percent_change_60d == 3.0
    assert scan_sol.timeframes_available == 4
    assert cmp_sol.timeframes_available == 4
    assert mom_sol.timeframes_available == 4


@pytest.mark.asyncio
async def test_analyze_asset_skips_info_when_unresolved_and_marks_partial() -> None:
    from app.services.intelligence import INFO, MAP, PERFORMANCE

    handlers = common_handlers()
    handlers[MAP] = {"data": [], "status": STATUS}
    gateway = Scripted(handlers)
    deps, _evidence = envelope_deps(gateway)

    missing = await analyze_asset(AnalyzeAssetInput(symbol="UNKNOWN99"), deps=deps)
    assert missing.status == EvidenceStatus.INSUFFICIENT_DATA
    assert missing.data.cmc_id is None
    assert INFO not in gateway.calls
    assert any("could not be resolved" in note for note in missing.limitations)

    restricted_gateway = Scripted(common_handlers(), denied={OHLCV, PERFORMANCE})
    restricted_deps, _ev2 = envelope_deps(restricted_gateway, denied={OHLCV, PERFORMANCE})
    partial = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=restricted_deps)
    assert partial.status == EvidenceStatus.PARTIAL
    assert partial.data.cmc_id == 5426
    assert partial.data.annualized_volatility is None
    assert len(partial.limitations) == len(set(partial.limitations))


@pytest.mark.asyncio
async def test_compare_assets_marks_partial_and_deduplicates_ohlcv_limitations() -> None:
    gateway = Scripted(common_handlers(), denied={OHLCV})
    deps, _evidence = envelope_deps(gateway, denied={OHLCV})

    result = await compare_assets(CompareAssetsInput(symbols=["SOL", "AVAX", "AAVE"]), deps=deps)
    assert result.status == EvidenceStatus.PARTIAL
    ohlcv_notes = [note for note in result.limitations if OHLCV in note]
    assert len(ohlcv_notes) == 1
    assert len(result.limitations) == len(set(result.limitations))


@pytest.mark.asyncio
async def test_zero_payload_evidence_uses_unavailable_data_mode_and_db_safe_persistence() -> None:
    from app.api.v1.evidence import _public_row
    from app.schemas.envelope import DataMode
    from app.services.evidence import SupabaseEvidenceWriter

    gateway = Scripted(common_handlers(), denied={OHLCV})
    db = FakeDb()
    writer = SupabaseEvidenceWriter(db)
    deps = ServiceDeps(
        gateway=gateway,
        evidence=writer,
        assets=Book(),
        sectors=SectorBook(),
        capabilities=Caps({OHLCV}),
        now=lambda: NOW,
    )
    result = await get_historical_performance(HistoricalPerformanceInput(symbol="SOL"), deps=deps)
    assert result.status == EvidenceStatus.TIER_RESTRICTED
    assert result.evidence.data_mode == DataMode.UNAVAILABLE
    assert db.evidence.rows[0]["data_mode"] == "VERIFIED_SNAPSHOT_FALLBACK"
    assert db.evidence.rows[0]["methodology"]["actual_data_mode"] == "UNAVAILABLE"
    restored = _public_row(db.evidence.rows[0])
    assert restored["data_mode"] == "UNAVAILABLE"


@pytest.mark.asyncio
async def test_sector_book_db_loading_threshold_and_overlap_disclosure() -> None:
    from app.services.intelligence import CATEGORIES, CATEGORY

    class _Query:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self._rows = rows

        def select(self, _cols: str) -> "_Query":
            return self

        def eq(self, _col: str, _val: object) -> "_Query":
            return self

        def order(self, _col: str, desc: bool = False) -> "_Query":
            _ = desc
            return self

        def limit(self, _n: int) -> "_Query":
            return self

        def execute(self) -> object:
            return type("Resp", (), {"data": self._rows})()

    class _SectorDb:
        def table(self, name: str) -> _Query:
            if name == "sector_mappings":
                return _Query(
                    [
                        {
                            "sector_slug": "defi",
                            "display_name": "DeFi",
                            "cmc_category_id": None,
                            "fallback_tags": ["defi"],
                        },
                        {
                            "sector_slug": "layer-1",
                            "display_name": "Layer 1",
                            "cmc_category_id": None,
                            "fallback_tags": ["layer-1"],
                        },
                        {
                            "sector_slug": "rwa",
                            "display_name": "Real World Assets",
                            "cmc_category_id": None,
                            "fallback_tags": ["real-world-assets"],
                        },
                    ]
                )
            return _Query(
                [
                    {
                        "payload": {
                            "data": [
                                {"id": "cat_layer1_123", "name": "Layer 1"},
                            ]
                        }
                    }
                ]
            )

    book = SectorBook(client=_SectorDb(), use_db=True, enrich_from_snapshots=True)
    loaded = await book.load()
    l1 = next(s for s in loaded if s.slug == "layer-1")
    assert l1.category_id == "cat_layer1_123"
    _ = CATEGORIES

    defi_coins = [coin(200 + i, f"D{i}", 6.0, change_7d=9.0, tags=["defi"]) for i in range(5)]
    overlap_coin = coin(299, "OVER", 5.0, change_7d=8.0, tags=["defi", "real-world-assets"])
    rwa_only = coin(300, "RWA1", 4.0, change_7d=6.0, tags=["real-world-assets"])
    l1_coins = [coin(400 + i, f"L{i}", 3.0, change_7d=7.0, tags=["layer-1"]) for i in range(5)]

    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(*defi_coins, overlap_coin, rwa_only)
    handlers[CATEGORY] = {"data": {"coins": l1_coins}, "status": STATUS}

    deps = ServiceDeps(
        gateway=Scripted(handlers),
        evidence=MemoryEvidence(),
        assets=Book(),
        sectors=book,
        capabilities=Caps(),
        now=lambda: NOW,
    )
    result = await analyze_sector_rotation(
        SectorRotationInput(sectors=["defi", "layer-1", "rwa"]),
        deps=deps,
    )
    by_slug = {item.sector_slug: item for item in result.data.sectors}
    assert by_slug["defi"].sample_sufficient is True
    assert by_slug["defi"].rotation_signal == "LEADING"
    assert by_slug["defi"].taxonomy_source == "listings_tag_fallback"
    assert by_slug["layer-1"].taxonomy_source == "cmc_category"
    assert by_slug["layer-1"].sample_sufficient is True
    assert by_slug["rwa"].constituent_count == 2
    assert by_slug["rwa"].sample_sufficient is False
    assert by_slug["rwa"].rotation_signal == "INSUFFICIENT_DATA"
    assert result.data.overlapping_asset_count == 1
    assert result.data.unique_constituent_count == 12
    assert result.status == EvidenceStatus.PARTIAL
    assert any("multi-tag overlap" in note for note in result.limitations)
    assert any("v5 RWA endpoints" in note for note in result.limitations)


@pytest.mark.asyncio
async def test_market_regime_service_surfaces_signal_conflict_on_audit_snapshot() -> None:
    handlers = common_handlers()
    handlers["/v1/global-metrics/quotes/latest"] = {
        "data": {
            "btc_dominance": 56.14,
            "btc_dominance_yesterday": 55.73,
            "eth_dominance": 12.0,
            "quote": {
                "USD": {
                    "total_market_cap": 2_400_000_000_000,
                    "total_volume_24h": 95_000_000_000,
                    "total_market_cap_yesterday_percentage_change": 3.63,
                }
            },
        },
        "status": STATUS,
    }
    handlers["/v3/fear-and-greed/latest"] = {
        "data": [{"value": 9, "value_classification": "Extreme Fear"}],
        "status": STATUS,
    }
    rally_rows = [
        coin(1, "BTC", 5.0),
        *[coin(100 + i, f"A{i}", 3.0 if i < 46 else -1.0) for i in range(49)],
    ]
    handlers["/v1/cryptocurrency/listings/latest"] = listings(*rally_rows)
    deps, _evidence = envelope_deps(Scripted(handlers))

    result = await analyze_market_regime(deps=deps)
    assert result.status == EvidenceStatus.OK
    assert result.data.regime == "RANGE_CONSOLIDATION"
    assert result.data.signal_conflict is True
    assert result.data.confidence == "LOW"
    assert result.data.dominant_signals
    assert result.data.conflicting_signals
    assert any("conflict" in note.lower() for note in result.limitations)


@pytest.mark.asyncio
async def test_stablecoin_hygiene_excludes_stables_and_preserves_unknown() -> None:
    handlers = common_handlers()
    stables = [
        coin(
            39120,
            "U",
            0.05,
            change_7d=0.08,
            change_30d=0.10,
            tags=["stablecoin", "asset-backed-stablecoin"],
        ),
        coin(
            36148,
            "USD1",
            -0.02,
            change_7d=0.11,
            change_30d=0.07,
            tags=["stablecoin", "usd-stablecoin"],
        ),
        coin(
            27772,
            "PYUSD",
            -0.05,
            change_7d=0.01,
            change_30d=-0.01,
            tags=["stablecoin", "fiat-stablecoin"],
        ),
    ]
    protocol_token = coin(
        38482,
        "FF",
        2.5,
        change_7d=5.0,
        change_30d=8.0,
        tags=["stablecoin-protocol"],
    )
    unknown_tag_coin = coin(77777, "MYST", 3.0, change_7d=6.0, change_30d=9.0, tags=[])
    handlers["/v1/cryptocurrency/listings/latest"] = listings(
        BTC,
        SOL,
        AVAX,
        protocol_token,
        unknown_tag_coin,
        *stables,
    )
    deps, _ev = envelope_deps(Scripted(handlers))

    movers = await scan_market_movers(ScanMoversInput(limit=20), deps=deps)
    mover_syms = {row.symbol for row in movers.data.movers}
    assert {"U", "USD1", "PYUSD"}.isdisjoint(mover_syms)
    assert "FF" in mover_syms  # stablecoin-protocol is NOT a verified stablecoin
    assert "MYST" in mover_syms  # unknown tags preserved, not silently discarded
    assert any("3 verified stablecoin" in note for note in movers.limitations)
    assert any("unknown stablecoin status" in note for note in movers.limitations)

    overview = await get_market_overview(deps=deps)
    gainer_loser_syms = {
        row.symbol for row in [*overview.data.top_gainers, *overview.data.top_losers]
    }
    assert {"U", "USD1", "PYUSD"}.isdisjoint(gainer_loser_syms)
    # Stablecoins remain preserved in aggregate market breadth (5 positive of 8 total)
    assert overview.data.top50_breadth_positive_pct == pytest.approx(6 * 100.0 / 8.0)


@pytest.mark.asyncio
async def test_anomaly_thresholds_unaffected_by_stablecoins_and_classify_volume_tails() -> None:
    base_non_stables = [
        coin(1, "BTC", 2.0, market_cap=1_000_000_000, volume=80_000_000, tags=["layer-1"]),
        coin(10, "N1", 1.0, market_cap=1_000_000_000, volume=70_000_000, tags=["defi"]),
        coin(11, "N2", 3.0, market_cap=1_000_000_000, volume=90_000_000, tags=["defi"]),
        coin(12, "N3", -1.0, market_cap=1_000_000_000, volume=60_000_000, tags=["defi"]),
        coin(13, "N4", 4.0, market_cap=1_000_000_000, volume=85_000_000, tags=["defi"]),
        coin(14, "N5", -2.5, market_cap=1_000_000_000, volume=75_000_000, tags=["defi"]),
        coin(15, "N6", 2.5, market_cap=1_000_000_000, volume=95_000_000, tags=["defi"]),
        coin(16, "N7", -3.0, market_cap=1_000_000_000, volume=65_000_000, tags=["defi"]),
        coin(3957, "LEO", 0.5, market_cap=1_000_000_000, volume=50_000, tags=["cex-token"]),
        coin(35491, "M", -0.2, market_cap=1_000_000_000, volume=500_000, tags=["memes"]),
        coin(9001, "TRUMP", 5.0, market_cap=1_000_000_000, volume=2_500_000_000, tags=["memes"]),
    ]
    twenty_stables = [
        coin(
            50000 + i,
            f"USD{i}",
            0.0,
            market_cap=2_000_000_000,
            volume=100_000_000,
            tags=["stablecoin", "usd-stablecoin"],
        )
        for i in range(20)
    ]

    h_clean = common_handlers()
    h_clean["/v1/cryptocurrency/listings/latest"] = listings(*base_non_stables)
    d_clean, _ = envelope_deps(Scripted(h_clean))
    res_clean = await detect_market_anomalies(DetectAnomaliesInput(universe_size=50), deps=d_clean)

    h_mixed = common_handlers()
    h_mixed["/v1/cryptocurrency/listings/latest"] = listings(*base_non_stables, *twenty_stables)
    d_mixed, _ = envelope_deps(Scripted(h_mixed))
    res_mixed = await detect_market_anomalies(DetectAnomaliesInput(universe_size=50), deps=d_mixed)

    # Identical outlier hits & exact Z/MAD values despite 20 injected stablecoins
    assert res_mixed.data.price_change_outliers == res_clean.data.price_change_outliers
    assert res_mixed.data.volume_mcap_outliers == res_clean.data.volume_mcap_outliers
    assert any("20 verified stablecoin" in note for note in res_mixed.limitations)

    # Volume direction classification separates TRUMP (positive) from LEO/M (negative, NOT spikes)
    assert "high-volume" in res_mixed.summary
    assert "low-volume/illiquidity" in res_mixed.summary
    dir_note = next(
        note for note in res_mixed.limitations if "outlier direction breakdown" in note.lower()
    )
    assert "TRUMP" in dir_note
    assert "LEO" in dir_note
    assert "M" in dir_note
    assert "NOT volume spikes" in dir_note
    assert "neither bullish nor bearish" in dir_note

    # Insufficient sample (< 5 eligible non-stablecoins) explicitly withheld
    h_tiny = common_handlers()
    h_tiny["/v1/cryptocurrency/listings/latest"] = listings(*base_non_stables[:3], *twenty_stables)
    d_tiny, _ = envelope_deps(Scripted(h_tiny))
    res_tiny = await detect_market_anomalies(DetectAnomaliesInput(universe_size=50), deps=d_tiny)
    assert res_tiny.status == EvidenceStatus.INSUFFICIENT_DATA
    assert res_tiny.data.volume_mcap_outliers == []
    assert res_tiny.data.price_change_outliers == []
    assert any("below minimum 5" in note for note in res_tiny.limitations)


@pytest.mark.asyncio
async def test_scan_market_movers_flags_pieverse_multi_horizon_risk_and_missing_history() -> None:
    pieverse = coin(
        38849,
        "PIEVERSE",
        -14.33,
        change_7d=90.51,
        change_30d=243.71,
        market_cap=1_075_000_000,
        volume=572_000_000,
        tags=["payments"],
    )
    fresh_token = coin(
        99999,
        "FRESH",
        8.0,
        change_7d=12.0,
        change_30d=15.0,
        market_cap=500_000_000,
        volume=50_000_000,
        tags=["defi"],
    )
    # Remove 30d to verify missing horizon is NOT zero-filled
    fresh_token["quote"]["USD"]["percent_change_30d"] = None  # type: ignore[index]

    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, pieverse, fresh_token)
    deps, _ = envelope_deps(Scripted(handlers))

    res = await scan_market_movers(ScanMoversInput(max_24h_gain_pct=18, limit=10), deps=deps)
    assert any("PIEVERSE=SHARP_RETRACEMENT" in note for note in res.limitations)
    assert any("not a confirmed reversal" in note for note in res.limitations)
    assert any("FRESH" in note and "missing 7d or 30d" in note for note in res.limitations)


@pytest.mark.asyncio
async def test_cross_tool_momentum_parity_includes_analyze_asset_inputs() -> None:
    from app.quant.metrics import composite_momentum_score

    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, SOL, AVAX)
    deps, _ = envelope_deps(Scripted(handlers))

    asset = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=deps)
    compared = await compare_assets(CompareAssetsInput(symbols=["SOL", "AVAX"]), deps=deps)
    momentum = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL", "AVAX"]), deps=deps)
    scanned = await scan_market_movers(ScanMoversInput(limit=10), deps=deps)

    cmp_sol = next(row for row in compared.data.assets if row.symbol == "SOL")
    mom_sol = next(row for row in momentum.data.assets if row.symbol == "SOL")
    scan_sol = next(row for row in scanned.data.movers if row.symbol == "SOL")

    # Canonical computation from analyze_asset's 24h/7d/30d + quote 60d matches all 3 workflows
    canonical, tf = composite_momentum_score(
        {
            "24h": asset.data.percent_change_24h,
            "7d": asset.data.percent_change_7d,
            "30d": asset.data.percent_change_30d,
            "60d": cmp_sol.percent_change_60d,
        }
    )
    assert tf == 4
    assert cmp_sol.composite_momentum_score == pytest.approx(canonical)
    assert mom_sol.composite_momentum_score == pytest.approx(canonical)
    assert scan_sol.composite_momentum_score == pytest.approx(canonical)


def test_summarize_calls_data_mode_semantics_across_all_combinations() -> None:
    from app.services.evidence import CallRecord, summarize_calls

    live_meta = FetchMeta("LIVE", "FRESH", False, 1, NOW, NOW)
    cached_meta = FetchMeta("CACHED", "FRESH", True, 0, NOW, NOW)
    fallback_meta = FetchMeta("VERIFIED_SNAPSHOT_FALLBACK", "AGING", True, 0, NOW, NOW)
    no_ts_meta = FetchMeta("LIVE", "FRESH", False, 1, None, None)

    # 1. All LIVE
    all_live = summarize_calls(
        [CallRecord("/a", {}, live_meta), CallRecord("/b", {}, live_meta)],
        NOW,
    )
    assert all_live.data_mode == "LIVE"
    assert not any("Mixed data sources" in item for item in all_live.limitations)

    # 2. All CACHED
    all_cached = summarize_calls([CallRecord("/a", {}, cached_meta)], NOW)
    assert all_cached.data_mode == "CACHED"
    assert all_cached.cache_hit is True
    assert not any("Mixed data sources" in item for item in all_cached.limitations)

    # 3. Mixed LIVE + CACHED -> conservative CACHED (never LIVE!) + explicit mixed limitation
    mixed = summarize_calls(
        [CallRecord("/quotes", {}, live_meta), CallRecord("/info", {}, cached_meta)],
        NOW,
    )
    assert mixed.data_mode == "CACHED"
    assert mixed.cache_hit is False
    assert set(mixed.source_timestamps.keys()) == {"/quotes", "/info"}
    assert any("Mixed data sources" in item for item in mixed.limitations)

    # 4. Mixed VERIFIED_SNAPSHOT_FALLBACK + LIVE -> VERIFIED_SNAPSHOT_FALLBACK + mixed note
    mixed_fb = summarize_calls(
        [CallRecord("/quotes", {}, live_meta), CallRecord("/ohlcv", {}, fallback_meta)],
        NOW,
    )
    assert mixed_fb.data_mode == "VERIFIED_SNAPSHOT_FALLBACK"
    assert mixed_fb.freshness == "AGING"
    assert any("Mixed data sources" in item for item in mixed_fb.limitations)

    # 5. PARTIAL (one live call + one error record) -> LIVE for successful feed + error preserved
    partial = summarize_calls(
        [CallRecord("/quotes", {}, live_meta), CallRecord("/ohlcv", error="plan restricted")],
        NOW,
    )
    assert partial.data_mode == "LIVE"
    assert "plan restricted" in partial.limitations

    # 6. UNAVAILABLE (zero payloads)
    unavail = summarize_calls([CallRecord("/ohlcv", error="plan restricted")], NOW)
    assert unavail.data_mode == "UNAVAILABLE"
    assert unavail.freshness == "STALE"

    # 7. Missing timestamps handled cleanly
    missing_ts = summarize_calls([CallRecord("/quotes", {}, no_ts_meta)], NOW)
    assert missing_ts.data_mode == "LIVE"
    assert missing_ts.source_timestamps == {}
    assert missing_ts.retrieved_at == NOW


@pytest.mark.asyncio
async def test_analyze_asset_vs_analyze_momentum_parity_and_missing_60d() -> None:
    handlers = common_handlers()
    deps, _ = envelope_deps(Scripted(handlers))

    asset = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=deps)
    momentum = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL"]), deps=deps)
    mom_sol = momentum.data.assets[0]

    assert asset.data.percent_change_60d == mom_sol.percent_change_60d == 3.0
    assert asset.data.composite_momentum_score == pytest.approx(mom_sol.composite_momentum_score)
    assert asset.data.timeframes_available == mom_sol.timeframes_available == 4

    # Missing 60d stays None (never 0) and timeframes_available reports genuinely available 3
    sol_no_60d = coin(5426, "SOL", 6.0, change_7d=20.0, change_30d=5.0, tags=["layer-1"])
    sol_no_60d["quote"]["USD"]["percent_change_60d"] = None  # type: ignore[index]

    def quotes_missing_60d(params: dict[str, object]) -> dict[str, object]:
        payload = quotes(params)
        data = payload["data"]
        if isinstance(data, dict) and "5426" in data:
            data["5426"] = sol_no_60d
        return payload

    handlers_partial = common_handlers()
    handlers_partial["/v2/cryptocurrency/quotes/latest"] = quotes_missing_60d
    deps_partial, _ = envelope_deps(Scripted(handlers_partial))

    asset_partial = await analyze_asset(AnalyzeAssetInput(symbol="SOL"), deps=deps_partial)
    mom_partial = await analyze_momentum(AnalyzeMomentumInput(symbols=["SOL"]), deps=deps_partial)
    assert asset_partial.data.percent_change_60d is None
    assert asset_partial.data.timeframes_available == 3
    assert asset_partial.data.composite_momentum_score == pytest.approx(
        mom_partial.data.assets[0].composite_momentum_score
    )
    assert any("3 of 4 momentum timeframes" in note for note in asset_partial.limitations)


@pytest.mark.asyncio
async def test_scan_movers_structured_multi_horizon_risk_and_max_7d_filter() -> None:
    night = coin(
        39001,
        "NIGHT",
        11.53,
        change_7d=14.20,
        change_30d=31.81,
        market_cap=500_000_000,
        volume=80_000_000,
        tags=["layer-1"],
    )
    pieverse = coin(
        38849,
        "PIEVERSE",
        -14.33,
        change_7d=90.51,
        change_30d=243.71,
        market_cap=1_075_000_000,
        volume=572_000_000,
        tags=["payments"],
    )
    extended = coin(
        38850,
        "EXTND",
        5.0,
        change_7d=60.0,
        change_30d=140.0,
        market_cap=700_000_000,
        volume=100_000_000,
        tags=["defi"],
    )
    missing_7d = coin(
        38851,
        "MISS7",
        6.0,
        change_7d=10.0,
        change_30d=20.0,
        market_cap=500_000_000,
        volume=60_000_000,
        tags=["defi"],
    )
    missing_7d["quote"]["USD"]["percent_change_7d"] = None  # type: ignore[index]

    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(
        BTC, night, pieverse, extended, missing_7d
    )
    deps, _ = envelope_deps(Scripted(handlers))

    base = await scan_market_movers(ScanMoversInput(max_24h_gain_pct=18.0, limit=10), deps=deps)
    by_sym = {row.symbol: row for row in base.data.movers}
    assert by_sym["NIGHT"].multi_horizon_risk == "RECENT_MOMENTUM"
    assert by_sym["PIEVERSE"].multi_horizon_risk == "SHARP_RETRACEMENT"
    assert by_sym["EXTND"].multi_horizon_risk == "EXTENDED_RALLY"
    assert by_sym["MISS7"].multi_horizon_risk == "INSUFFICIENT_HISTORY"

    # Applying max_7d_gain_pct=40 excludes PIEVERSE (+90.5%), EXTND (+60%), and MISS7 (None)
    capped = await scan_market_movers(
        ScanMoversInput(max_24h_gain_pct=18.0, max_7d_gain_pct=40.0, limit=10),
        deps=deps,
    )
    assert [row.symbol for row in capped.data.movers] == ["NIGHT"]
    assert capped.data.movers[0].composite_momentum_score == pytest.approx(
        by_sym["NIGHT"].composite_momentum_score
    )


@pytest.mark.asyncio
async def test_anomaly_hit_structured_direction_without_trading_advice() -> None:
    universe = [
        coin(1, "BTC", 2.0, market_cap=1_000_000_000, volume=80_000_000, tags=["layer-1"]),
        coin(10, "N1", 1.0, market_cap=1_000_000_000, volume=70_000_000, tags=["defi"]),
        coin(11, "N2", 2.0, market_cap=1_000_000_000, volume=90_000_000, tags=["defi"]),
        coin(12, "N3", -1.0, market_cap=1_000_000_000, volume=60_000_000, tags=["defi"]),
        coin(13, "N4", 3.0, market_cap=1_000_000_000, volume=85_000_000, tags=["defi"]),
        coin(14, "N5", -2.0, market_cap=1_000_000_000, volume=75_000_000, tags=["defi"]),
        coin(15, "N6", 2.5, market_cap=1_000_000_000, volume=95_000_000, tags=["defi"]),
        coin(16, "N7", -2.5, market_cap=1_000_000_000, volume=65_000_000, tags=["defi"]),
        coin(3957, "LEO", 0.5, market_cap=1_000_000_000, volume=50_000, tags=["cex-token"]),
        coin(9001, "TRUMP", 45.0, market_cap=1_000_000_000, volume=2_500_000_000, tags=["memes"]),
    ]
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(*universe)
    deps, _ = envelope_deps(Scripted(handlers))

    result = await detect_market_anomalies(DetectAnomaliesInput(universe_size=50), deps=deps)
    vol_by_sym = {hit.symbol: hit for hit in result.data.volume_mcap_outliers}
    assert vol_by_sym["TRUMP"].direction == "HIGH_VOLUME_TO_MCAP"
    assert vol_by_sym["LEO"].direction == "LOW_VOLUME_ILLIQUIDITY"
    # Price-change outliers stay descriptive (direction=None, never bullish/bearish)
    assert result.data.price_change_outliers
    assert all(hit.direction is None for hit in result.data.price_change_outliers)


@pytest.mark.asyncio
async def test_sector_excess_returns_benchmark_missing_and_mixed_timestamps() -> None:
    from datetime import timedelta

    from app.services.intelligence import CATEGORY, SectorDef

    # Non-stable market rows: medians 24h = 2.0%, 7d = -4.0% (stablecoins excluded from benchmark)
    market_rows = [
        coin(1, "BTC", 1.0, change_7d=-6.0, tags=["layer-1"]),
        coin(2, "ETH", 2.0, change_7d=-4.0, tags=["layer-1"]),
        coin(3, "SOL", 3.0, change_7d=-2.0, tags=["layer-1"]),
        coin(4, "USDT", 0.0, change_7d=0.0, tags=["stablecoin", "usd-stablecoin"]),
        coin(5, "USDC", 0.0, change_7d=0.0, tags=["stablecoin", "usd-stablecoin"]),
        coin(6, "D1", 5.0, change_7d=1.0, tags=["defi"]),
        coin(7, "D2", 5.0, change_7d=1.0, tags=["defi"]),
        coin(8, "D3", 5.0, change_7d=1.0, tags=["defi"]),
        coin(9, "D4", 5.0, change_7d=1.0, tags=["defi"]),
        coin(10, "D5", 5.0, change_7d=1.0, tags=["defi"]),
    ]
    # Add 6 negative-24h non-stables so benchmark median differs cleanly from DeFi (5.0 / 1.0)
    extra_market = [coin(20 + i, f"M{i}", -1.0, change_7d=-5.0, tags=["gaming"]) for i in range(6)]
    all_rows = [*market_rows, *extra_market]
    # 14 non-stables: 24h median = 1.5; 7d median = -4.5

    class _SkewedGateway:
        def __init__(self, category_ts: datetime | None) -> None:
            self.category_ts = category_ts

        async def fetch(
            self,
            endpoint: str,
            _params: dict[str, object],
            _ttl: int | None = None,
            _override: str | None = None,
        ) -> tuple[dict[str, object], FetchMeta]:
            if endpoint == CATEGORY:
                return (
                    {"data": {"coins": market_rows[5:10]}, "status": STATUS},
                    FetchMeta("CACHED", "AGING", True, 0, self.category_ts, NOW),
                )
            return (
                listings(*all_rows),
                FetchMeta("LIVE", "FRESH", False, 1, NOW, NOW),
            )

    class _FixedBook(SectorBook):
        async def load(self) -> list[SectorDef]:
            return [
                SectorDef("defi", "DeFi", "5fb62883c9ddcc213ed13308", ("defi",)),
                SectorDef("gaming", "Gaming", None, ("gaming",)),
            ]

    # 1. Aligned timestamps (category within 10 min of listings) -> matched-horizon excess returns
    aligned_deps = ServiceDeps(
        gateway=_SkewedGateway(NOW - timedelta(minutes=10)),
        evidence=MemoryEvidence(),
        assets=Book(),
        sectors=_FixedBook(),
        capabilities=Caps(),
        now=lambda: NOW,
    )
    aligned = await analyze_sector_rotation(
        SectorRotationInput(sectors=["defi", "gaming"]),
        deps=aligned_deps,
    )
    by_slug = {s.sector_slug: s for s in aligned.data.sectors}
    assert by_slug["defi"].excess_change_24h_vs_market_pct == pytest.approx(5.0 - 1.5)
    assert by_slug["defi"].excess_change_7d_vs_market_pct == pytest.approx(1.0 - (-4.5))
    assert by_slug["gaming"].excess_change_24h_vs_market_pct == pytest.approx(-1.0 - 1.5)
    assert by_slug["gaming"].excess_change_7d_vs_market_pct == pytest.approx(-5.0 - (-4.5))

    # 2. Mixed/skewed timestamps (>900s skew on cmc_category) -> excess returns null + limitation
    skewed_deps = ServiceDeps(
        gateway=_SkewedGateway(NOW - timedelta(hours=2)),
        evidence=MemoryEvidence(),
        assets=Book(),
        sectors=_FixedBook(),
        capabilities=Caps(),
        now=lambda: NOW,
    )
    skewed = await analyze_sector_rotation(
        SectorRotationInput(sectors=["defi", "gaming"]),
        deps=skewed_deps,
    )
    skew_by_slug = {s.sector_slug: s for s in skewed.data.sectors}
    assert skew_by_slug["defi"].excess_change_24h_vs_market_pct is None
    assert skew_by_slug["defi"].excess_change_7d_vs_market_pct is None
    # Same-source fallback (gaming) remains aligned!
    assert skew_by_slug["gaming"].excess_change_24h_vs_market_pct == pytest.approx(-2.5)
    assert any("timestamp skew" in note for note in skewed.limitations)

    # 3. Missing benchmark (only stablecoins -> benchmark median None -> null propagation)
    only_stables = [
        coin(4, "USDT", 0.0, change_7d=0.0, tags=["stablecoin", "usd-stablecoin"]),
    ]

    class _NoBenchGateway(_SkewedGateway):
        async def fetch(
            self,
            endpoint: str,
            params: dict[str, object],
            ttl: int | None = None,
            override: str | None = None,
        ) -> tuple[dict[str, object], FetchMeta]:
            if endpoint == CATEGORY:
                return await super().fetch(endpoint, params, ttl, override)
            return listings(*only_stables), FetchMeta("LIVE", "FRESH", False, 1, NOW, NOW)

    nobench_deps = ServiceDeps(
        gateway=_NoBenchGateway(NOW),
        evidence=MemoryEvidence(),
        assets=Book(),
        sectors=_FixedBook(),
        capabilities=Caps(),
        now=lambda: NOW,
    )
    nobench = await analyze_sector_rotation(
        SectorRotationInput(sectors=["defi"]),
        deps=nobench_deps,
    )
    assert nobench.data.sectors[0].excess_change_24h_vs_market_pct is None
    assert nobench.data.sectors[0].excess_change_7d_vs_market_pct is None


@pytest.mark.asyncio
async def test_six_verified_sector_mappings_migration_and_rwa_unmapped() -> None:
    from pathlib import Path

    from app.services.intelligence import CATEGORY

    verified_six = {
        "defi": "5fb62883c9ddcc213ed13308",
        "ai-big-data": "6051a81a66fc1b42617d6db7",
        "layer-1": "6433de7df79a2653906cd680",
        "layer-2": "604f2776ebccdd50cd175fdc",
        "gaming": "6051a82166fc1b42617d6dc1",
        "memes": "6051a82566fc1b42617d6dc6",
    }

    # 1. Verify SQL migration enforces idempotency, preserves unrelated fields, excludes RWA
    repo_root = Path(__file__).resolve().parents[3]
    migration_path = repo_root / "supabase" / "migrations" / "002_verified_sector_mappings.sql"
    raw_sql = migration_path.read_text(encoding="utf-8")
    sql = "\n".join(line for line in raw_sql.splitlines() if not line.lstrip().startswith("--"))
    for slug, cat_id in verified_six.items():
        assert f"'{slug}'" in sql
        assert f"'{cat_id}'" in sql
    assert "'rwa'" not in sql
    assert "ON CONFLICT (sector_slug) DO UPDATE" in sql
    assert "IS DISTINCT FROM EXCLUDED.cmc_category_id" in sql
    assert "display_name =" not in sql
    assert "fallback_tags =" not in sql
    assert "api_keys" not in sql

    # 2. Verify SectorBook loads all 6 mapped IDs into cmc_category while keeping rwa unmapped
    class _Query:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self._rows = rows

        def select(self, _cols: str) -> "_Query":
            return self

        def execute(self) -> object:
            return type("Resp", (), {"data": self._rows})()

    class _MigratedDb:
        def table(self, name: str) -> _Query:
            assert name == "sector_mappings"
            return _Query(
                [
                    {
                        "sector_slug": slug,
                        "display_name": slug.title(),
                        "cmc_category_id": cat_id,
                        "fallback_tags": [slug],
                    }
                    for slug, cat_id in verified_six.items()
                ]
                + [
                    {
                        "sector_slug": "rwa",
                        "display_name": "Real World Assets",
                        "cmc_category_id": None,
                        "fallback_tags": ["real-world-assets"],
                    }
                ]
            )

    book = SectorBook(client=_MigratedDb(), use_db=True, enrich_from_snapshots=False)
    loaded = await book.load()
    loaded_map = {s.slug: s.category_id for s in loaded}
    for slug, cat_id in verified_six.items():
        assert loaded_map[slug] == cat_id
    assert loaded_map["rwa"] is None

    seen_category_ids: list[object] = []

    def cat_handler(params: dict[str, object]) -> dict[str, object]:
        seen_category_ids.append(params.get("id"))
        return {
            "data": {"coins": [coin(800 + i, f"T{i}", 3.0, change_7d=5.0) for i in range(5)]},
            "status": STATUS,
        }

    handlers = common_handlers()
    handlers[CATEGORY] = cat_handler
    deps = ServiceDeps(
        gateway=Scripted(handlers),
        evidence=MemoryEvidence(),
        assets=Book(),
        sectors=book,
        capabilities=Caps(),
        now=lambda: NOW,
    )
    res = await analyze_sector_rotation(deps=deps)
    by_slug = {s.sector_slug: s for s in res.data.sectors}
    assert set(seen_category_ids) == set(verified_six.values())
    for slug in verified_six:
        assert by_slug[slug].taxonomy_source == "cmc_category"
    assert by_slug["rwa"].taxonomy_source == "listings_tag_fallback"


@pytest.mark.asyncio
async def test_qa_regressions_oauth_persistence_losers_corrupt_quotes_and_derivatives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api.deps import ApiKeyRecord, context_from_key, current_principal
    from app.services.evidence import EvidenceDraft, SupabaseEvidenceWriter

    # 1. OAuth principal writes api_key_id=None (never "oauth:<jti>") to Postgres UUID columns
    inserted: list[dict[str, object]] = []

    class _FakeTable:
        def insert(self, row: dict[str, object]) -> "_FakeTable":
            inserted.append(row)
            return self

        def execute(self) -> object:
            return type("R", (), {"data": [{}]})()

    class _FakeDb:
        def table(self, name: str) -> _FakeTable:
            assert name == "evidence_records"
            return _FakeTable()

    oauth_rec = ApiKeyRecord(
        key_id="oauth:550e8400-e29b-41d4-a716-446655440000",
        key_hash="",
        rate_limit_per_min=60,
        is_active=True,
        user_id="11111111-1111-4111-8111-111111111111",
        auth_kind="oauth",
    )
    tok = current_principal.set(context_from_key(oauth_rec, None, "mcp"))
    try:
        monkeypatch.setattr("app.api.v1.evidence.invalidate_evidence_cache", lambda: None)
        writer = SupabaseEvidenceWriter(client=_FakeDb())
        await writer.persist(
            EvidenceDraft(
                evidence_id="ev_oauth12345",
                tool_name="get_market_overview",
                asset_cmc_ids=[],
                endpoints_called=[],
                data_mode="CACHED",
                freshness="FRESH",
                credit_cost=0,
                engine_version="1.0.0",
                methodology={},
                limitations=[],
                raw_excerpt={},
            )
        )
    finally:
        current_principal.reset(tok)
    assert inserted[0]["api_key_id"] is None
    assert inserted[0]["user_id"] == "11111111-1111-4111-8111-111111111111"

    # 2. Positive market day: top_losers excludes positive gainers; corrupt SLX excluded from movers
    slx = coin(
        77777,
        "SLX",
        104410.0,
        change_7d=90000.0,
        market_cap=100_000_000,
        volume=0.0,
        tags=["defi"],
    )
    handlers = common_handlers()
    handlers["/v1/cryptocurrency/listings/latest"] = listings(BTC, ETH, SOL, slx)
    deps, _ = envelope_deps(Scripted(handlers))

    ov = await get_market_overview(deps=deps)
    assert ov.data.top_losers == []
    assert any("top_losers is empty" in note for note in ov.limitations)

    mv = await scan_market_movers(ScanMoversInput(limit=10), deps=deps)
    assert all(row.symbol != "SLX" for row in mv.data.movers)
    assert any("upstream data corruption" in note for note in mv.limitations)

    # 3. Unknown symbol in derivatives & historical returns INSUFFICIENT_DATA cleanly
    handlers["/v1/cryptocurrency/map"] = {"data": [], "status": STATUS}
    bad_deriv = await analyze_derivatives(DerivativesAnalysisInput(symbol="NOTACOIN123"), deps=deps)
    assert bad_deriv.status == EvidenceStatus.INSUFFICIENT_DATA
    assert all("unavailable on this CoinMarketCap plan" not in n for n in bad_deriv.limitations)

    bad_hist = await get_historical_performance(
        HistoricalPerformanceInput(symbol="NOTACOIN123"),
        deps=deps,
    )
    assert bad_hist.status == EvidenceStatus.INSUFFICIENT_DATA

    # 4. Derivatives excludes quote-attributed pairs and flags >50% single-venue OI + zero-OI pairs
    handlers["/v1/cryptocurrency/map"] = {
        "data": [{"id": 825, "symbol": "USDT", "rank": 3}],
        "status": STATUS,
    }
    handlers["/v5/cryptocurrency/derivatives/market-pairs/list/latest"] = {
        "data": {
            "num_market_pairs": 100,
            "market_pairs": [
                {
                    "market_id": 1,
                    "market_pair_symbol": "BTC/USDT",
                    "category": "perpetual",
                    "exchange": {"exchange_id": 1, "exchange_name": "Binance"},
                    "quotes": [{"convert_symbol": "USD", "open_interest": 999_000_000}],
                },
                {
                    "market_id": 2,
                    "market_pair_symbol": "USDT/USD",
                    "category": "perpetual",
                    "exchange": {"exchange_id": 2, "exchange_name": "ASTX"},
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "volume_24h": 700_000_000,
                            "open_interest": 500_000_000,
                        }
                    ],
                },
                {
                    "market_id": 3,
                    "market_pair_symbol": "USDT/EUR",
                    "category": "perpetual",
                    "exchange": {"exchange_id": 3, "exchange_name": "Bybit"},
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "volume_24h": 10_000_000,
                            "open_interest": 5_000_000,
                        }
                    ],
                },
                {
                    "market_id": 4,
                    "market_pair_symbol": "USDT/USDC",
                    "category": "perpetual",
                    "exchange": {"exchange_id": 4, "exchange_name": "KTX"},
                    "quotes": [
                        {
                            "convert_symbol": "USD",
                            "volume_24h": 5_000_000,
                            "open_interest": 0,
                        }
                    ],
                },
            ],
        },
        "status": STATUS,
    }
    usdt_deriv = await analyze_derivatives(DerivativesAnalysisInput(symbol="USDT"), deps=deps)
    assert usdt_deriv.data.open_interest == pytest.approx(505_000_000)
    assert all(pair.market_pair_symbol != "BTC/USDT" for pair in usdt_deriv.data.market_pairs)
    assert any("quote-attributed pair" in note for note in usdt_deriv.limitations)
    assert any("High single-venue OI concentration" in note for note in usdt_deriv.limitations)
    assert any("zero open_interest" in note for note in usdt_deriv.limitations)
