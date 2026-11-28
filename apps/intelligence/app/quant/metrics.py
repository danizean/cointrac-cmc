import math
from collections.abc import Mapping, Sequence
from datetime import datetime

import numpy as np
import pandas as pd

MOMENTUM_WEIGHTS = {"24h": 0.15, "7d": 0.35, "30d": 0.30, "60d": 0.20}
MIN_OBSERVATIONS = 5
METRICS_METHODOLOGY_VERSION = "cointrac_metrics_v1.1"


def utc_daily_close(observations: Sequence[tuple[datetime, float]]) -> pd.Series:
    rows: list[tuple[pd.Timestamp, pd.Timestamp, float]] = []
    for timestamp, price in observations:
        if not _positive(price):
            continue
        stamp = pd.Timestamp(timestamp)
        if stamp.tzinfo is None:
            stamp = stamp.tz_localize("UTC")
        else:
            stamp = stamp.tz_convert("UTC")
        rows.append((stamp.normalize(), stamp, float(price)))
    if not rows:
        return pd.Series(dtype="float64")
    frame = pd.DataFrame(rows, columns=["day", "timestamp", "price"])
    last = frame.sort_values("timestamp").groupby("day", sort=True).tail(1)
    return last.set_index("day")["price"].astype(float).sort_index()


def simple_returns(prices: pd.Series) -> pd.Series:
    return _consecutive_returns(prices, logarithmic=False)


def log_returns(prices: pd.Series) -> pd.Series:
    return _consecutive_returns(prices, logarithmic=True)


def annualized_volatility(returns: pd.Series) -> float | None:
    clean = _finite(returns)
    if len(clean) < MIN_OBSERVATIONS:
        return None
    deviation = float(clean.std(ddof=1))
    if not math.isfinite(deviation):
        return None
    return deviation * math.sqrt(365)


def maximum_drawdown(prices: pd.Series) -> float | None:
    clean = _finite(prices)
    if clean.empty or (clean <= 0).any():
        return None
    drawdown = clean / clean.cummax() - 1
    return float(drawdown.min())


def beta(asset_returns: pd.Series, benchmark_returns: pd.Series) -> float | None:
    paired = _paired(asset_returns, benchmark_returns)
    if paired is None:
        return None
    asset, benchmark = paired
    variance = float(benchmark.var(ddof=1))
    if variance == 0 or not math.isfinite(variance):
        return None
    covariance = float(asset.cov(benchmark))
    if not math.isfinite(covariance):
        return None
    return covariance / variance


def pearson_correlation(asset_returns: pd.Series, benchmark_returns: pd.Series) -> float | None:
    paired = _paired(asset_returns, benchmark_returns)
    if paired is None:
        return None
    asset, benchmark = paired
    if float(asset.var(ddof=1)) == 0 or float(benchmark.var(ddof=1)) == 0:
        return None
    value = float(asset.corr(benchmark))
    if not math.isfinite(value):
        return None
    return value


def volume_to_mcap(volume_24h: float | None, market_cap: float | None) -> float | None:
    if not _positive(market_cap) or volume_24h is None or not math.isfinite(volume_24h):
        return None
    if volume_24h < 0:
        return None
    return volume_24h / market_cap


def fdv_to_mcap_ratio(
    fully_diluted_market_cap: float | None,
    market_cap: float | None,
) -> float | None:
    if not _positive(market_cap) or fully_diluted_market_cap is None:
        return None
    if not math.isfinite(fully_diluted_market_cap) or fully_diluted_market_cap < 0:
        return None
    return fully_diluted_market_cap / market_cap


def circulating_supply_pct(
    circulating_supply: float | None,
    max_supply: float | None,
) -> float | None:
    if not _positive(max_supply) or circulating_supply is None:
        return None
    if not math.isfinite(circulating_supply) or circulating_supply < 0:
        return None
    return 100.0 * circulating_supply / max_supply


def relative_strength(asset_change: float | None, benchmark_change: float | None) -> float | None:
    if asset_change is None or benchmark_change is None:
        return None
    if not math.isfinite(asset_change) or not math.isfinite(benchmark_change):
        return None
    return asset_change - benchmark_change


def acceleration_7d_vs_30d(change_7d: float | None, change_30d: float | None) -> float | None:
    """Cumulative 7d minus 30d return spread (pp); kept for backward compatibility."""
    return relative_strength(change_7d, change_30d)


def daily_rate_spread_7d_vs_30d(
    change_7d: float | None,
    change_30d: float | None,
) -> float | None:
    """Normalized average daily return spread: (7d / 7) - (30d / 30) percentage points/day."""
    if change_7d is None or change_30d is None:
        return None
    if not math.isfinite(change_7d) or not math.isfinite(change_30d):
        return None
    return (change_7d / 7.0) - (change_30d / 30.0)


def count_available_timeframes(changes: Mapping[str, float | None]) -> int:
    return sum(
        1
        for key in MOMENTUM_WEIGHTS
        if (value := changes.get(key)) is not None and math.isfinite(value)
    )


def sigmoid_momentum_score(changes: Mapping[str, float | None]) -> float | None:
    weighted = 0.0
    weight = 0.0
    for key, factor in MOMENTUM_WEIGHTS.items():
        value = changes.get(key)
        if value is None or not math.isfinite(value):
            continue
        weighted += factor * _sigmoid(value / 10.0)
        weight += factor
    if weight == 0:
        return None
    return weighted / weight * 100.0


def composite_momentum_score(changes: Mapping[str, float | None]) -> tuple[float | None, int]:
    """Single deterministic momentum score (0-100) + populated timeframe count across workflows."""
    return sigmoid_momentum_score(changes), count_available_timeframes(changes)


def cross_sectional_momentum_scores(
    rows: Sequence[Mapping[str, float | None]],
) -> list[float | None]:
    frame = pd.DataFrame(list(rows))
    percentiles: dict[str, pd.Series] = {}
    for key in MOMENTUM_WEIGHTS:
        if key not in frame.columns:
            continue
        column = pd.to_numeric(frame[key], errors="coerce")
        percentiles[key] = column.rank(method="average", pct=True)
    scores: list[float | None] = []
    for index in range(len(rows)):
        weighted = 0.0
        weight = 0.0
        for key, factor in MOMENTUM_WEIGHTS.items():
            series = percentiles.get(key)
            if series is None or index >= len(series):
                continue
            value = series.iloc[index]
            if pd.isna(value):
                continue
            weighted += factor * float(value)
            weight += factor
        scores.append(None if weight == 0 else weighted / weight * 100.0)
    return scores


def _consecutive_returns(prices: pd.Series, *, logarithmic: bool) -> pd.Series:
    if prices.empty:
        return pd.Series(dtype="float64")
    ordered = prices.sort_index()
    previous = ordered.shift(1)
    gap_days = ordered.index.to_series().diff().dt.days
    valid = previous.notna() & (gap_days == 1) & (previous > 0) & (ordered > 0)
    if logarithmic:
        values = np.log(ordered / previous)
    else:
        values = ordered / previous - 1
    return values.where(valid).dropna()


def _paired(left: pd.Series, right: pd.Series) -> tuple[pd.Series, pd.Series] | None:
    joined = pd.concat([left.rename("asset"), right.rename("benchmark")], axis=1, join="inner")
    joined = joined.replace([np.inf, -np.inf], np.nan).dropna()
    if len(joined) < MIN_OBSERVATIONS:
        return None
    return joined["asset"], joined["benchmark"]


def _finite(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    return numeric.astype(float)


def _positive(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0


def _sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    natural = math.exp(value)
    return natural / (1.0 + natural)
