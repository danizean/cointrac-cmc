import time

from fastapi import APIRouter, BackgroundTasks, Depends, Path, Query

from app.api.deps import AuthContext, require_api_key
from app.schemas.envelope import EvidenceEnvelope
from app.schemas.tools import (
    AnalyzeAssetData,
    AnalyzeMomentumData,
    AnalyzeMomentumInput,
    CompareAssetsData,
    CompareAssetsInput,
    DerivativesAnalysisData,
    DetectAnomaliesData,
    DetectAnomaliesInput,
    HistoricalPerformanceData,
    HistoricalPerformanceInput,
    MarketOverviewData,
    MarketRegimeData,
    ScanMoversData,
    ScanMoversInput,
    SectorRotationData,
    SectorRotationInput,
)
from app.services import intelligence as workflows
from app.services.evidence import RequestLog, SupabaseEvidenceWriter

router = APIRouter(prefix="/v1/intelligence", tags=["Intelligence"])


@router.get(
    "/market-overview",
    summary="Get Macro Market Overview",
    description=(
        "Macro snapshot composing total crypto market cap, BTC/ETH dominance, "
        "Fear & Greed index, Top-50 breadth, BTC/ETH/SOL spot quotes, and 24h top gainers/losers."
    ),
)
async def market_overview(
    background: BackgroundTasks,
    quote_currency: str = Query(default="USD", description="Fiat or crypto quote currency"),
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[MarketOverviewData]:
    return await _call(
        "get_market_overview",
        auth,
        workflows.get_market_overview(quote_currency, override_cmc_key=auth.byok),
        background,
    )


@router.post(
    "/scan-movers",
    summary="Anti-Chase Momentum Screener",
    description=(
        "Filters the top listings universe by market cap, 24h volume, volume/mcap ratio, "
        "7d relative strength vs BTC, and an anti-chase max 24h gain cap."
    ),
)
async def scan_movers(
    params: ScanMoversInput,
    background: BackgroundTasks,
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[ScanMoversData]:
    return await _call(
        "scan_market_movers",
        auth,
        workflows.scan_market_movers(params, override_cmc_key=auth.byok),
        background,
    )


@router.post(
    "/compare-assets",
    summary="Compare 2-8 Assets Side-by-Side",
    description=(
        "Resolves 2-8 tickers to canonical CoinMarketCap numeric IDs and compares liquidity, "
        "FDV overhang, relative strength vs BTC, composite momentum, and 365d risk metrics."
    ),
)
async def compare(
    params: CompareAssetsInput,
    background: BackgroundTasks,
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[CompareAssetsData]:
    return await _call(
        "compare_assets",
        auth,
        workflows.compare_assets(params, override_cmc_key=auth.byok),
        background,
    )


@router.get(
    "/assets/{symbol}",
    summary="Single-Asset Deep Profile",
    description=(
        "Single-asset market fundamentals, circulating/max supply dynamics, tags, "
        "relative strength vs BTC, and 365d volatility when OHLCV is available."
    ),
)
async def asset(
    background: BackgroundTasks,
    symbol: str = Path(description="Asset ticker symbol (e.g. SOL, BTC, ETH)", examples=["SOL"]),
    quote_currency: str = Query(default="USD"),
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[AnalyzeAssetData]:
    from app.schemas.tools import AnalyzeAssetInput

    params = AnalyzeAssetInput(symbol=symbol, quote_currency=quote_currency)
    return await _call(
        "analyze_asset",
        auth,
        workflows.analyze_asset(params, override_cmc_key=auth.byok),
        background,
    )


@router.post(
    "/momentum",
    summary="Multi-Timeframe Momentum Decomposition",
    description=(
        "Computes 1h/24h/7d/30d/60d/90d returns, relative strength vs BTC, "
        "7d vs 30d trend acceleration, and re-normalized composite momentum scores."
    ),
)
async def momentum(
    params: AnalyzeMomentumInput,
    background: BackgroundTasks,
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[AnalyzeMomentumData]:
    return await _call(
        "analyze_momentum",
        auth,
        workflows.analyze_momentum(params, override_cmc_key=auth.byok),
        background,
    )


@router.post(
    "/anomalies",
    summary="Detect Statistical Market Anomalies",
    description=(
        "Scans top listings for volume-to-mcap and 24h return outliers using both standard Z-score "
        "and robust Modified Z-score (MAD), plus strong opposing BTC divergences."
    ),
)
async def anomalies(
    params: DetectAnomaliesInput,
    background: BackgroundTasks,
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[DetectAnomaliesData]:
    return await _call(
        "detect_market_anomalies",
        auth,
        workflows.detect_market_anomalies(params, override_cmc_key=auth.byok),
        background,
    )


@router.get(
    "/market-regime",
    summary="Classify Current Market Regime",
    description=(
        "Deterministic 4-signal classifier returning RISK_ON_ALTSEASON, BTC_LED_EXPANSION, "
        "RISK_OFF_STRESS, or RANGE_CONSOLIDATION with explicit numeric rationale."
    ),
)
async def regime(
    background: BackgroundTasks,
    quote_currency: str = Query(default="USD"),
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[MarketRegimeData]:
    return await _call(
        "analyze_market_regime",
        auth,
        workflows.analyze_market_regime(override_cmc_key=auth.byok, quote_currency=quote_currency),
        background,
    )


@router.post(
    "/sector-rotation",
    summary="Analyze Sector Rotation & RWA Pulse",
    description=(
        "Compares median and market-cap weighted performance, breadth, volume share, and rotation "
        "signals across 7 crypto sectors: DeFi, AI & Big Data, L1, L2, Gaming, RWA, and Memecoins."
    ),
)
async def sectors(
    background: BackgroundTasks,
    params: SectorRotationInput | None = None,
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[SectorRotationData]:
    return await _call(
        "analyze_sector_rotation",
        auth,
        workflows.analyze_sector_rotation(params, override_cmc_key=auth.byok),
        background,
    )


@router.get(
    "/assets/{symbol}/historical",
    summary="Historical Risk & Return Statistics (365d Basis)",
    description=(
        "Aligned UTC daily return statistics, sqrt(365) annualized volatility, max drawdown, "
        "beta, and Pearson correlation vs BTC. Returns TIER_RESTRICTED cleanly when OHLCV is "
        "restricted on the active CoinMarketCap plan."
    ),
)
async def historical(
    background: BackgroundTasks,
    symbol: str = Path(description="Asset ticker symbol (e.g. SOL)", examples=["SOL"]),
    quote_currency: str = Query(default="USD"),
    count: int = Query(default=30, ge=5, le=90, description="Number of daily candles (5-90)"),
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[HistoricalPerformanceData]:
    params = HistoricalPerformanceInput(symbol=symbol, quote_currency=quote_currency, count=count)
    return await _call(
        "get_historical_performance",
        auth,
        workflows.get_historical_performance(params, override_cmc_key=auth.byok),
        background,
    )


@router.get(
    "/assets/{symbol}/derivatives",
    summary="Derivatives Context or Spot-Stress Proxy",
    description=(
        "Returns derivatives market-pair context when enabled, or a transparent spot-volume & "
        "volatility stress proxy (status=PARTIAL) with explicit plan limitations."
    ),
)
async def derivatives(
    background: BackgroundTasks,
    symbol: str = Path(description="Asset ticker symbol (e.g. BTC)", examples=["BTC"]),
    quote_currency: str = Query(default="USD"),
    auth: AuthContext = Depends(require_api_key),
) -> EvidenceEnvelope[DerivativesAnalysisData]:
    from app.schemas.tools import DerivativesAnalysisInput

    params = DerivativesAnalysisInput(symbol=symbol, quote_currency=quote_currency)
    return await _call(
        "analyze_derivatives",
        auth,
        workflows.analyze_derivatives(params, override_cmc_key=auth.byok),
        background,
    )


async def _write_request_log(entry: RequestLog) -> None:
    try:
        await SupabaseEvidenceWriter().log_request(entry)
    except Exception:
        pass


async def _call[T](
    tool: str,
    auth: AuthContext,
    awaitable: object,
    background: BackgroundTasks,
) -> EvidenceEnvelope[T]:
    started = time.perf_counter()
    status_code = 200
    evidence_id = None
    cache_hit = False
    credit_cost = 0
    try:
        envelope: EvidenceEnvelope[T] = await awaitable  # type: ignore[misc]
        evidence_id = envelope.evidence.evidence_id
        cache_hit = envelope.evidence.cache_hit
        credit_cost = envelope.evidence.cmc_credit_cost
        return envelope
    except Exception:
        status_code = 500
        raise
    finally:
        latency_ms = int((time.perf_counter() - started) * 1000)
        background.add_task(
            _write_request_log,
            RequestLog(
                api_key_id=auth.key_id,
                user_id=auth.user_id,
                surface=auth.surface,  # type: ignore[arg-type]
                tool_name=tool,
                status_code=status_code,
                latency_ms=latency_ms,
                cache_hit=cache_hit,
                credit_cost=credit_cost,
                evidence_id=evidence_id,
            ),
        )
