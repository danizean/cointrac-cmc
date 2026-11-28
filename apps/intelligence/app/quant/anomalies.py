import math
from collections.abc import Sequence
from typing import Literal

import numpy as np

MIN_ANOMALY_SAMPLE = 5
ANOMALY_METHODOLOGY_VERSION = "anomaly_mad_v1"
AnomalyDirection = Literal[
    "HIGH_VOLUME_TO_MCAP",
    "LOW_VOLUME_ILLIQUIDITY",
    "NOT_DIRECTIONAL",
    "INSUFFICIENT_DATA",
]


def classify_volume_anomaly_direction(
    z_score: float | None,
    modified_z_score: float | None,
) -> AnomalyDirection:
    """Classify volume-to-mcap outlier tail without making bullish/bearish claims."""
    z_ok = _finite(z_score)
    m_ok = _finite(modified_z_score)
    if not z_ok and not m_ok:
        return "INSUFFICIENT_DATA"
    signs: set[int] = set()
    if z_ok and z_score is not None and z_score != 0:
        signs.add(1 if z_score > 0 else -1)
    if m_ok and modified_z_score is not None and modified_z_score != 0:
        signs.add(1 if modified_z_score > 0 else -1)
    if len(signs) != 1:
        return "INSUFFICIENT_DATA"
    return "HIGH_VOLUME_TO_MCAP" if 1 in signs else "LOW_VOLUME_ILLIQUIDITY"


def standard_zscores(values: Sequence[float | None]) -> list[float | None]:
    clean = [value for value in values if _finite(value)]
    if len(clean) < 2:
        return [None for _ in values]
    mean = float(np.mean(clean))
    deviation = float(np.std(clean, ddof=1))
    if deviation == 0 or not math.isfinite(deviation):
        return [None for _ in values]
    return [None if not _finite(value) else (value - mean) / deviation for value in values]


def modified_zscores(values: Sequence[float | None]) -> list[float | None]:
    clean = [value for value in values if _finite(value)]
    if not clean:
        return [None for _ in values]
    center = float(np.median(clean))
    deviation = float(np.median(np.abs(np.array(clean) - center)))
    if deviation == 0 or not math.isfinite(deviation):
        return [None for _ in values]
    scores: list[float | None] = []
    for value in values:
        if not _finite(value):
            scores.append(None)
            continue
        scores.append(0.6745 * (value - center) / deviation)
    return scores


def btc_divergence(
    asset_change_24h: float | None,
    btc_change_24h: float | None,
    *,
    threshold_pct: float = 8.0,
) -> bool:
    if not _finite(asset_change_24h) or not _finite(btc_change_24h):
        return False
    if asset_change_24h == 0 or btc_change_24h == 0:
        return False
    separated = abs(asset_change_24h - btc_change_24h) >= threshold_pct
    opposite = math.copysign(1, asset_change_24h) != math.copysign(1, btc_change_24h)
    return separated and opposite


def log_volume_to_mcap(ratio: float | None) -> float | None:
    if ratio is None or not math.isfinite(ratio) or ratio <= 0:
        return None
    return math.log(ratio)


def _finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value)
