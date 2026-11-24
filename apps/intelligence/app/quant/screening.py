import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from app.quant.metrics import (
    composite_momentum_score,
    relative_strength,
    volume_to_mcap,
)

# Authoritative CoinMarketCap canonical tags for pegged stablecoins.
# Explicitly excludes protocol/governance tags like "stablecoin-protocol".
VERIFIED_STABLECOIN_TAGS: frozenset[str] = frozenset(
    {
        "stablecoin",
        "fiat-stablecoin",
        "usd-stablecoin",
        "eur-stablecoin",
        "asset-backed-stablecoin",
        "algorithmic-stablecoin",
    }
)
StablecoinClass = Literal["verified_stablecoin", "non_stablecoin", "unknown"]

# Multi-horizon crypto volatility-grounded thresholds (percentage points).
# Derived relative to the 10pp sigmoid momentum scale:
#   >= +50% in 7d (5x scale) or >= +100% in 30d (2x price) marks an extended rally;
#   <= -10% in 24h after an extended rally marks a sharp retracement;
#   deceleration of 7d below half of an extended 30d gain with <= 0% 24h marks potential exhaustion.
EXTENDED_7D_PCT = 50.0
EXTENDED_30D_PCT = 100.0
SHARP_RETRACEMENT_24H_PCT = -10.0
EXHAUSTION_7D_RATIO = 0.5
MultiHorizonRisk = Literal[
    "RECENT_MOMENTUM",
    "EXTENDED_RALLY",
    "SHARP_RETRACEMENT",
    "POTENTIAL_EXHAUSTION",
    "NEUTRAL",
    "INSUFFICIENT_HISTORY",
]


def classify_stablecoin(tags: Sequence[str] | None) -> StablecoinClass:
    """Classify an asset strictly via canonical CMC tags (never ticker substring)."""
    if not isinstance(tags, (list, tuple, set, frozenset)) or len(tags) == 0:
        return "unknown"
    normalized = {str(tag).strip().lower() for tag in tags if str(tag).strip()}
    if not normalized:
        return "unknown"
    if normalized & VERIFIED_STABLECOIN_TAGS:
        return "verified_stablecoin"
    return "non_stablecoin"


def assess_multi_horizon_risk(
    *,
    change_24h: float | None,
    change_7d: float | None,
    change_30d: float | None,
) -> MultiHorizonRisk:
    """Assess descriptive multi-horizon chase/retracement risk without claiming reversal."""
    if (
        change_7d is None
        or change_30d is None
        or not math.isfinite(change_7d)
        or not math.isfinite(change_30d)
    ):
        return "INSUFFICIENT_HISTORY"
    extended = change_7d >= EXTENDED_7D_PCT or change_30d >= EXTENDED_30D_PCT
    has_24h = change_24h is not None and math.isfinite(change_24h)
    if extended:
        if has_24h and change_24h is not None:
            if change_24h <= SHARP_RETRACEMENT_24H_PCT:
                return "SHARP_RETRACEMENT"
            if (
                change_30d >= EXTENDED_30D_PCT
                and change_7d < change_30d * EXHAUSTION_7D_RATIO
                and change_24h <= 0.0
            ):
                return "POTENTIAL_EXHAUSTION"
        return "EXTENDED_RALLY"
    if has_24h and change_24h is not None and change_24h > 0.0 and change_7d >= 0.0:
        return "RECENT_MOMENTUM"
    return "NEUTRAL"


@dataclass(frozen=True)
class UniverseAsset:
    symbol: str
    cmc_id: int | None = None
    name: str | None = None
    market_cap: float | None = None
    volume_24h: float | None = None
    percent_change_24h: float | None = None
    percent_change_7d: float | None = None
    percent_change_30d: float | None = None
    percent_change_60d: float | None = None


@dataclass(frozen=True)
class ScreenedAsset:
    symbol: str
    cmc_id: int | None
    name: str | None
    market_cap: float | None
    volume_24h: float | None
    volume_to_mcap: float | None
    percent_change_24h: float | None
    percent_change_7d: float | None
    percent_change_30d: float | None
    percent_change_60d: float | None
    rs_vs_btc_7d: float | None
    composite_momentum_score: float | None
    timeframes_available: int
    multi_horizon_risk: MultiHorizonRisk = "INSUFFICIENT_HISTORY"


def screen_movers(
    assets: list[UniverseAsset],
    *,
    btc_percent_change_7d: float | None,
    min_market_cap_usd: float | None = None,
    min_volume_24h_usd: float | None = None,
    min_vol_to_mcap: float | None = None,
    min_rs_vs_btc_7d: float | None = None,
    max_24h_gain_pct: float | None = None,
    max_7d_gain_pct: float | None = None,
    rank_by: str = "composite_momentum_score",
    limit: int = 20,
) -> list[ScreenedAsset]:
    ranked: list[ScreenedAsset] = []
    for asset in assets:
        score, timeframes = composite_momentum_score(
            {
                "24h": asset.percent_change_24h,
                "7d": asset.percent_change_7d,
                "30d": asset.percent_change_30d,
                "60d": asset.percent_change_60d,
            }
        )
        ratio = volume_to_mcap(asset.volume_24h, asset.market_cap)
        strength = relative_strength(asset.percent_change_7d, btc_percent_change_7d)
        if not _passes(
            asset,
            ratio,
            strength,
            min_market_cap_usd=min_market_cap_usd,
            min_volume_24h_usd=min_volume_24h_usd,
            min_vol_to_mcap=min_vol_to_mcap,
            min_rs_vs_btc_7d=min_rs_vs_btc_7d,
            max_24h_gain_pct=max_24h_gain_pct,
            max_7d_gain_pct=max_7d_gain_pct,
        ):
            continue
        risk = assess_multi_horizon_risk(
            change_24h=asset.percent_change_24h,
            change_7d=asset.percent_change_7d,
            change_30d=asset.percent_change_30d,
        )
        ranked.append(
            ScreenedAsset(
                symbol=asset.symbol,
                cmc_id=asset.cmc_id,
                name=asset.name,
                market_cap=asset.market_cap,
                volume_24h=asset.volume_24h,
                volume_to_mcap=ratio,
                percent_change_24h=asset.percent_change_24h,
                percent_change_7d=asset.percent_change_7d,
                percent_change_30d=asset.percent_change_30d,
                percent_change_60d=asset.percent_change_60d,
                rs_vs_btc_7d=strength,
                composite_momentum_score=score,
                timeframes_available=timeframes,
                multi_horizon_risk=risk,
            )
        )
    ranked.sort(key=lambda row: _sort_key(row, rank_by))
    return ranked[:limit]


def _passes(
    asset: UniverseAsset,
    ratio: float | None,
    strength: float | None,
    *,
    min_market_cap_usd: float | None,
    min_volume_24h_usd: float | None,
    min_vol_to_mcap: float | None,
    min_rs_vs_btc_7d: float | None,
    max_24h_gain_pct: float | None,
    max_7d_gain_pct: float | None = None,
) -> bool:
    if min_market_cap_usd is not None and (
        asset.market_cap is None or asset.market_cap < min_market_cap_usd
    ):
        return False
    if min_volume_24h_usd is not None and (
        asset.volume_24h is None or asset.volume_24h < min_volume_24h_usd
    ):
        return False
    if min_vol_to_mcap is not None and (ratio is None or ratio < min_vol_to_mcap):
        return False
    if min_rs_vs_btc_7d is not None and (strength is None or strength < min_rs_vs_btc_7d):
        return False
    if max_24h_gain_pct is not None and (
        asset.percent_change_24h is None or asset.percent_change_24h > max_24h_gain_pct
    ):
        return False
    if max_7d_gain_pct is not None and (
        asset.percent_change_7d is None or asset.percent_change_7d > max_7d_gain_pct
    ):
        return False
    return True


def _sort_key(row: ScreenedAsset, rank_by: str) -> tuple[bool, float, str]:
    value = getattr(row, rank_by)
    if value is None:
        return (True, 0.0, row.symbol)
    return (False, -float(value), row.symbol)
