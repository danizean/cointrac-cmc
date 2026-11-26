"""Pure deterministic scoring and feature derivation for the Hidden Gem Discovery Engine.

Side-effect free: no network calls, no database calls, and no LLM calls.
Missing values stay None / UNKNOWN and are re-normalized rather than zero-filled.
Daily return volatility annualization uses sqrt(365) for crypto markets.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median
from typing import Literal

from app.quant.metrics import volume_to_mcap
from app.quant.screening import classify_stablecoin

HIDDEN_GEM_SCORE_VERSION = "v1.2.0"

DiscoveryTrack = Literal["EARLY", "CONFIRMED"]
TradingHorizon = Literal["SHORT_TERM", "SWING"]
CapabilityProfile = Literal["BASIC_CAPABILITY_PROFILE", "STARTUP_CAPABILITY_PROFILE"]
MarketRegimeType = Literal[
    "RISK_ON_ALTSEASON",
    "BTC_LED_EXPANSION",
    "RANGE_CONSOLIDATION",
    "RISK_OFF_STRESS",
    "UNKNOWN",
]
QualityStatus = Literal["VALID", "PARTIAL", "UNKNOWN", "STALE", "INVALID"]
EvidenceDirection = Literal["POSITIVE", "NEGATIVE", "NEUTRAL", "MISSING"]
EligibilityStatus = Literal["ELIGIBLE", "WATCH", "REJECTED", "INSUFFICIENT_DATA"]
ClassificationBand = Literal[
    "HIGH_QUALITY_CANDIDATE",
    "STRONG_CANDIDATE",
    "EMERGING_CANDIDATE",
    "WATCH",
    "LOW_PRIORITY",
    "INSUFFICIENT_DATA",
]
ConfidenceLevel = Literal["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"]

EXCLUDED_ASSET_TAGS: frozenset[str] = frozenset(
    {"wrapped-tokens", "leveraged-tokens", "synthetic-assets"}
)
MIN_VALID_WEIGHT_COVERAGE = 0.60
MIN_BENCHMARK_MCAP_USD = 5_000_000.0
MIN_BENCHMARK_VOL_USD = 500_000.0

_BASE_WEIGHTS_EARLY: dict[str, float] = {
    "market_quality": 20.0,
    "relative_strength": 20.0,
    "volume_activity": 20.0,
    "momentum_acceleration": 15.0,
    "early_structure": 15.0,
    "risk_quality": 10.0,
}

_BASE_WEIGHTS_CONFIRMED: dict[str, float] = {
    "market_quality": 15.0,
    "mtf_momentum": 20.0,
    "relative_strength": 15.0,
    "volume_confirmation": 15.0,
    "trend_structure": 20.0,
    "derivatives_positioning": 5.0,
    "risk_quality": 10.0,
}


@dataclass(frozen=True)
class OhlcvBar:
    timestamp: datetime
    close: float
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None


@dataclass(frozen=True)
class HistoricalIndicators:
    daily_bar_count: int
    bars_4h_count: int
    has_ohlcv_candles: bool
    has_4h_candles: bool
    ema_20_daily: float | None = None
    ema_50_daily: float | None = None
    ema_200_daily: float | None = None
    rsi_14_daily: float | None = None
    daily_sigma_30d: float | None = None
    annualized_vol_30d: float | None = None
    volume_median_30d: float | None = None
    atr_14_daily: float | None = None
    adx_14_daily: float | None = None
    ext_atr_daily: float | None = None
    higher_high_higher_low: bool | None = None
    ema_20_4h: float | None = None
    ema_50_4h: float | None = None
    ema_100_4h: float | None = None
    rsi_14_4h: float | None = None
    atr_14_4h: float | None = None
    return_4h_from_bars: float | None = None


@dataclass(frozen=True)
class SnapshotInput:
    canonical_provider_id: str
    symbol: str
    name: str
    identity_status: str
    tags: tuple[str, ...]
    source_timestamp: datetime
    price: float | None
    market_cap: float | None
    volume_24h: float | None
    return_1h: float | None = None
    return_4h: float | None = None
    return_24h: float | None = None
    return_7d: float | None = None
    return_30d: float | None = None
    return_60d: float | None = None
    return_90d: float | None = None
    rs_btc_7d: float | None = None
    rs_btc_30d: float | None = None
    rs_eth_7d: float | None = None
    date_added: datetime | None = None
    num_market_pairs: int | None = None
    open_interest: float | None = None
    funding_rate_8h: float | None = None
    critical_anomaly_flag: bool = False
    critical_anomaly_reason: str | None = None
    source_endpoint: str = "/v1/cryptocurrency/listings/latest"


@dataclass(frozen=True)
class FilterPreset:
    min_market_cap_usd: float = 10_000_000.0
    max_market_cap_usd: float = 1_000_000_000.0
    min_volume_24h_usd: float = 1_000_000.0
    min_vol_to_mcap: float = 0.02
    min_listing_age_days: int = 30
    max_early_return_24h_pct: float = 25.0
    max_early_return_7d_pct: float = 60.0
    max_data_age_seconds: int = 1800


@dataclass(frozen=True)
class BenchmarkDistribution:
    sample_size: int
    rs_btc_7d: tuple[float, ...] = ()
    rs_btc_30d: tuple[float, ...] = ()
    rs_eth_7d: tuple[float, ...] = ()
    return_24h: tuple[float, ...] = ()
    return_7d: tuple[float, ...] = ()
    return_30d: tuple[float, ...] = ()
    momentum_accel: tuple[float, ...] = ()


@dataclass(frozen=True)
class PenaltyItem:
    code: str
    points: float
    reason: str


@dataclass(frozen=True)
class RejectionReason:
    stage: str
    code: str
    reason: str
    observed_metrics: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class EvidenceObservation:
    evidence_type: str
    metric_name: str
    observed_value: object
    interpretation: str
    direction: EvidenceDirection
    source_endpoint: str
    quality_status: QualityStatus
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ComponentEval:
    name: str
    score: float | None
    base_weight: float
    effective_weight: float
    quality_status: QualityStatus


@dataclass(frozen=True)
class ScoredCandidate:
    canonical_provider_id: str
    symbol: str
    discovery_track: DiscoveryTrack
    trading_horizon: TradingHorizon
    score_version: str
    raw_score: float | None
    adjusted_score: float | None
    valid_weight_coverage: float
    confidence_level: ConfidenceLevel
    data_confidence: float
    signal_confidence: float
    liquidity_confidence: float
    liquidity_mode: Literal["PROXY", "VERIFIED_ORDERBOOK"]
    classification: ClassificationBand
    eligibility_status: EligibilityStatus
    components: dict[str, ComponentEval]
    penalties: tuple[PenaltyItem, ...]
    missing_components: tuple[str, ...]
    rejection_reasons: tuple[RejectionReason, ...]
    badges: tuple[str, ...]
    observations: tuple[EvidenceObservation, ...]


def geometric_rs(
    asset_return_pct: float | None,
    benchmark_return_pct: float | None,
) -> float | None:
    """Compute geometric relative strength in percentage points: (1+r_a)/(1+r_b) - 1."""
    if asset_return_pct is None or benchmark_return_pct is None:
        return None
    if not math.isfinite(asset_return_pct) or not math.isfinite(benchmark_return_pct):
        return None
    denom = 1.0 + (benchmark_return_pct / 100.0)
    num = 1.0 + (asset_return_pct / 100.0)
    if denom <= 0.0 or num <= 0.0:
        return None
    return ((num / denom) - 1.0) * 100.0


def momentum_acceleration(return_24h: float | None, return_7d: float | None) -> float | None:
    """Compute short-term inflection relative to 7d daily pace: r_24h - (r_7d / 7)."""
    if return_24h is None or return_7d is None:
        return None
    if not math.isfinite(return_24h) or not math.isfinite(return_7d):
        return None
    return return_24h - (return_7d / 7.0)


def derive_return_4h(
    current_price: float | None,
    current_ts: datetime,
    prior_snapshots: Sequence[tuple[datetime, float]],
) -> float | None:
    """Derive 4h return (%) from the closest snapshot in [T-4h30m, T-3h30m]."""
    if current_price is None or not math.isfinite(current_price) or current_price <= 0.0:
        return None
    target = current_ts - timedelta(hours=4)
    tolerance = timedelta(minutes=30)
    best_price: float | None = None
    best_delta: float | None = None
    for snap_ts, snap_price in prior_snapshots:
        if not math.isfinite(snap_price) or snap_price <= 0.0:
            continue
        delta = abs((snap_ts - target).total_seconds())
        if delta <= tolerance.total_seconds() and (best_delta is None or delta < best_delta):
            best_delta = delta
            best_price = snap_price
    if best_price is None:
        return None
    return ((current_price / best_price) - 1.0) * 100.0


def aggregate_1h_to_4h(bars_1h: Sequence[OhlcvBar]) -> list[OhlcvBar]:
    """Aggregate 1H OHLCV bars locally into 4H UTC buckets without inferring from daily bars."""
    if not bars_1h:
        return []
    ordered = sorted(
        (bar for bar in bars_1h if math.isfinite(bar.close) and bar.close > 0.0),
        key=lambda bar: bar.timestamp,
    )
    buckets: dict[datetime, list[OhlcvBar]] = {}
    for bar in ordered:
        ts = bar.timestamp
        floored = ts.replace(hour=(ts.hour // 4) * 4, minute=0, second=0, microsecond=0)
        buckets.setdefault(floored, []).append(bar)
    aggregated: list[OhlcvBar] = []
    for bucket_ts in sorted(buckets):
        group = buckets[bucket_ts]
        opens = [b.open for b in group if b.open is not None and math.isfinite(b.open)]
        highs = [b.high for b in group if b.high is not None and math.isfinite(b.high)]
        lows = [b.low for b in group if b.low is not None and math.isfinite(b.low)]
        vols = [b.volume for b in group if b.volume is not None and math.isfinite(b.volume)]
        aggregated.append(
            OhlcvBar(
                timestamp=bucket_ts,
                open=opens[0] if opens else group[0].close,
                high=max(highs) if highs else None,
                low=min(lows) if lows else None,
                close=group[-1].close,
                volume=sum(vols) if vols else None,
            )
        )
    return aggregated


def _ema_last(values: Sequence[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    alpha = 2.0 / (period + 1)
    ema = sum(values[:period]) / period
    for val in values[period:]:
        ema = (val - ema) * alpha + ema
    return ema


def _rsi_last(closes: Sequence[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    gains: list[float] = []
    losses: list[float] = []
    for idx in range(1, len(closes)):
        delta = closes[idx] - closes[idx - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for idx in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[idx]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[idx]) / period
    if avg_loss == 0.0:
        return 100.0 if avg_gain > 0.0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _atr_last(bars: Sequence[OhlcvBar], period: int = 14) -> float | None:
    if len(bars) <= period:
        return None
    trs: list[float] = []
    for idx in range(1, len(bars)):
        cur = bars[idx]
        prev_close = bars[idx - 1].close
        if cur.high is None or cur.low is None:
            return None
        tr = max(
            cur.high - cur.low,
            abs(cur.high - prev_close),
            abs(cur.low - prev_close),
        )
        trs.append(tr)
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = ((atr * (period - 1)) + tr) / period
    return atr


def _adx_last(bars: Sequence[OhlcvBar], period: int = 14) -> float | None:
    if len(bars) < (period * 2) + 1:
        return None
    trs: list[float] = []
    plus_dm: list[float] = []
    minus_dm: list[float] = []
    for idx in range(1, len(bars)):
        cur, prev = bars[idx], bars[idx - 1]
        if cur.high is None or cur.low is None or prev.high is None or prev.low is None:
            return None
        up_move = cur.high - prev.high
        down_move = prev.low - cur.low
        plus_dm.append(up_move if up_move > down_move and up_move > 0.0 else 0.0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0.0 else 0.0)
        trs.append(
            max(cur.high - cur.low, abs(cur.high - prev.close), abs(cur.low - prev.close))
        )
    if len(trs) < period * 2:
        return None
    tr_s = sum(trs[:period])
    pdm_s = sum(plus_dm[:period])
    mdm_s = sum(minus_dm[:period])
    dxs: list[float] = []
    for idx in range(period, len(trs)):
        tr_s = tr_s - (tr_s / period) + trs[idx]
        pdm_s = pdm_s - (pdm_s / period) + plus_dm[idx]
        mdm_s = mdm_s - (mdm_s / period) + minus_dm[idx]
        if tr_s <= 0.0:
            continue
        pdi = 100.0 * (pdm_s / tr_s)
        mdi = 100.0 * (mdm_s / tr_s)
        denom = pdi + mdi
        if denom > 0.0:
            dxs.append(100.0 * abs(pdi - mdi) / denom)
    if len(dxs) < period:
        return None
    adx = sum(dxs[:period]) / period
    for dx in dxs[period:]:
        adx = ((adx * (period - 1)) + dx) / period
    return adx


def _daily_log_sigma(closes: Sequence[float]) -> float | None:
    recent = closes[-31:]
    if len(recent) < 15:
        return None
    rets = [
        math.log(recent[idx] / recent[idx - 1])
        for idx in range(1, len(recent))
        if recent[idx] > 0.0 and recent[idx - 1] > 0.0
    ]
    if len(rets) < 14:
        return None
    mean_r = sum(rets) / len(rets)
    var = sum((r - mean_r) ** 2 for r in rets) / (len(rets) - 1)
    return math.sqrt(var)


def compute_historical_indicators(
    daily_bars: Sequence[OhlcvBar],
    bars_1h: Sequence[OhlcvBar] = (),
) -> HistoricalIndicators:
    """Compute technical indicators cleanly. Never infers 4H from daily or 4H EMA 200."""
    ordered_daily = sorted(
        (bar for bar in daily_bars if math.isfinite(bar.close) and bar.close > 0.0),
        key=lambda bar: bar.timestamp,
    )
    closes = [bar.close for bar in ordered_daily]
    vols = [
        bar.volume
        for bar in ordered_daily[-30:]
        if bar.volume is not None and math.isfinite(bar.volume) and bar.volume > 0.0
    ]
    vol_median_30d = float(median(vols)) if len(vols) >= 14 else None
    sigma_daily = _daily_log_sigma(closes)
    ann_vol = sigma_daily * math.sqrt(365.0) if sigma_daily is not None else None
    ema_20 = _ema_last(closes, 20)
    ema_50 = _ema_last(closes, 50)
    ema_200 = _ema_last(closes, 200)
    rsi_14 = _rsi_last(closes, 14)

    recent_ohlcv = ordered_daily[-30:]
    has_ohlcv = len(recent_ohlcv) >= 20 and all(
        bar.high is not None and bar.low is not None for bar in recent_ohlcv
    )
    atr_daily = _atr_last(ordered_daily, 14) if has_ohlcv else None
    adx_daily = _adx_last(ordered_daily, 14) if has_ohlcv else None
    ext_atr = (
        (closes[-1] - ema_20) / atr_daily
        if has_ohlcv and ema_20 is not None and atr_daily is not None and atr_daily > 0.0
        else None
    )
    hh_hl: bool | None = None
    if has_ohlcv and len(ordered_daily) >= 20:
        first_half = ordered_daily[-20:-10]
        second_half = ordered_daily[-10:]
        high1 = max(b.high for b in first_half if b.high is not None)
        high2 = max(b.high for b in second_half if b.high is not None)
        low1 = min(b.low for b in first_half if b.low is not None)
        low2 = min(b.low for b in second_half if b.low is not None)
        hh_hl = high2 > high1 and low2 > low1

    bars_4h = aggregate_1h_to_4h(bars_1h)
    has_4h = len(bars_4h) >= 15 and all(
        bar.high is not None and bar.low is not None for bar in bars_4h[-15:]
    )
    closes_4h = [bar.close for bar in bars_4h]
    # Note: 4H EMA 200 is intentionally never computed due to CMC 30-day intraday bar cap.
    ema_20_4h = _ema_last(closes_4h, 20) if closes_4h else None
    ema_50_4h = _ema_last(closes_4h, 50) if closes_4h else None
    ema_100_4h = _ema_last(closes_4h, 100) if closes_4h else None
    rsi_4h = _rsi_last(closes_4h, 14) if closes_4h else None
    atr_4h = _atr_last(bars_4h, 14) if has_4h else None
    ret_4h = (
        ((closes_4h[-1] / closes_4h[-2]) - 1.0) * 100.0
        if len(closes_4h) >= 2 and closes_4h[-2] > 0.0
        else None
    )

    return HistoricalIndicators(
        daily_bar_count=len(ordered_daily),
        bars_4h_count=len(bars_4h),
        has_ohlcv_candles=has_ohlcv,
        has_4h_candles=has_4h,
        ema_20_daily=ema_20,
        ema_50_daily=ema_50,
        ema_200_daily=ema_200,
        rsi_14_daily=rsi_14,
        daily_sigma_30d=sigma_daily,
        annualized_vol_30d=ann_vol,
        volume_median_30d=vol_median_30d,
        atr_14_daily=atr_daily,
        adx_14_daily=adx_daily,
        ext_atr_daily=ext_atr,
        higher_high_higher_low=hh_hl,
        ema_20_4h=ema_20_4h,
        ema_50_4h=ema_50_4h,
        ema_100_4h=ema_100_4h,
        rsi_14_4h=rsi_4h,
        atr_14_4h=atr_4h,
        return_4h_from_bars=ret_4h,
    )


def _is_excluded_asset(asset: SnapshotInput) -> str | None:
    if asset.identity_status != "VERIFIED":
        return f"identity_status={asset.identity_status}"
    if classify_stablecoin(asset.tags) == "verified_stablecoin":
        return "verified_stablecoin"
    normalized = {tag.strip().lower() for tag in asset.tags if tag.strip()}
    hit = normalized & EXCLUDED_ASSET_TAGS
    if hit:
        return f"excluded_tag:{sorted(hit)[0]}"
    return None


def _winsorized_sorted(values: Sequence[float | None]) -> tuple[float, ...]:
    clean = sorted(v for v in values if v is not None and math.isfinite(v))
    n = len(clean)
    if n < 3:
        return tuple(clean)
    low_idx = max(0, int(math.floor(0.02 * (n - 1))))
    high_idx = min(n - 1, int(math.ceil(0.98 * (n - 1))))
    low_val = clean[low_idx]
    high_val = clean[high_idx]
    return tuple(min(high_val, max(low_val, v)) for v in clean)


def build_benchmark_distribution(assets: Sequence[SnapshotInput]) -> BenchmarkDistribution:
    """Build winsorized p2/p98 reference benchmark over eligible non-excluded universe."""
    ref = [
        asset
        for asset in assets
        if _is_excluded_asset(asset) is None
        and asset.market_cap is not None
        and asset.market_cap >= MIN_BENCHMARK_MCAP_USD
        and asset.volume_24h is not None
        and asset.volume_24h >= MIN_BENCHMARK_VOL_USD
    ]
    return BenchmarkDistribution(
        sample_size=len(ref),
        rs_btc_7d=_winsorized_sorted([a.rs_btc_7d for a in ref]),
        rs_btc_30d=_winsorized_sorted([a.rs_btc_30d for a in ref]),
        rs_eth_7d=_winsorized_sorted([a.rs_eth_7d for a in ref]),
        return_24h=_winsorized_sorted([a.return_24h for a in ref]),
        return_7d=_winsorized_sorted([a.return_7d for a in ref]),
        return_30d=_winsorized_sorted([a.return_30d for a in ref]),
        momentum_accel=_winsorized_sorted(
            [momentum_acceleration(a.return_24h, a.return_7d) for a in ref]
        ),
    )


def _percentile_rank(value: float, sorted_dist: Sequence[float]) -> float:
    if not sorted_dist:
        return 0.5
    if len(sorted_dist) == 1:
        return 1.0 if value >= sorted_dist[0] else 0.0
    below = sum(1 for x in sorted_dist if x < value)
    equal = sum(1 for x in sorted_dist if x == value)
    return (below + 0.5 * equal) / len(sorted_dist)


def hybrid_metric_score(
    value: float | None,
    sorted_dist: Sequence[float],
    *,
    absolute_scale: float = 25.0,
) -> float | None:
    """Blend 70% winsorized cross-sectional percentile with 30% positive-gated absolute score."""
    if value is None or not math.isfinite(value):
        return None
    if not sorted_dist:
        return None
    pct = _percentile_rank(value, sorted_dist) * 100.0
    abs_score = 0.0 if value <= 0.0 else 100.0 * min(1.0, value / absolute_scale)
    return (0.70 * pct) + (0.30 * abs_score)


def score_sweet_spot_turnover(
    ratio: float | None,
) -> tuple[float | None, PenaltyItem | None]:
    """Score vol/mcap with peak plateau 0.05..0.35 and wash-trading penalty above 0.70."""
    if ratio is None or not math.isfinite(ratio) or ratio < 0.0:
        return None, None
    if ratio < 0.02:
        return 0.0, None
    if ratio <= 0.05:
        return 40.0 + ((ratio - 0.02) / 0.03) * 40.0, None
    if ratio <= 0.35:
        return 80.0 + ((ratio - 0.05) / 0.30) * 20.0, None
    if ratio <= 0.70:
        return 100.0 - ((ratio - 0.35) / 0.35) * 50.0, None
    decayed = max(20.0, 50.0 - ((ratio - 0.70) * 50.0))
    penalty = PenaltyItem(
        code="EXCESSIVE_TURNOVER_ANOMALY",
        points=6.0,
        reason=f"vol_to_mcap ratio {ratio:.2f} exceeds 0.70 wash-trading threshold.",
    )
    return decayed, penalty


def evaluate_hard_gates(
    asset: SnapshotInput,
    *,
    now: datetime,
    track: DiscoveryTrack,
    preset: FilterPreset,
) -> tuple[list[RejectionReason], bool]:
    """Evaluate mandatory exclusion, freshness, liquidity, and anti-chase hard gates."""
    rejections: list[RejectionReason] = []
    partial_age = False

    excluded = _is_excluded_asset(asset)
    if excluded is not None:
        rejections.append(
            RejectionReason("EXCLUSION", "EXCLUDED_UNIVERSE", f"Excluded: {excluded}.")
        )

    age_seconds = max(0.0, (now - asset.source_timestamp).total_seconds())
    if age_seconds > preset.max_data_age_seconds:
        rejections.append(
            RejectionReason(
                "FRESHNESS",
                "STALE_SNAPSHOT",
                f"Snapshot age {int(age_seconds)}s exceeds {preset.max_data_age_seconds}s.",
                {"age_seconds": int(age_seconds)},
            )
        )

    if asset.price is None or asset.market_cap is None or asset.volume_24h is None:
        rejections.append(
            RejectionReason(
                "QUALITY",
                "MISSING_CORE_QUOTE",
                "Missing price, market_cap, or volume_24h quote.",
            )
        )
    else:
        if (
            asset.market_cap < preset.min_market_cap_usd
            or asset.market_cap > preset.max_market_cap_usd
        ):
            rejections.append(
                RejectionReason(
                    "QUALITY",
                    "MARKET_CAP_OUT_OF_RANGE",
                    f"market_cap ${asset.market_cap:,.0f} outside target preset bounds.",
                    {"market_cap": asset.market_cap},
                )
            )
        if asset.volume_24h < preset.min_volume_24h_usd:
            rejections.append(
                RejectionReason(
                    "QUALITY",
                    "LOW_VOLUME_24H",
                    f"volume_24h ${asset.volume_24h:,.0f} < ${preset.min_volume_24h_usd:,.0f}.",
                    {"volume_24h": asset.volume_24h},
                )
            )
        ratio = volume_to_mcap(asset.volume_24h, asset.market_cap)
        if ratio is None or ratio < preset.min_vol_to_mcap:
            rejections.append(
                RejectionReason(
                    "QUALITY",
                    "LOW_TURNOVER_RATIO",
                    f"vol_to_mcap {ratio} below minimum {preset.min_vol_to_mcap}.",
                    {"vol_to_mcap": ratio},
                )
            )

    if asset.date_added is None:
        partial_age = True
    else:
        listing_days = (now - asset.date_added).total_seconds() / 86400.0
        if listing_days < preset.min_listing_age_days:
            rejections.append(
                RejectionReason(
                    "QUALITY",
                    "NEW_LISTING_AGE",
                    f"listing age {listing_days:.1f}d < {preset.min_listing_age_days}d.",
                    {"listing_age_days": round(listing_days, 1)},
                )
            )

    if track == "EARLY":
        if asset.return_24h is not None and asset.return_24h > preset.max_early_return_24h_pct:
            rejections.append(
                RejectionReason(
                    "ANTI_CHASE",
                    "EARLY_24H_CEILING",
                    (
                        f"24h return +{asset.return_24h:.1f}% exceeds "
                        f"+{preset.max_early_return_24h_pct}%."
                    ),
                    {"return_24h": asset.return_24h},
                )
            )
        if asset.return_7d is not None and asset.return_7d > preset.max_early_return_7d_pct:
            rejections.append(
                RejectionReason(
                    "ANTI_CHASE",
                    "EARLY_7D_CEILING",
                    (
                        f"7d return +{asset.return_7d:.1f}% exceeds "
                        f"+{preset.max_early_return_7d_pct}%."
                    ),
                    {"return_7d": asset.return_7d},
                )
            )

    if asset.critical_anomaly_flag:
        rejections.append(
            RejectionReason(
                "RISK",
                "CRITICAL_ANOMALY",
                asset.critical_anomaly_reason or "Critical anomaly / data integrity failure.",
            )
        )
    return rejections, partial_age


def _configured_weights(
    track: DiscoveryTrack,
    horizon: TradingHorizon,
    regime: MarketRegimeType,
) -> dict[str, float]:
    weights = dict(_BASE_WEIGHTS_EARLY if track == "EARLY" else _BASE_WEIGHTS_CONFIRMED)
    if track == "EARLY":
        if horizon == "SHORT_TERM":
            weights["early_structure"] -= 5.0
            weights["momentum_acceleration"] += 2.5
            weights["volume_activity"] += 2.5
        else:
            weights["momentum_acceleration"] -= 5.0
            weights["early_structure"] += 2.5
            weights["relative_strength"] += 2.5
        if regime == "RANGE_CONSOLIDATION":
            weights["volume_activity"] += 2.5
            weights["relative_strength"] += 2.5
        elif regime in {"BTC_LED_EXPANSION", "RISK_OFF_STRESS"}:
            weights["relative_strength"] += 5.0
    else:
        if horizon == "SHORT_TERM":
            weights["trend_structure"] -= 5.0
            weights["volume_confirmation"] += 2.5
            weights["mtf_momentum"] += 2.5
        else:
            weights["volume_confirmation"] -= 5.0
            weights["trend_structure"] += 2.5
            weights["relative_strength"] += 2.5
        if regime == "RISK_ON_ALTSEASON":
            weights["trend_structure"] += weights["trend_structure"] * 0.10
        elif regime in {"BTC_LED_EXPANSION", "RISK_OFF_STRESS"}:
            weights["relative_strength"] += 5.0
    return weights


def _score_mean(values: Sequence[float | None]) -> float | None:
    valid = [v for v in values if v is not None and math.isfinite(v)]
    if not valid:
        return None
    return sum(valid) / len(valid)


def _score_structure(
    asset: SnapshotInput,
    hist: HistoricalIndicators | None,
    track: DiscoveryTrack,
) -> tuple[float | None, QualityStatus]:
    if hist is None or asset.price is None or asset.price <= 0.0:
        return None, "UNKNOWN"
    signals: list[float] = []
    if hist.ema_20_daily is not None:
        signals.append(85.0 if asset.price >= hist.ema_20_daily else 35.0)
    if hist.ema_50_daily is not None:
        signals.append(90.0 if asset.price >= hist.ema_50_daily else 30.0)
    if hist.rsi_14_daily is not None:
        rsi = hist.rsi_14_daily
        if track == "EARLY":
            signals.append(85.0 if 45.0 <= rsi <= 68.0 else (60.0 if 35.0 <= rsi < 45.0 else 35.0))
        else:
            signals.append(90.0 if 52.0 <= rsi <= 72.0 else (55.0 if 40.0 <= rsi < 52.0 else 30.0))
    if hist.has_ohlcv_candles and hist.higher_high_higher_low is not None:
        signals.append(90.0 if hist.higher_high_higher_low else 40.0)
    if hist.adx_14_daily is not None and track == "CONFIRMED":
        signals.append(min(100.0, max(30.0, hist.adx_14_daily * 2.5)))
    if not signals:
        return None, "UNKNOWN"
    status: QualityStatus = "VALID" if hist.has_ohlcv_candles else "PARTIAL"
    return sum(signals) / len(signals), status


def _score_volume_component(
    asset: SnapshotInput,
    hist: HistoricalIndicators | None,
    track: DiscoveryTrack,
    penalties: list[PenaltyItem],
    observations: list[EvidenceObservation],
) -> tuple[float | None, QualityStatus]:
    if asset.volume_24h is None or hist is None or hist.volume_median_30d is None:
        observations.append(
            EvidenceObservation(
                "VOLUME",
                "volume_vs_median_30d",
                None,
                "30-day median volume baseline unavailable; marked UNKNOWN.",
                "MISSING",
                asset.source_endpoint,
                "UNKNOWN",
            )
        )
        return None, "UNKNOWN"
    vol_ratio = asset.volume_24h / hist.volume_median_30d
    ret_24 = asset.return_24h
    if track == "EARLY" and vol_ratio >= 1.8 and ret_24 is not None and 0.0 <= ret_24 <= 8.0:
        score = 95.0
        interp = (
            f"Volume {vol_ratio:.2f}x 30d median during calm {ret_24:+.1f}% move "
            "(early compression)."
        )
    elif vol_ratio >= 1.5:
        score = min(90.0, 65.0 + (vol_ratio - 1.5) * 20.0)
        interp = f"Volume expanded to {vol_ratio:.2f}x 30d median."
    elif vol_ratio >= 1.0:
        score = 50.0 + ((vol_ratio - 1.0) * 30.0)
        interp = f"Volume steady at {vol_ratio:.2f}x 30d median."
    else:
        score = max(20.0, vol_ratio * 50.0)
        interp = f"Volume below 30d median ({vol_ratio:.2f}x)."
        if track == "CONFIRMED":
            penalties.append(
                PenaltyItem("WEAK_VOLUME_CONFIRMATION", 5.0, "Confirmed volume below 30d median.")
            )
    observations.append(
        EvidenceObservation(
            "VOLUME",
            "volume_vs_median_30d",
            round(vol_ratio, 3),
            interp,
            "POSITIVE" if score >= 60.0 else "NEUTRAL",
            asset.source_endpoint,
            "VALID",
        )
    )
    return score, "VALID"


def _score_risk_and_extension(
    asset: SnapshotInput,
    hist: HistoricalIndicators | None,
    regime: MarketRegimeType,
    penalties: list[PenaltyItem],
    observations: list[EvidenceObservation],
) -> tuple[float | None, QualityStatus]:
    ext_threshold = 2.0 if regime == "RISK_OFF_STRESS" else 2.5
    if hist is None:
        return None, "UNKNOWN"
    score = 80.0
    if hist.has_ohlcv_candles and hist.ext_atr_daily is not None:
        ext = hist.ext_atr_daily
        if ext > ext_threshold:
            penalties.append(
                PenaltyItem(
                    "ATR_EXTENSION_RISK",
                    8.0,
                    f"Price extended {ext:.2f} ATR above EMA20 (>{ext_threshold:.1f}).",
                )
            )
            score = 45.0
        observations.append(
            EvidenceObservation(
                "RISK",
                "atr_extension_ema20",
                round(ext, 3),
                f"ATR extension from EMA20 is {ext:.2f}.",
                "NEGATIVE" if ext > ext_threshold else "POSITIVE",
                "historical_cache",
                "VALID",
            )
        )
        return score, "VALID"

    if (
        hist.daily_sigma_30d is not None
        and hist.daily_sigma_30d > 0.0
        and asset.return_24h is not None
    ):
        z_ret = (asset.return_24h / 100.0) / hist.daily_sigma_30d
        if z_ret > ext_threshold:
            penalties.append(
                PenaltyItem(
                    "RETURN_Z_EXTENSION_RISK",
                    8.0,
                    f"24h return z-score {z_ret:.2f} exceeds {ext_threshold:.1f} sigma.",
                )
            )
            score = 45.0
        observations.append(
            EvidenceObservation(
                "RISK",
                "return_sigma_extension",
                round(z_ret, 3),
                f"Close-based 24h extension Z={z_ret:.2f} (30d daily sigma, sqrt(365) basis).",
                "NEGATIVE" if z_ret > ext_threshold else "POSITIVE",
                "quotes_historical",
                "PARTIAL",
            )
        )
        return score, "PARTIAL"
    return None, "UNKNOWN"


def _classify_band(
    adjusted_score: float | None,
    *,
    coverage: float,
    rejected: bool,
    track: DiscoveryTrack,
    profile: CapabilityProfile,
    regime: MarketRegimeType,
) -> ClassificationBand:
    if coverage < MIN_VALID_WEIGHT_COVERAGE or adjusted_score is None:
        return "INSUFFICIENT_DATA"
    if rejected:
        return "LOW_PRIORITY"
    hq_min = 80.0 if regime == "RISK_OFF_STRESS" else 85.0
    if adjusted_score >= hq_min:
        band: ClassificationBand = "HIGH_QUALITY_CANDIDATE"
    elif adjusted_score >= 75.0:
        band = "STRONG_CANDIDATE"
    elif adjusted_score >= 65.0:
        band = "EMERGING_CANDIDATE"
    elif adjusted_score >= 50.0:
        band = "WATCH"
    else:
        band = "LOW_PRIORITY"

    if (
        track == "CONFIRMED"
        and profile == "BASIC_CAPABILITY_PROFILE"
        and band in {"HIGH_QUALITY_CANDIDATE", "STRONG_CANDIDATE"}
    ):
        return "EMERGING_CANDIDATE"
    return band


def score_candidate(
    asset: SnapshotInput,
    benchmark: BenchmarkDistribution,
    *,
    now: datetime,
    track: DiscoveryTrack,
    horizon: TradingHorizon,
    profile: CapabilityProfile,
    regime: MarketRegimeType,
    preset: FilterPreset | None = None,
    historical: HistoricalIndicators | None = None,
) -> ScoredCandidate:
    """Deterministically evaluate hard gates, component scores, penalties, and confidence."""
    cfg = preset or FilterPreset()
    rejections, partial_age = evaluate_hard_gates(asset, now=now, track=track, preset=cfg)
    weights = _configured_weights(track, horizon, regime)
    penalties: list[PenaltyItem] = []
    observations: list[EvidenceObservation] = []
    badges: list[str] = []
    if partial_age:
        badges.append("PARTIAL_LISTING_AGE")

    # 1. Market Quality & Turnover
    turnover = volume_to_mcap(asset.volume_24h, asset.market_cap)
    mq_score, turnover_pen = score_sweet_spot_turnover(turnover)
    if turnover_pen is not None:
        penalties.append(turnover_pen)
    mq_status: QualityStatus = "VALID" if mq_score is not None else "UNKNOWN"
    mq_dir: EvidenceDirection = (
        "POSITIVE"
        if mq_score and mq_score >= 75
        else ("MISSING" if mq_score is None else "NEUTRAL")
    )
    observations.append(
        EvidenceObservation(
            "LIQUIDITY",
            "vol_to_mcap",
            round(turnover, 4) if turnover is not None else None,
            "Turnover within sweet spot." if mq_score and mq_score >= 75 else "Turnover scored.",
            mq_dir,
            asset.source_endpoint,
            mq_status,
        )
    )

    # 2. Relative Strength
    rs_score = _score_mean(
        [
            hybrid_metric_score(asset.rs_btc_7d, benchmark.rs_btc_7d, absolute_scale=20.0),
            hybrid_metric_score(asset.rs_btc_30d, benchmark.rs_btc_30d, absolute_scale=40.0),
            hybrid_metric_score(asset.rs_eth_7d, benchmark.rs_eth_7d, absolute_scale=20.0),
        ]
    )
    rs_status: QualityStatus = "VALID" if rs_score is not None else "UNKNOWN"
    rs_dir: EvidenceDirection = (
        "POSITIVE"
        if (asset.rs_btc_7d or 0.0) > 0
        else ("MISSING" if asset.rs_btc_7d is None else "NEGATIVE")
    )
    observations.append(
        EvidenceObservation(
            "RELATIVE_STRENGTH",
            "rs_btc_7d",
            round(asset.rs_btc_7d, 3) if asset.rs_btc_7d is not None else None,
            f"7d geometric RS vs BTC: {asset.rs_btc_7d:+.2f}%"
            if asset.rs_btc_7d is not None
            else "7d RS vs BTC unavailable.",
            rs_dir,
            asset.source_endpoint,
            rs_status,
        )
    )

    # 3. Volume & Structure & Risk
    vol_score, vol_status = _score_volume_component(
        asset, historical, track, penalties, observations
    )
    struct_score, struct_status = _score_structure(asset, historical, track)
    risk_score, risk_status = _score_risk_and_extension(
        asset, historical, regime, penalties, observations
    )

    component_scores: dict[str, tuple[float | None, QualityStatus]] = {
        "market_quality": (mq_score, mq_status),
        "relative_strength": (rs_score, rs_status),
        "risk_quality": (risk_score, risk_status),
    }

    if track == "EARLY":
        accel = momentum_acceleration(asset.return_24h, asset.return_7d)
        accel_score = hybrid_metric_score(accel, benchmark.momentum_accel, absolute_scale=15.0)
        component_scores["volume_activity"] = (vol_score, vol_status)
        component_scores["momentum_acceleration"] = (
            accel_score,
            "VALID" if accel_score is not None else "UNKNOWN",
        )
        component_scores["early_structure"] = (struct_score, struct_status)
    else:
        mtf_score = _score_mean(
            [
                hybrid_metric_score(asset.return_24h, benchmark.return_24h, absolute_scale=15.0),
                hybrid_metric_score(asset.return_7d, benchmark.return_7d, absolute_scale=30.0),
                hybrid_metric_score(asset.return_30d, benchmark.return_30d, absolute_scale=60.0),
            ]
        )
        deriv_score: float | None = None
        deriv_status: QualityStatus = "UNKNOWN"
        if asset.open_interest is not None or asset.funding_rate_8h is not None:
            funding_ok = asset.funding_rate_8h is None or abs(asset.funding_rate_8h) <= 0.05
            deriv_score = 80.0 if funding_ok else 45.0
            deriv_status = "VALID" if asset.open_interest is not None else "PARTIAL"
        component_scores["mtf_momentum"] = (
            mtf_score,
            "VALID" if mtf_score is not None else "UNKNOWN",
        )
        component_scores["volume_confirmation"] = (vol_score, vol_status)
        component_scores["trend_structure"] = (struct_score, struct_status)
        component_scores["derivatives_positioning"] = (deriv_score, deriv_status)

    # Exclude optional derivatives weight from missing penalty when profile disables/omits it
    total_base = sum(weights.values())
    valid_weight_sum = sum(
        weights[k]
        for k, (val, st) in component_scores.items()
        if val is not None and st not in {"UNKNOWN", "INVALID"}
    )
    coverage = valid_weight_sum / total_base if total_base > 0.0 else 0.0

    evaluated: dict[str, ComponentEval] = {}
    missing: list[str] = []
    weighted_total = 0.0
    for key, base_w in weights.items():
        val, st = component_scores[key]
        if val is None or st in {"UNKNOWN", "INVALID"} or valid_weight_sum <= 0.0:
            missing.append(key)
            evaluated[key] = ComponentEval(key, None, base_w, 0.0, st)
        else:
            eff_w = base_w / valid_weight_sum
            weighted_total += val * eff_w
            evaluated[key] = ComponentEval(key, round(val, 2), base_w, round(eff_w, 4), st)

    penalty_mult = 1.35 if regime == "RISK_OFF_STRESS" else 1.0
    scaled_penalties = tuple(
        PenaltyItem(p.code, round(p.points * penalty_mult, 2), p.reason) for p in penalties
    )
    raw_score = round(weighted_total, 2) if coverage >= MIN_VALID_WEIGHT_COVERAGE else None
    adjusted_score = (
        round(max(0.0, weighted_total - sum(p.points for p in scaled_penalties)), 2)
        if raw_score is not None
        else None
    )

    if profile == "BASIC_CAPABILITY_PROFILE" and track == "CONFIRMED":
        badges.append("NO_OHLCV_VERIFICATION")

    if (
        regime == "RANGE_CONSOLIDATION"
        and track == "CONFIRMED"
        and historical is not None
        and historical.volume_median_30d is not None
        and asset.volume_24h is not None
        and (asset.volume_24h / historical.volume_median_30d) < 1.5
        and adjusted_score is not None
        and adjusted_score >= 75.0
    ):
        badges.append("LOW_BREAKOUT_VOLUME_CAP")
        adjusted_score = 74.0

    classification = _classify_band(
        adjusted_score,
        coverage=coverage,
        rejected=bool(rejections),
        track=track,
        profile=profile,
        regime=regime,
    )

    data_conf = max(
        0.0,
        (coverage * 100.0)
        - (10.0 if regime == "UNKNOWN" else 0.0)
        - (0.0 if (historical and historical.has_ohlcv_candles) else 15.0),
    )
    sig_conf = max(0.0, min(100.0, (adjusted_score or 0.0) - (len(scaled_penalties) * 8.0)))
    liq_conf = min(75.0, mq_score if mq_score is not None else 0.0)
    combined_conf = (0.40 * data_conf) + (0.35 * sig_conf) + (0.25 * liq_conf)

    if coverage < MIN_VALID_WEIGHT_COVERAGE:
        conf_level: ConfidenceLevel = "INSUFFICIENT"
    elif combined_conf >= 80.0 and coverage >= 0.85:
        conf_level = "HIGH"
    elif combined_conf >= 60.0:
        conf_level = "MEDIUM"
    elif combined_conf >= 40.0:
        conf_level = "LOW"
    else:
        conf_level = "INSUFFICIENT"

    if track == "CONFIRMED" and profile == "BASIC_CAPABILITY_PROFILE" and conf_level == "HIGH":
        conf_level = "MEDIUM"
    if regime == "RISK_OFF_STRESS" and conf_level == "HIGH":
        conf_level = "MEDIUM"

    if rejections:
        eligibility: EligibilityStatus = "REJECTED"
    elif coverage < MIN_VALID_WEIGHT_COVERAGE or classification == "INSUFFICIENT_DATA":
        eligibility = "INSUFFICIENT_DATA"
    elif classification == "WATCH":
        eligibility = "WATCH"
    elif classification == "LOW_PRIORITY":
        eligibility = "WATCH"
    else:
        eligibility = "ELIGIBLE"

    return ScoredCandidate(
        canonical_provider_id=asset.canonical_provider_id,
        symbol=asset.symbol,
        discovery_track=track,
        trading_horizon=horizon,
        score_version=HIDDEN_GEM_SCORE_VERSION,
        raw_score=raw_score,
        adjusted_score=adjusted_score,
        valid_weight_coverage=round(coverage, 4),
        confidence_level=conf_level,
        data_confidence=round(data_conf, 2),
        signal_confidence=round(sig_conf, 2),
        liquidity_confidence=round(liq_conf, 2),
        liquidity_mode="PROXY",
        classification=classification,
        eligibility_status=eligibility,
        components=evaluated,
        penalties=scaled_penalties,
        missing_components=tuple(missing),
        rejection_reasons=tuple(rejections),
        badges=tuple(badges),
        observations=tuple(observations),
    )


def build_deterministic_explanation(
    candidate: ScoredCandidate,
    persisted_evidence: Sequence[dict[str, object]],
) -> dict[str, object]:
    """Generate deterministic evidence-cited Stage 8 JSON explanation without any LLM call."""
    why: list[dict[str, str]] = []
    positive: list[dict[str, str]] = []
    negative: list[dict[str, str]] = []
    risks: list[dict[str, str]] = []
    missing_data = list(candidate.missing_components)

    for row in persisted_evidence:
        eid = str(row.get("id") or "")
        interp = str(row.get("interpretation") or row.get("metric_name") or "")
        direction = str(row.get("direction") or "NEUTRAL")
        ev_type = str(row.get("evidence_type") or "")
        if not eid or not interp:
            continue
        item = {"claim": interp, "evidence_id": eid}
        if ev_type == "RISK":
            risks.append({"risk": interp, "evidence_id": eid})
        if direction == "POSITIVE":
            positive.append(item)
            if len(why) < 3:
                why.append(item)
        elif direction == "NEGATIVE":
            negative.append(item)

    score_text = (
        f"{candidate.adjusted_score:.1f}/100"
        if candidate.adjusted_score is not None
        else "INSUFFICIENT_DATA"
    )
    summary = (
        f"{candidate.symbol} evaluated on {candidate.discovery_track}/{candidate.trading_horizon} "
        f"({candidate.classification}, status={candidate.eligibility_status}, score={score_text}, "
        f"confidence={candidate.confidence_level})."
    )
    return {
        "summary": summary,
        "why_discovered": why,
        "positive_evidence": positive,
        "negative_evidence": negative,
        "missing_data": missing_data,
        "key_risks": risks,
        "what_to_monitor": [
            "Maintain vol_to_mcap within 0.02-0.35 without spike anomalies.",
            "Monitor 7d geometric relative strength vs BTC.",
        ],
        "invalidation_conditions": [
            "volume_24h falls below preset floor or critical anomaly triggers.",
            "7d relative strength vs BTC turns sharply negative across consecutive rescans.",
        ],
    }
