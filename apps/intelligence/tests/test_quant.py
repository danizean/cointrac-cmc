import math
from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from app.quant.anomalies import btc_divergence, modified_zscores, standard_zscores
from app.quant.metrics import (
    annualized_volatility,
    beta,
    circulating_supply_pct,
    cross_sectional_momentum_scores,
    fdv_to_mcap_ratio,
    log_returns,
    maximum_drawdown,
    pearson_correlation,
    sigmoid_momentum_score,
    simple_returns,
    utc_daily_close,
    volume_to_mcap,
)
from app.quant.regime import classify_regime
from app.quant.screening import UniverseAsset, screen_movers
from app.quant.sectors import Constituent, aggregate_sector


def _day(offset: int) -> datetime:
    return datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=offset)


def test_simple_and_log_returns_match_known_prices() -> None:
    prices = utc_daily_close([(_day(0), 100.0), (_day(1), 110.0), (_day(2), 121.0)])
    simple = simple_returns(prices)
    logged = log_returns(prices)
    assert list(simple.round(10)) == [0.1, 0.1]
    assert logged.iloc[0] == math.log(1.1)
    assert logged.iloc[1] == math.log(1.1)


def test_missing_day_does_not_create_a_return() -> None:
    prices = utc_daily_close([(_day(0), 100.0), (_day(2), 110.0)])
    assert simple_returns(prices).empty
    assert log_returns(prices).empty


def test_annualized_volatility_uses_365_and_sample_variance() -> None:
    returns = pd.Series([0.01, 0.02, -0.01, 0.0, 0.03])
    expected = math.sqrt(0.00025) * math.sqrt(365)
    assert annualized_volatility(returns) == expected


def test_volatility_is_none_below_five_observations() -> None:
    assert annualized_volatility(pd.Series([0.01, 0.02, -0.01, 0.0])) is None


def test_maximum_drawdown_on_a_known_path() -> None:
    prices = pd.Series([100.0, 120.0, 90.0, 110.0])
    assert maximum_drawdown(prices) == -0.25


def test_flat_prices_have_zero_drawdown_and_invalid_prices_stay_none() -> None:
    assert maximum_drawdown(pd.Series([10.0, 10.0, 10.0])) == 0.0
    assert maximum_drawdown(pd.Series([10.0, 0.0, 12.0])) is None
    assert maximum_drawdown(pd.Series(dtype="float64")) is None


def test_beta_is_two_when_asset_moves_twice_the_benchmark() -> None:
    asset = pd.Series([0.02, 0.04, 0.06, 0.08, 0.10])
    benchmark = pd.Series([0.01, 0.02, 0.03, 0.04, 0.05])
    assert beta(asset, benchmark) == pytest.approx(2.0)
    assert pearson_correlation(asset, benchmark) == pytest.approx(1.0)


def test_beta_and_correlation_are_none_for_zero_variance_or_short_samples() -> None:
    flat = pd.Series([0.01, 0.01, 0.01, 0.01, 0.01])
    moving = pd.Series([0.02, 0.01, 0.0, -0.01, 0.03])
    assert beta(moving, flat) is None
    assert pearson_correlation(moving, flat) is None
    short_asset = pd.Series([0.01, 0.02, 0.03, 0.04])
    short_benchmark = pd.Series([0.01, 0.02, 0.03, 0.04])
    assert beta(short_asset, short_benchmark) is None
    assert pearson_correlation(short_asset, short_benchmark) is None


def test_ratio_helpers_keep_missing_and_zero_market_cap_as_none() -> None:
    assert volume_to_mcap(50.0, 200.0) == 0.25
    assert volume_to_mcap(50.0, 0.0) is None
    assert volume_to_mcap(50.0, None) is None
    assert fdv_to_mcap_ratio(300.0, 100.0) == 3.0
    assert fdv_to_mcap_ratio(300.0, 0.0) is None
    assert circulating_supply_pct(25.0, 100.0) == 25.0
    assert circulating_supply_pct(25.0, 0.0) is None
    assert circulating_supply_pct(None, 100.0) is None


def test_sigmoid_momentum_is_neutral_for_flat_changes() -> None:
    flat = {"24h": 0.0, "7d": 0.0, "30d": 0.0, "60d": 0.0}
    assert sigmoid_momentum_score(flat) == 50.0
    assert sigmoid_momentum_score({"24h": None, "7d": None, "30d": None, "60d": None}) is None
    partial = {"24h": 0.0, "7d": 0.0, "30d": 0.0, "60d": None}
    assert sigmoid_momentum_score(partial) == 50.0


def test_cross_sectional_score_ranks_the_stronger_asset_higher() -> None:
    scores = cross_sectional_momentum_scores(
        [
            {"24h": 10.0, "7d": 10.0, "30d": 10.0, "60d": 10.0},
            {"24h": 0.0, "7d": 0.0, "30d": 0.0, "60d": 0.0},
        ]
    )
    assert scores == [100.0, 50.0]


def test_screener_rejects_small_caps_and_parabolic_pumps() -> None:
    strong = UniverseAsset(
        "AAA",
        market_cap=1_000_000_000,
        volume_24h=100_000_000,
        percent_change_24h=5,
        percent_change_7d=10,
        percent_change_30d=8,
        percent_change_60d=4,
    )
    small = UniverseAsset(
        "BBB",
        market_cap=1_000_000,
        volume_24h=100_000_000,
        percent_change_24h=5,
        percent_change_7d=12,
        percent_change_30d=8,
        percent_change_60d=4,
    )
    parabolic = UniverseAsset(
        "CCC",
        market_cap=2_000_000_000,
        volume_24h=100_000_000,
        percent_change_24h=50,
        percent_change_7d=20,
        percent_change_30d=8,
        percent_change_60d=4,
    )
    missing_cap = UniverseAsset(
        "DDD",
        market_cap=None,
        volume_24h=100_000_000,
        percent_change_24h=4,
        percent_change_7d=9,
        percent_change_30d=8,
        percent_change_60d=4,
    )
    rows = screen_movers(
        [parabolic, small, strong, missing_cap],
        btc_percent_change_7d=2,
        min_market_cap_usd=100_000_000,
        max_24h_gain_pct=20,
        rank_by="rs_vs_btc_7d",
    )
    assert [row.symbol for row in rows] == ["AAA"]
    assert rows[0].rs_vs_btc_7d == 8
    assert rows[0].volume_to_mcap == 0.1


def test_screener_breaks_ties_by_symbol() -> None:
    first = UniverseAsset(
        "ZZZ",
        market_cap=10,
        volume_24h=2,
        percent_change_24h=1,
        percent_change_7d=1,
        percent_change_30d=1,
        percent_change_60d=1,
    )
    second = UniverseAsset(
        "AAA",
        market_cap=10,
        volume_24h=2,
        percent_change_24h=1,
        percent_change_7d=1,
        percent_change_30d=1,
        percent_change_60d=1,
    )
    rows = screen_movers([first, second], btc_percent_change_7d=0, rank_by="volume_to_mcap")
    assert [row.symbol for row in rows] == ["AAA", "ZZZ"]


def test_modified_zscore_matches_median_absolute_deviation() -> None:
    values = [1.0, 2.0, 3.0, 4.0, 100.0]
    z_scores = standard_zscores(values)
    robust = modified_zscores(values)
    assert z_scores[4] is not None and z_scores[4] > 1
    assert robust[4] == 0.6745 * 97
    assert modified_zscores([5.0, 5.0, 5.0, 5.0]) == [None, None, None, None]
    assert standard_zscores([None, None]) == [None, None]


def test_btc_divergence_requires_opposite_sign_and_eight_points() -> None:
    assert btc_divergence(10.0, -2.0) is True
    assert btc_divergence(10.0, 1.0) is False
    assert btc_divergence(3.0, -3.0) is False
    assert btc_divergence(None, -10.0) is False
    assert btc_divergence(0.0, -10.0) is False


def test_regime_rules_cover_each_label_and_missing_inputs() -> None:
    risk_on = classify_regime(
        total_mcap_change_24h_pct=1.5,
        btc_dominance_change_24h=-0.4,
        top50_breadth_positive_pct=70,
        fear_greed_value=60,
        btc_outperforming_median_alt=False,
    )
    btc_led = classify_regime(
        total_mcap_change_24h_pct=1.2,
        btc_dominance_change_24h=0.3,
        top50_breadth_positive_pct=45,
        fear_greed_value=50,
        btc_outperforming_median_alt=True,
    )
    stress = classify_regime(
        total_mcap_change_24h_pct=-3,
        btc_dominance_change_24h=0.1,
        top50_breadth_positive_pct=40,
        fear_greed_value=50,
        btc_outperforming_median_alt=False,
    )
    mixed = classify_regime(
        total_mcap_change_24h_pct=0.2,
        btc_dominance_change_24h=0.0,
        top50_breadth_positive_pct=50,
        fear_greed_value=45,
        btc_outperforming_median_alt=False,
    )
    empty = classify_regime(
        total_mcap_change_24h_pct=None,
        btc_dominance_change_24h=None,
        top50_breadth_positive_pct=None,
        fear_greed_value=None,
        btc_outperforming_median_alt=None,
    )
    assert risk_on.regime == "RISK_ON_ALTSEASON"
    assert btc_led.regime == "BTC_LED_EXPANSION"
    assert stress.regime == "RISK_OFF_STRESS"
    assert mixed.regime == "RANGE_CONSOLIDATION"
    assert empty.regime is None
    assert risk_on.rationale
    assert stress.rationale


def test_sector_aggregate_uses_median_and_cap_weights() -> None:
    stats = aggregate_sector(
        [
            Constituent(100, 10, 10, 5),
            Constituent(300, 30, -10, 1),
            Constituent(None, None, None, None),
        ],
        market_volume_24h=200,
    )
    assert stats.constituent_count == 3
    assert stats.median_change_24h_pct == 0
    assert stats.median_change_7d_pct == 3
    assert stats.cap_weighted_change_24h_pct == -5
    assert stats.cap_weighted_change_7d_pct == 2
    assert stats.breadth_positive_24h_pct == 50
    assert stats.total_volume_24h == 40
    assert stats.sector_volume_share_pct == 20
    assert stats.rotation_signal is None
    assert stats.zero_volume_excluded == 0


def test_sector_cap_weighted_excludes_zero_volume_untraded_outliers() -> None:
    stats = aggregate_sector(
        [
            Constituent(100_000_000, 5_000_000, 2.0, 4.0),
            Constituent(100_000_000, 3_000_000, 4.0, 6.0),
            Constituent(60_000_000, 0.0, 104_410.1, 104_410.1),
            Constituent(50_000_000, None, 39_244.8, 39_244.8),
        ],
        market_volume_24h=100_000_000,
    )
    assert stats.zero_volume_excluded == 2
    assert stats.cap_weighted_change_24h_pct == 3.0
    assert stats.cap_weighted_change_7d_pct == 5.0


def test_sector_rotation_signals_and_zero_market_volume() -> None:
    leading = aggregate_sector(
        [Constituent(10, 1, 4, 3), Constituent(10, 1, 6, 2)],
        market_volume_24h=0,
    )
    gaining = aggregate_sector(
        [Constituent(10, 1, 8, 1), Constituent(10, 1, -2, 1)],
        market_volume_24h=None,
    )
    weakening = aggregate_sector(
        [Constituent(10, 1, -2, 4), Constituent(10, 1, -1, 3)],
        market_volume_24h=10,
    )
    lagging = aggregate_sector(
        [Constituent(10, 1, -3, -1), Constituent(10, 1, -4, -2)],
        market_volume_24h=10,
    )
    empty = aggregate_sector([], market_volume_24h=10)
    assert leading.rotation_signal == "LEADING"
    assert leading.sector_volume_share_pct is None
    assert gaining.rotation_signal == "GAINING_MOMENTUM"
    assert gaining.breadth_positive_24h_pct == 50
    assert weakening.rotation_signal == "WEAKENING"
    assert lagging.rotation_signal == "LAGGING"
    assert empty.total_volume_24h is None
    assert empty.median_change_24h_pct is None


def test_composite_momentum_score_is_deterministic_and_tracks_timeframes() -> None:
    from app.quant.metrics import composite_momentum_score

    full_score, full_count = composite_momentum_score(
        {"24h": 6.0, "7d": 20.0, "30d": 5.0, "60d": 3.0}
    )
    assert full_count == 4
    assert full_score == pytest.approx(
        sigmoid_momentum_score({"24h": 6.0, "7d": 20.0, "30d": 5.0, "60d": 3.0})
    )
    partial_score, partial_count = composite_momentum_score(
        {"24h": 0.0, "7d": 0.0, "30d": None, "60d": None}
    )
    assert partial_count == 2
    assert partial_score == pytest.approx(50.0)
    empty_score, empty_count = composite_momentum_score(
        {"24h": None, "7d": None, "30d": None, "60d": None}
    )
    assert empty_score is None
    assert empty_count == 0


def test_sector_aggregate_enforces_sample_size_guard_and_neutral_branch() -> None:
    from app.quant.sectors import MIN_SECTOR_CONSTITUENTS

    thin = aggregate_sector(
        [Constituent(100, 10, 5, 10), Constituent(100, 10, 6, 12)],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert thin.constituent_count == 2
    assert thin.sample_sufficient is False
    assert thin.rotation_signal == "INSUFFICIENT_DATA"

    sufficient = aggregate_sector(
        [Constituent(100, 10, 5, 10) for _ in range(MIN_SECTOR_CONSTITUENTS)],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert sufficient.sample_sufficient is True
    assert sufficient.rotation_signal == "LEADING"

    # Positive 7d and 24h, breadth < 55%, 24h <= 7d -> explicit NEUTRAL (not silent None)
    neutral = aggregate_sector(
        [
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, 1, 10),
        ],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert neutral.breadth_positive_24h_pct == 60.0
    neutral_low_breadth = aggregate_sector(
        [
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 0, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, 1, 10),
        ],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert neutral_low_breadth.median_change_24h_pct == 1.0
    assert neutral_low_breadth.median_change_7d_pct == 10.0
    assert neutral_low_breadth.breadth_positive_24h_pct == 60.0
    neutral_exact = aggregate_sector(
        [
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -2, 10),
            Constituent(100, 10, -2, 10),
            Constituent(100, 10, 3, 10),
            Constituent(100, 10, -1, 10),
        ],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    # 4 positive / 8 = 50% breadth (< 55%), median_24h = 0.0 (needs > 0 for NEUTRAL)
    assert neutral_exact.breadth_positive_24h_pct == 50.0
    neutral_positive = aggregate_sector(
        [
            Constituent(100, 10, 5, 10),
            Constituent(100, 10, 4, 10),
            Constituent(100, 10, 3, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
        ],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert neutral_positive.breadth_positive_24h_pct == 50.0
    # Shift one -1 to -0.5 so median is strictly > 0 with 50% breadth (< 55%)
    neutral_strict = aggregate_sector(
        [
            Constituent(100, 10, 5, 10),
            Constituent(100, 10, 4, 10),
            Constituent(100, 10, 3, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, 2, 10),
            Constituent(100, 10, -0.5, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
            Constituent(100, 10, -1, 10),
        ],
        market_volume_24h=100,
        min_constituents=MIN_SECTOR_CONSTITUENTS,
    )
    assert neutral_strict.breadth_positive_24h_pct == 50.0
    assert neutral_strict.median_change_24h_pct == 0.75
    assert neutral_strict.rotation_signal == "NEUTRAL"


def test_regime_conflict_handling_and_confidence_degradation() -> None:
    # Exact audit snapshot: +3.63% MCap, 94.0% breadth, +0.41pp BTC dom, F&G 9
    conflict_rally = classify_regime(
        total_mcap_change_24h_pct=3.63,
        btc_dominance_change_24h=0.41,
        top50_breadth_positive_pct=94.0,
        fear_greed_value=9.0,
        btc_outperforming_median_alt=True,
        breadth_sample_size=50,
    )
    assert conflict_rally.regime == "RANGE_CONSOLIDATION"
    assert conflict_rally.signal_conflict is True
    assert conflict_rally.confidence == "LOW"
    assert conflict_rally.dominant_signals
    assert conflict_rally.conflicting_signals

    # Structural stress cannot be erased by high Fear & Greed
    structural_vs_greed = classify_regime(
        total_mcap_change_24h_pct=-3.5,
        btc_dominance_change_24h=0.5,
        top50_breadth_positive_pct=20.0,
        fear_greed_value=75.0,
        btc_outperforming_median_alt=True,
        breadth_sample_size=50,
    )
    assert structural_vs_greed.regime == "RISK_OFF_STRESS"
    assert structural_vs_greed.signal_conflict is True
    assert structural_vs_greed.confidence == "LOW"

    # Stale inputs and thin breadth sample degrade confidence to LOW
    stale = classify_regime(
        total_mcap_change_24h_pct=2.0,
        btc_dominance_change_24h=-0.5,
        top50_breadth_positive_pct=80.0,
        fear_greed_value=65.0,
        btc_outperforming_median_alt=False,
        breadth_sample_size=50,
        stale_inputs=True,
    )
    assert stale.regime == "RISK_ON_ALTSEASON"
    assert stale.confidence == "LOW"
    assert any("stale" in line.lower() for line in stale.rationale)

    thin_breadth = classify_regime(
        total_mcap_change_24h_pct=2.0,
        btc_dominance_change_24h=-0.5,
        top50_breadth_positive_pct=80.0,
        fear_greed_value=65.0,
        btc_outperforming_median_alt=False,
        breadth_sample_size=4,
    )
    assert thin_breadth.confidence == "LOW"
    assert any("below minimum" in line.lower() for line in thin_breadth.rationale)


def test_stablecoin_classifier_uses_canonical_tags_only_and_preserves_unknown() -> None:
    from app.quant.screening import classify_stablecoin

    # Verified stablecoins (including real Stage 4 offenders U, USD1, USDe, RLUSD, PYUSD)
    assert classify_stablecoin(["stablecoin", "asset-backed-stablecoin"]) == "verified_stablecoin"
    assert classify_stablecoin(["usd-stablecoin", "fiat-stablecoin"]) == "verified_stablecoin"
    assert classify_stablecoin(["eur-stablecoin"]) == "verified_stablecoin"
    assert classify_stablecoin(["algorithmic-stablecoin"]) == "verified_stablecoin"

    # Protocol/governance tokens with "stablecoin-protocol" are NOT verified stablecoins
    assert classify_stablecoin(["stablecoin-protocol"]) == "non_stablecoin"
    assert classify_stablecoin(["layer-1", "defi"]) == "non_stablecoin"

    # Missing/empty tags stay "unknown" (never silently discarded)
    assert classify_stablecoin([]) == "unknown"
    assert classify_stablecoin(None) == "unknown"


def test_multi_horizon_anti_chase_covers_all_required_scenarios() -> None:
    from app.quant.screening import assess_multi_horizon_risk

    # 1. Strong 24h gain with moderate 7d/30d returns -> RECENT_MOMENTUM
    assert (
        assess_multi_horizon_risk(change_24h=11.5, change_7d=14.2, change_30d=31.8)
        == "RECENT_MOMENTUM"
    )
    # 2. Moderate 24h gain after extreme 30d appreciation -> EXTENDED_RALLY
    assert (
        assess_multi_horizon_risk(change_24h=4.0, change_7d=18.0, change_30d=145.0)
        == "EXTENDED_RALLY"
    )
    # 3. Extreme 24h decline after extended rally (PIEVERSE profile) -> SHARP_RETRACEMENT
    assert (
        assess_multi_horizon_risk(change_24h=-14.33, change_7d=90.51, change_30d=243.71)
        == "SHARP_RETRACEMENT"
    )
    # 3b. Decelerating 7d after extreme 30d gain with <=0% 24h -> POTENTIAL_EXHAUSTION
    assert (
        assess_multi_horizon_risk(change_24h=-2.0, change_7d=20.0, change_30d=150.0)
        == "POTENTIAL_EXHAUSTION"
    )
    # 4. Missing 7d data -> INSUFFICIENT_HISTORY (never treated as 0)
    assert (
        assess_multi_horizon_risk(change_24h=8.0, change_7d=None, change_30d=25.0)
        == "INSUFFICIENT_HISTORY"
    )
    # 5. Missing 30d data -> INSUFFICIENT_HISTORY (never treated as 0)
    assert (
        assess_multi_horizon_risk(change_24h=8.0, change_7d=12.0, change_30d=None)
        == "INSUFFICIENT_HISTORY"
    )
    # 6. Normal non-parabolic asset (mild drawdown) -> NEUTRAL
    assert assess_multi_horizon_risk(change_24h=-1.5, change_7d=-3.0, change_30d=-10.0) == "NEUTRAL"


def test_volume_anomaly_direction_separates_positive_negative_and_unclear_tails() -> None:
    from app.quant.anomalies import classify_volume_anomaly_direction

    assert classify_volume_anomaly_direction(2.87, 3.60) == "HIGH_VOLUME_TO_MCAP"
    assert classify_volume_anomaly_direction(-4.89, -6.45) == "LOW_VOLUME_ILLIQUIDITY"
    assert classify_volume_anomaly_direction(None, -3.51) == "LOW_VOLUME_ILLIQUIDITY"
    assert classify_volume_anomaly_direction(3.2, -3.6) == "INSUFFICIENT_DATA"
    assert classify_volume_anomaly_direction(None, None) == "INSUFFICIENT_DATA"


def test_screen_movers_max_7d_gain_pct_and_structured_multi_horizon_risk() -> None:
    recent = UniverseAsset(
        "NIGHT",
        market_cap=500_000_000,
        volume_24h=80_000_000,
        percent_change_24h=11.53,
        percent_change_7d=14.20,
        percent_change_30d=31.81,
        percent_change_60d=22.0,
    )
    pieverse = UniverseAsset(
        "PIEVERSE",
        market_cap=1_075_000_000,
        volume_24h=572_000_000,
        percent_change_24h=-14.33,
        percent_change_7d=90.51,
        percent_change_30d=243.71,
        percent_change_60d=180.0,
    )
    extended = UniverseAsset(
        "RUNNR",
        market_cap=600_000_000,
        volume_24h=90_000_000,
        percent_change_24h=6.5,
        percent_change_7d=62.0,
        percent_change_30d=145.0,
        percent_change_60d=90.0,
    )
    no_7d = UniverseAsset(
        "NO7D",
        market_cap=400_000_000,
        volume_24h=60_000_000,
        percent_change_24h=8.0,
        percent_change_7d=None,
        percent_change_30d=25.0,
        percent_change_60d=None,
    )
    no_30d = UniverseAsset(
        "NO30D",
        market_cap=400_000_000,
        volume_24h=60_000_000,
        percent_change_24h=8.0,
        percent_change_7d=12.0,
        percent_change_30d=None,
        percent_change_60d=None,
    )

    # Without max_7d_gain_pct, all pass max_24h_gain_pct=18 and carry structured risk labels
    unfiltered = screen_movers(
        [recent, pieverse, extended, no_7d, no_30d],
        btc_percent_change_7d=1.0,
        max_24h_gain_pct=18.0,
        limit=10,
    )
    by_sym = {row.symbol: row for row in unfiltered}
    assert by_sym["NIGHT"].multi_horizon_risk == "RECENT_MOMENTUM"
    assert by_sym["PIEVERSE"].multi_horizon_risk == "SHARP_RETRACEMENT"
    assert by_sym["RUNNR"].multi_horizon_risk == "EXTENDED_RALLY"
    assert by_sym["NO7D"].multi_horizon_risk == "INSUFFICIENT_HISTORY"
    assert by_sym["NO30D"].multi_horizon_risk == "INSUFFICIENT_HISTORY"

    # With max_7d_gain_pct=40, PIEVERSE (+90.5%), RUNNR (+62%), and NO7D (None) are excluded
    filtered = screen_movers(
        [recent, pieverse, extended, no_7d, no_30d],
        btc_percent_change_7d=1.0,
        max_24h_gain_pct=18.0,
        max_7d_gain_pct=40.0,
        limit=10,
    )
    assert {row.symbol for row in filtered} == {"NIGHT", "NO30D"}
    # Ranking scores remain identical to unfiltered default ranking formula
    for row in filtered:
        assert row.composite_momentum_score == pytest.approx(
            by_sym[row.symbol].composite_momentum_score
        )


def test_sector_benchmark_excess_return_and_timestamp_alignment() -> None:
    from app.quant.sectors import (
        MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS,
        excess_return,
        market_median_benchmark,
        timestamps_aligned,
    )

    benchmark = market_median_benchmark(
        [
            Constituent(100, 10, 2.0, -5.0),
            Constituent(100, 10, 4.0, -1.0),
            Constituent(100, 10, 6.0, None),
        ]
    )
    assert benchmark.median_change_24h_pct == pytest.approx(4.0)
    assert benchmark.median_change_7d_pct == pytest.approx(-3.0)
    assert benchmark.sample_24h == 3
    assert benchmark.sample_7d == 2

    # Matched horizons
    assert excess_return(5.5, benchmark.median_change_24h_pct) == pytest.approx(1.5)
    assert excess_return(-1.0, benchmark.median_change_7d_pct) == pytest.approx(2.0)

    # Null propagation (never 0)
    assert excess_return(None, 2.0) is None
    assert excess_return(2.0, None) is None
    assert excess_return(float("nan"), 2.0) is None

    # Timestamp alignment rules
    t0 = _day(0)
    t_ok = t0 + timedelta(seconds=MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS)
    t_skew = t0 + timedelta(seconds=MAX_BENCHMARK_TIMESTAMP_SKEW_SECONDS + 1)
    assert timestamps_aligned(None, None, same_source=True) is True
    assert timestamps_aligned(t0, t_ok, same_source=False) is True
    assert timestamps_aligned(t0, t_skew, same_source=False) is False
    assert timestamps_aligned(None, t0, same_source=False) is False
    assert timestamps_aligned(t0, None, same_source=False) is False


def test_sector_outlier_guard_and_excess_rotation_classification() -> None:
    from app.quant.sectors import classify_rotation_signal

    # Extreme 24h spike and illiquid large-cap constituent are excluded from cap_weighted
    stats = aggregate_sector(
        [
            Constituent(1_000_000_000, 50_000_000, 3.0, -4.0),
            Constituent(1_000_000_000, 50_000_000, 3.0, -4.0),
            Constituent(5_000_000_000, 100.0, 1299.95, 800.0),
            Constituent(500_000_000, 200_000.0, 104410.0, 500.0),
        ],
        market_volume_24h=1_000_000_000,
    )
    assert stats.outlier_excluded == 2
    assert stats.cap_weighted_change_24h_pct == pytest.approx(3.0)
    assert stats.cap_weighted_change_7d_pct == pytest.approx(-4.0)

    # 24h rebound with negative 7d must NOT report GAINING_MOMENTUM when lagging market
    assert (
        classify_rotation_signal(
            3.05, -5.66, 85.0, excess_24h=-0.58, excess_7d=-0.39, sample_sufficient=True
        )
        == "LAGGING"
    )
    assert (
        classify_rotation_signal(
            4.96, -4.89, 88.0, excess_24h=1.34, excess_7d=0.38, sample_sufficient=True
        )
        == "GAINING_MOMENTUM"
    )
    assert classify_rotation_signal(3.05, -5.66, 85.0, sample_sufficient=True) == "NEUTRAL"
