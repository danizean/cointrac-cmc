import re
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator

from app.quant.anomalies import AnomalyDirection
from app.quant.screening import MultiHorizonRisk
from app.schemas.envelope import StrictModel

FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
SectorSlug = Literal["defi", "ai-big-data", "layer-1", "layer-2", "gaming", "rwa", "memes"]
RankBy = Literal["composite_momentum_score", "rs_vs_btc_7d", "volume_to_mcap"]
RegimeLabel = Literal[
    "RISK_ON_ALTSEASON",
    "BTC_LED_EXPANSION",
    "RISK_OFF_STRESS",
    "RANGE_CONSOLIDATION",
]
RotationSignal = Literal[
    "GAINING_MOMENTUM",
    "LEADING",
    "LAGGING",
    "WEAKENING",
    "NEUTRAL",
    "INSUFFICIENT_DATA",
]
RegimeConfidence = Literal["HIGH", "MEDIUM", "LOW"]
TaxonomySource = Literal["cmc_category", "listings_tag_fallback"]
_SYMBOL = re.compile(r"^[A-Z0-9]{1,20}$")
SUPPORTED_QUOTE_CURRENCIES: frozenset[str] = frozenset(
    {
        "USD",
        "EUR",
        "GBP",
        "JPY",
        "AUD",
        "CAD",
        "CHF",
        "CNY",
        "HKD",
        "IDR",
        "INR",
        "KRW",
        "MYR",
        "NZD",
        "PHP",
        "PLN",
        "RUB",
        "SEK",
        "SGD",
        "THB",
        "TRY",
        "TWD",
        "VND",
        "ZAR",
        "AED",
        "ARS",
        "BRL",
        "CLP",
        "COP",
        "CZK",
        "DKK",
        "HUF",
        "ILS",
        "MXN",
        "NGN",
        "NOK",
        "PKR",
        "SAR",
        "UAH",
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "USDT",
        "USDC",
    }
)


def _normalize_symbol(value: str) -> str:
    symbol = value.strip().upper()
    if _SYMBOL.fullmatch(symbol) is None:
        raise ValueError("symbol must be 1-20 letters or digits")
    return symbol


def validate_quote_currency(value: str) -> str:
    currency = value.strip().upper()
    if currency not in SUPPORTED_QUOTE_CURRENCIES:
        raise ValueError(
            f"Unsupported quote_currency '{currency}'. "
            "Use a standard CoinMarketCap fiat or crypto quote (e.g. USD, EUR, GBP, JPY, BTC, ETH)."
        )
    return currency


class QuoteBrief(StrictModel):
    cmc_id: int | None = None
    symbol: str
    name: str | None = None
    price: FiniteFloat | None = None
    market_cap: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    percent_change_24h: FiniteFloat | None = None


class MarketOverviewData(StrictModel):
    quote_currency: str
    total_market_cap: FiniteFloat | None = None
    total_volume_24h: FiniteFloat | None = None
    total_market_cap_change_24h_pct: FiniteFloat | None = None
    btc_dominance: FiniteFloat | None = None
    eth_dominance: FiniteFloat | None = None
    btc_dominance_change_24h: FiniteFloat | None = None
    fear_greed_value: FiniteFloat | None = None
    fear_greed_classification: str | None = None
    top50_breadth_positive_pct: FiniteFloat | None = None
    total_market_cap_change_7d_pct: FiniteFloat | None = None
    total_market_cap_change_30d_pct: FiniteFloat | None = None
    btc_dominance_change_7d: FiniteFloat | None = None
    btc_dominance_change_30d: FiniteFloat | None = None
    fear_greed_avg_7d: FiniteFloat | None = None
    fear_greed_avg_30d: FiniteFloat | None = None
    fear_greed_change_7d: FiniteFloat | None = None
    fear_greed_change_30d: FiniteFloat | None = None
    btc: QuoteBrief | None = None
    eth: QuoteBrief | None = None
    sol: QuoteBrief | None = None
    top_gainers: list[QuoteBrief] = Field(default_factory=list)
    top_losers: list[QuoteBrief] = Field(default_factory=list)


class ScanMoversInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "quote_currency": "USD",
                    "min_market_cap_usd": 250000000,
                    "min_volume_24h_usd": 15000000,
                    "max_24h_gain_pct": 18,
                    "rank_by": "composite_momentum_score",
                    "limit": 15,
                    "universe_size": 150,
                }
            ]
        },
    )

    quote_currency: str = "USD"
    min_market_cap_usd: FiniteFloat | None = Field(default=None, ge=0.0)
    min_volume_24h_usd: FiniteFloat | None = Field(default=None, ge=0.0)
    min_vol_to_mcap: FiniteFloat | None = Field(default=None, ge=0.0)
    min_rs_vs_btc_7d: FiniteFloat | None = None
    max_24h_gain_pct: FiniteFloat | None = None
    max_7d_gain_pct: FiniteFloat | None = Field(
        default=None,
        ge=-100.0,
        le=10000.0,
        description=(
            "Optional multi-horizon anti-chase ceiling on 7d percent change in percentage "
            "points (-100.0 to 10000.0). Omit or null to disable."
        ),
    )
    rank_by: RankBy = "composite_momentum_score"
    limit: int = Field(default=20, ge=1, le=50, strict=True)
    universe_size: int = Field(default=150, ge=10, le=200, strict=True)
    deep_scan: bool = False

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class MoverRow(StrictModel):
    cmc_id: int | None = None
    symbol: str
    name: str | None = None
    market_cap: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    volume_to_mcap: FiniteFloat | None = None
    percent_change_24h: FiniteFloat | None = None
    percent_change_7d: FiniteFloat | None = None
    percent_change_30d: FiniteFloat | None = None
    percent_change_60d: FiniteFloat | None = None
    rs_vs_btc_7d: FiniteFloat | None = None
    composite_momentum_score: FiniteFloat | None = None
    timeframes_available: int | None = Field(default=None, ge=0, le=4)
    multi_horizon_risk: MultiHorizonRisk | None = Field(
        default=None,
        description=(
            "Descriptive multi-horizon chase/retracement classification derived from "
            "24h/7d/30d returns (not a confirmed reversal signal)."
        ),
    )


class ScanMoversData(StrictModel):
    quote_currency: str
    rank_by: RankBy
    movers: list[MoverRow]


class CompareAssetsInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "symbols": ["SOL", "AVAX", "NEAR"],
                    "quote_currency": "USD",
                }
            ]
        },
    )

    symbols: list[str] = Field(min_length=2, max_length=8)
    quote_currency: str = "USD"

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, values: list[str]) -> list[str]:
        symbols = [_normalize_symbol(value) for value in values]
        if len(set(symbols)) != len(symbols):
            raise ValueError("symbols must be unique")
        return symbols


class AssetComparison(StrictModel):
    cmc_id: int | None = None
    symbol: str
    name: str | None = None
    price: FiniteFloat | None = None
    market_cap: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    volume_to_mcap: FiniteFloat | None = None
    fdv_to_mcap_ratio: FiniteFloat | None = None
    circulating_supply_pct: FiniteFloat | None = None
    percent_change_24h: FiniteFloat | None = None
    percent_change_7d: FiniteFloat | None = None
    percent_change_30d: FiniteFloat | None = None
    percent_change_60d: FiniteFloat | None = None
    rs_vs_btc_24h: FiniteFloat | None = None
    rs_vs_btc_7d: FiniteFloat | None = None
    rs_vs_btc_30d: FiniteFloat | None = None
    composite_momentum_score: FiniteFloat | None = None
    timeframes_available: int | None = Field(default=None, ge=0, le=4)
    annualized_volatility: FiniteFloat | None = None
    max_drawdown: FiniteFloat | None = None


class CompareAssetsData(StrictModel):
    quote_currency: str
    assets: list[AssetComparison]


class AnalyzeAssetInput(StrictModel):
    symbol: str
    quote_currency: str = "USD"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return _normalize_symbol(value)

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class PricePerformance(StrictModel):
    period: str
    high: FiniteFloat | None = None
    low: FiniteFloat | None = None
    percent_change: FiniteFloat | None = None


class AnalyzeAssetData(StrictModel):
    symbol: str
    cmc_id: int | None = None
    name: str | None = None
    quote_currency: str
    price: FiniteFloat | None = None
    market_cap: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    volume_to_mcap: FiniteFloat | None = None
    fdv_to_mcap_ratio: FiniteFloat | None = None
    circulating_supply: FiniteFloat | None = None
    total_supply: FiniteFloat | None = None
    max_supply: FiniteFloat | None = None
    circulating_supply_pct: FiniteFloat | None = None
    tags: list[str] = Field(default_factory=list)
    percent_change_24h: FiniteFloat | None = None
    percent_change_7d: FiniteFloat | None = None
    percent_change_30d: FiniteFloat | None = None
    percent_change_60d: FiniteFloat | None = None
    rs_vs_btc_24h: FiniteFloat | None = None
    rs_vs_btc_7d: FiniteFloat | None = None
    rs_vs_btc_30d: FiniteFloat | None = None
    composite_momentum_score: FiniteFloat | None = None
    timeframes_available: int | None = Field(default=None, ge=0, le=4)
    annualized_volatility: FiniteFloat | None = None
    max_drawdown: FiniteFloat | None = None
    price_performance: list[PricePerformance] = Field(default_factory=list)


class AnalyzeMomentumInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "symbols": ["BTC", "ETH", "SOL", "AVAX", "NEAR"],
                    "quote_currency": "USD",
                }
            ]
        },
    )

    symbols: list[str] = Field(min_length=1, max_length=20)
    quote_currency: str = "USD"

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)

    @field_validator("symbols")
    @classmethod
    def normalize_symbols(cls, values: list[str]) -> list[str]:
        symbols = [_normalize_symbol(value) for value in values]
        if len(set(symbols)) != len(symbols):
            raise ValueError("symbols must be unique")
        return symbols


class MomentumRow(StrictModel):
    symbol: str
    cmc_id: int | None = None
    percent_change_1h: FiniteFloat | None = None
    percent_change_24h: FiniteFloat | None = None
    percent_change_7d: FiniteFloat | None = None
    percent_change_30d: FiniteFloat | None = None
    percent_change_60d: FiniteFloat | None = None
    percent_change_90d: FiniteFloat | None = None
    rs_vs_btc_24h: FiniteFloat | None = None
    rs_vs_btc_7d: FiniteFloat | None = None
    rs_vs_btc_30d: FiniteFloat | None = None
    composite_momentum_score: FiniteFloat | None = None
    timeframes_available: int | None = Field(default=None, ge=0, le=4)
    acceleration_7d_vs_30d: FiniteFloat | None = Field(
        default=None,
        description="Cumulative 7d minus 30d return spread in percentage points.",
    )
    daily_rate_spread_7d_vs_30d_pct: FiniteFloat | None = Field(
        default=None,
        description=(
            "Normalized average daily return spread: (percent_change_7d / 7) minus "
            "(percent_change_30d / 30) in percentage points per day."
        ),
    )


class AnalyzeMomentumData(StrictModel):
    quote_currency: str
    assets: list[MomentumRow]


class DetectAnomaliesInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "quote_currency": "USD",
                    "universe_size": 150,
                }
            ]
        },
    )

    quote_currency: str = "USD"
    universe_size: int = Field(default=150, ge=10, le=200, strict=True)
    deep_scan: bool = False

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class AnomalyHit(StrictModel):
    symbol: str
    cmc_id: int | None = None
    metric: str
    value: FiniteFloat | None = None
    z_score: FiniteFloat | None = None
    modified_z_score: FiniteFloat | None = None
    direction: AnomalyDirection | None = Field(
        default=None,
        description=(
            "Descriptive statistical tail direction for volume-to-mcap outliers "
            "(HIGH_VOLUME_TO_MCAP, LOW_VOLUME_ILLIQUIDITY, or INSUFFICIENT_DATA); "
            "null for metrics where volume-tail direction does not apply."
        ),
    )


class BtcDivergence(StrictModel):
    symbol: str
    cmc_id: int | None = None
    asset_change_24h_pct: FiniteFloat | None = None
    btc_change_24h_pct: FiniteFloat | None = None
    divergence_pct: FiniteFloat | None = None


class DetectAnomaliesData(StrictModel):
    quote_currency: str
    volume_mcap_outliers: list[AnomalyHit]
    price_change_outliers: list[AnomalyHit]
    btc_divergences: list[BtcDivergence]


class MarketRegimeData(StrictModel):
    regime: RegimeLabel | None = None
    total_mcap_change_24h_pct: FiniteFloat | None = None
    btc_dominance_change_24h: FiniteFloat | None = None
    top50_breadth_positive_pct: FiniteFloat | None = None
    fear_greed_value: FiniteFloat | None = None
    btc_outperforming_median_alt: bool | None = None
    total_market_cap_change_7d_pct: FiniteFloat | None = None
    total_market_cap_change_30d_pct: FiniteFloat | None = None
    btc_dominance_change_7d: FiniteFloat | None = None
    btc_dominance_change_30d: FiniteFloat | None = None
    fear_greed_avg_7d: FiniteFloat | None = None
    fear_greed_avg_30d: FiniteFloat | None = None
    fear_greed_change_7d: FiniteFloat | None = None
    fear_greed_change_30d: FiniteFloat | None = None
    signal_conflict: bool = False
    confidence: RegimeConfidence | None = None
    dominant_signals: list[str] = Field(default_factory=list)
    conflicting_signals: list[str] = Field(default_factory=list)
    rationale: list[str] = Field(default_factory=list)


class SectorRotationInput(StrictModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "quote_currency": "USD",
                    "sectors": [
                        "defi",
                        "ai-big-data",
                        "layer-1",
                        "layer-2",
                        "gaming",
                        "rwa",
                        "memes",
                    ],
                }
            ]
        },
    )

    quote_currency: str = "USD"
    sectors: list[SectorSlug] | None = None

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class SectorSnapshot(StrictModel):
    sector_slug: SectorSlug
    display_name: str
    constituent_count: int = Field(ge=0)
    median_change_24h_pct: FiniteFloat | None = None
    median_change_7d_pct: FiniteFloat | None = None
    excess_change_24h_vs_market_pct: FiniteFloat | None = Field(
        default=None,
        description=(
            "Sector median 24h return minus the matched-horizon non-stablecoin Top-200 "
            "market median 24h return (percentage points). Null if benchmark unavailable "
            "or source timestamps are misaligned."
        ),
    )
    excess_change_7d_vs_market_pct: FiniteFloat | None = Field(
        default=None,
        description=(
            "Sector median 7d return minus the matched-horizon non-stablecoin Top-200 "
            "market median 7d return (percentage points). Null if benchmark unavailable "
            "or source timestamps are misaligned."
        ),
    )
    cap_weighted_change_24h_pct: FiniteFloat | None = None
    cap_weighted_change_7d_pct: FiniteFloat | None = None
    breadth_positive_24h_pct: FiniteFloat | None = None
    total_volume_24h: FiniteFloat | None = None
    sector_volume_share_pct: FiniteFloat | None = None
    rotation_signal: RotationSignal | None = None
    taxonomy_source: TaxonomySource | None = None
    sample_sufficient: bool | None = None


class RwaAssetBrief(StrictModel):
    rwa_id: int | None = None
    symbol: str | None = None
    name: str | None = None
    asset_type: str | None = None
    rwa_rank: int | None = Field(default=None, ge=1)
    has_tokens: bool | None = None
    price: FiniteFloat | None = None
    market_cap: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    percent_change_24h: FiniteFloat | None = None
    percent_change_7d: FiniteFloat | None = None
    last_updated: str | None = None


class RwaUniverseContext(StrictModel):
    scope: Literal["underlying_rwa_universe"] = "underlying_rwa_universe"
    separated_from_crypto_sectors: bool = True
    total_rwa_assets: int | None = Field(default=None, ge=0)
    sampled_rwa_assets: int = Field(default=0, ge=0)
    asset_type_counts: dict[str, int] = Field(default_factory=dict)
    total_tokenized_market_cap: FiniteFloat | None = None
    total_tokenized_volume_24h: FiniteFloat | None = None
    top_rwa_assets: list[RwaAssetBrief] = Field(default_factory=list)
    source_endpoints: list[str] = Field(default_factory=list)


class SectorRotationData(StrictModel):
    quote_currency: str
    sectors: list[SectorSnapshot]
    unique_constituent_count: int | None = Field(default=None, ge=0)
    overlapping_asset_count: int | None = Field(default=None, ge=0)
    rwa_universe: RwaUniverseContext | None = None


class HistoricalPerformanceInput(StrictModel):
    symbol: str
    quote_currency: str = "USD"
    count: int = Field(default=30, ge=5, le=90)
    interval: Literal["daily"] = "daily"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return _normalize_symbol(value)

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class HistoricalPerformanceData(StrictModel):
    symbol: str
    cmc_id: int | None = None
    quote_currency: str
    overlap_days: int | None = Field(default=None, ge=0)
    simple_return: FiniteFloat | None = None
    log_return: FiniteFloat | None = None
    annualized_volatility: FiniteFloat | None = None
    max_drawdown: FiniteFloat | None = None
    beta_vs_btc: FiniteFloat | None = None
    correlation_vs_btc: FiniteFloat | None = None


class DerivativesAnalysisInput(StrictModel):
    symbol: str
    quote_currency: str = "USD"

    @field_validator("symbol")
    @classmethod
    def normalize_symbol(cls, value: str) -> str:
        return _normalize_symbol(value)

    @field_validator("quote_currency")
    @classmethod
    def normalize_quote(cls, value: str) -> str:
        return validate_quote_currency(value)


class DerivativePairObservation(StrictModel):
    market_id: int | None = None
    exchange_id: int | None = None
    exchange_name: str | None = None
    exchange_slug: str | None = None
    market_pair_symbol: str | None = None
    category: str | None = None
    quote_currency: str | None = None
    price: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    open_interest: FiniteFloat | None = None
    funding_rate: FiniteFloat | None = None
    index_price: FiniteFloat | None = None
    index_basis: FiniteFloat | None = None
    outlier_detected: bool | None = None
    exclusions: list[str] = Field(default_factory=list)
    last_updated: str | None = None


class MarketWideLiquidationsContext(StrictModel):
    scope: Literal["market_wide"] = "market_wide"
    attribution: Literal["not_asset_specific"] = "not_asset_specific"
    data_kind: Literal["observed_exchange_aggregate"] = "observed_exchange_aggregate"
    quote_currency: str = "USD"
    total_24h: FiniteFloat | None = None
    long_24h: FiniteFloat | None = None
    short_24h: FiniteFloat | None = None
    total_1h: FiniteFloat | None = None
    total_4h: FiniteFloat | None = None
    last_updated: str | None = None
    source_endpoint: str = "/v5/derivatives/liquidations/quotes/latest"


class DerivativeVenueBrief(StrictModel):
    exchange_id: int | None = None
    name: str | None = None
    slug: str | None = None
    rank: int | None = Field(default=None, ge=1)
    num_market_pairs: int | None = Field(default=None, ge=0)
    exchange_score: FiniteFloat | None = None
    liquidity_score: FiniteFloat | None = None
    volume_24h: FiniteFloat | None = None
    volume_24h_adjusted: FiniteFloat | None = None
    open_interest: FiniteFloat | None = None
    last_updated: str | None = None


class DerivativesVenuesContext(StrictModel):
    scope: Literal["market_wide_venues"] = "market_wide_venues"
    attribution: Literal["not_asset_specific"] = "not_asset_specific"
    quote_currency: str = "USD"
    total_exchanges: int | None = Field(default=None, ge=0)
    sampled_exchanges: int = Field(default=0, ge=0)
    total_open_interest: FiniteFloat | None = None
    total_volume_24h: FiniteFloat | None = None
    venues: list[DerivativeVenueBrief] = Field(default_factory=list)
    source_endpoint: str = "/v5/exchange/derivatives/list"


class ToolAvailability(StrictModel):
    name: str
    mode: Literal["full", "fallback"]
    reason: str | None = None


class CapabilitiesData(StrictModel):
    quota_profile: str
    budget_state: str
    utilization_pct: float | None = None
    ledger_status: str
    data_mode: Literal["CACHED", "VERIFIED_SNAPSHOT_FALLBACK"]
    tools: list[ToolAvailability]


class DerivativesAnalysisData(StrictModel):
    symbol: str
    cmc_id: int | None = None
    quote_currency: str
    mode: Literal["derivatives", "spot_stress_proxy"]
    funding_rate: FiniteFloat | None = None
    open_interest: FiniteFloat | None = None
    liquidations_24h: FiniteFloat | None = None
    market_pair_count: int | None = Field(default=None, ge=0)
    sampled_pair_count: int | None = Field(default=None, ge=0)
    open_interest_pairs_included: int | None = Field(default=None, ge=0)
    outlier_pairs_excluded: int | None = Field(default=None, ge=0)
    market_pairs: list[DerivativePairObservation] = Field(default_factory=list)
    market_wide_liquidations: MarketWideLiquidationsContext | None = None
    derivatives_venues: DerivativesVenuesContext | None = None
    spot_volume_24h: FiniteFloat | None = None
    annualized_volatility: FiniteFloat | None = None
