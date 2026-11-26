import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

MIN_SECTOR_CONSTITUENTS = 5
MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS = 900.0
MAX_PLAUSIBLE_24H_CHANGE_PCT = 1000.0
MAX_PLAUSIBLE_7D_CHANGE_PCT = 5000.0
LARGE_CAP_VOLUME_CHECK_USD = 1_000_000.0
MIN_CAP_WEIGHT_VOLUME_USD = 1_000.0


@dataclass(frozen=True)
class MarketReturnBenchmark:
    median_change_24h_pct: float | None
    median_change_7d_pct: float | None
    sample_24h: int
    sample_7d: int


def market_median_benchmark(constituents: Sequence["Constituent"]) -> MarketReturnBenchmark:
    """Compute non-stablecoin market median 24h and 7d returns (percentage points)."""
    changes_24h = _numbers(item.percent_change_24h for item in constituents)
    changes_7d = _numbers(item.percent_change_7d for item in constituents)
    return MarketReturnBenchmark(
        median_change_24h_pct=_median(changes_24h),
        median_change_7d_pct=_median(changes_7d),
        sample_24h=len(changes_24h),
        sample_7d=len(changes_7d),
    )


def timestamps_aligned(
    sector_timestamp: datetime | None,
    benchmark_timestamp: datetime | None,
    *,
    same_source: bool = False,
    max_skew_seconds: float = MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS,
) -> bool:
    """Verify sector and market benchmark timestamps are consistent before subtracting."""
    if same_source:
        return True
    if sector_timestamp is None or benchmark_timestamp is None:
        return False
    skew = abs((sector_timestamp - benchmark_timestamp).total_seconds())
    return math.isfinite(skew) and skew <= max_skew_seconds


def excess_return(
    sector_return_pct: float | None,
    benchmark_return_pct: float | None,
) -> float | None:
    """Matched-horizon sector excess return (sector median - market median) in pp, or None."""
    if sector_return_pct is None or benchmark_return_pct is None:
        return None
    if not math.isfinite(sector_return_pct) or not math.isfinite(benchmark_return_pct):
        return None
    return sector_return_pct - benchmark_return_pct


@dataclass(frozen=True)
class Constituent:
    market_cap: float | None = None
    volume_24h: float | None = None
    percent_change_24h: float | None = None
    percent_change_7d: float | None = None


@dataclass(frozen=True)
class SectorAggregate:
    constituent_count: int
    median_change_24h_pct: float | None
    median_change_7d_pct: float | None
    cap_weighted_change_24h_pct: float | None
    cap_weighted_change_7d_pct: float | None
    breadth_positive_24h_pct: float | None
    total_volume_24h: float | None
    sector_volume_share_pct: float | None
    rotation_signal: str | None
    sample_sufficient: bool = True
    zero_volume_excluded: int = 0
    outlier_excluded: int = 0


def aggregate_sector(
    constituents: list[Constituent],
    *,
    market_volume_24h: float | None,
    min_constituents: int = 1,
) -> SectorAggregate:
    changes_24h = _numbers(item.percent_change_24h for item in constituents)
    changes_7d = _numbers(item.percent_change_7d for item in constituents)
    median_24h = _median(changes_24h)
    median_7d = _median(changes_7d)
    breadth = _breadth(changes_24h)
    total_volume = _sum_known(item.volume_24h for item in constituents)
    effective_count = min(len(changes_24h), len(changes_7d)) if constituents else 0
    sample_ok = len(constituents) >= min_constituents and effective_count >= min_constituents
    signal = classify_rotation_signal(
        median_24h,
        median_7d,
        breadth,
        sample_sufficient=(min_constituents <= 1 or sample_ok),
    )
    cap_24h, outlier_24h = _cap_weighted(constituents, "percent_change_24h")
    cap_7d, outlier_7d = _cap_weighted(constituents, "percent_change_7d")
    return SectorAggregate(
        constituent_count=len(constituents),
        median_change_24h_pct=median_24h,
        median_change_7d_pct=median_7d,
        cap_weighted_change_24h_pct=cap_24h,
        cap_weighted_change_7d_pct=cap_7d,
        breadth_positive_24h_pct=breadth,
        total_volume_24h=total_volume,
        sector_volume_share_pct=_share(total_volume, market_volume_24h),
        rotation_signal=signal,
        sample_sufficient=sample_ok,
        zero_volume_excluded=_count_zero_volume_excluded(constituents),
        outlier_excluded=max(outlier_24h, outlier_7d),
    )


def _has_positive_volume(volume_24h: float | None) -> bool:
    return volume_24h is not None and math.isfinite(volume_24h) and volume_24h > 0


def _count_zero_volume_excluded(constituents: list[Constituent]) -> int:
    excluded = 0
    for item in constituents:
        if (
            item.market_cap is not None
            and math.isfinite(item.market_cap)
            and item.market_cap > 0
            and not _has_positive_volume(item.volume_24h)
        ):
            excluded += 1
    return excluded


def _is_plausible_cap_weight_change(item: Constituent, field: str, change: float) -> bool:
    del field, change
    if (
        item.percent_change_24h is not None
        and abs(item.percent_change_24h) > MAX_PLAUSIBLE_24H_CHANGE_PCT
    ):
        return False
    if (
        item.percent_change_7d is not None
        and abs(item.percent_change_7d) > MAX_PLAUSIBLE_7D_CHANGE_PCT
    ):
        return False
    if (
        item.market_cap is not None
        and item.market_cap >= LARGE_CAP_VOLUME_CHECK_USD
        and (item.volume_24h is None or item.volume_24h < MIN_CAP_WEIGHT_VOLUME_USD)
    ):
        return False
    return True


def _cap_weighted(constituents: list[Constituent], field: str) -> tuple[float | None, int]:
    weighted = 0.0
    weight = 0.0
    outlier_excluded = 0
    for item in constituents:
        market_cap = item.market_cap
        change = getattr(item, field)
        if market_cap is None or change is None:
            continue
        if not math.isfinite(market_cap) or not math.isfinite(change) or market_cap <= 0:
            continue
        if not _has_positive_volume(item.volume_24h):
            continue
        if not _is_plausible_cap_weight_change(item, field, change):
            outlier_excluded += 1
            continue
        weighted += change * market_cap
        weight += market_cap
    if weight == 0:
        return None, outlier_excluded
    return weighted / weight, outlier_excluded


def _breadth(changes: list[float]) -> float | None:
    if not changes:
        return None
    positive = sum(1 for value in changes if value > 0)
    return 100.0 * positive / len(changes)


def _share(sector_volume: float | None, market_volume: float | None) -> float | None:
    if sector_volume is None or market_volume is None:
        return None
    if not math.isfinite(market_volume) or market_volume <= 0:
        return None
    return 100.0 * sector_volume / market_volume


def classify_rotation_signal(
    median_24h: float | None,
    median_7d: float | None,
    breadth: float | None,
    *,
    excess_24h: float | None = None,
    excess_7d: float | None = None,
    sample_sufficient: bool = True,
) -> str | None:
    """Classify sector rotation using matched-horizon excess returns when aligned."""
    if not sample_sufficient:
        return "INSUFFICIENT_DATA"
    if median_24h is None or median_7d is None or breadth is None:
        return None
    if excess_24h is not None and excess_7d is not None:
        if excess_24h < 0 and excess_7d < 0:
            return "LAGGING"
        if excess_7d >= 0 and excess_24h < 0:
            return "WEAKENING"
        if median_7d <= 0 and median_24h > 0:
            return "GAINING_MOMENTUM" if excess_24h > 0 else "NEUTRAL"
    elif median_7d <= 0 and median_24h > 0:
        return "NEUTRAL"
    return _rotation(median_24h, median_7d, breadth)


def _rotation(
    median_24h: float | None,
    median_7d: float | None,
    breadth: float | None,
) -> str | None:
    if median_24h is None or median_7d is None or breadth is None:
        return None
    if median_7d > 0 and median_24h > 0 and breadth >= 55:
        return "LEADING"
    if median_24h > median_7d and median_24h > 0:
        return "GAINING_MOMENTUM"
    if median_7d > 0 and median_24h < 0:
        return "WEAKENING"
    if median_7d <= 0 and median_24h <= 0:
        return "LAGGING"
    if median_7d > 0 and median_24h > 0:
        return "NEUTRAL"
    return None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return float(pd.Series(values).median())


def _numbers(values: object) -> list[float]:
    result: list[float] = []
    for value in values:
        if isinstance(value, (int, float)) and math.isfinite(value):
            result.append(float(value))
    return result


def _sum_known(values: object) -> float | None:
    numbers = _numbers(values)
    if not numbers:
        return None
    return float(sum(numbers))
