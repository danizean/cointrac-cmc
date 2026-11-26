from datetime import UTC, datetime, timedelta

import pytest

from app.quant.hidden_gems import (
    FilterPreset,
    HistoricalIndicators,
    OhlcvBar,
    SnapshotInput,
    aggregate_1h_to_4h,
    build_benchmark_distribution,
    build_deterministic_explanation,
    compute_historical_indicators,
    derive_return_4h,
    geometric_rs,
    score_candidate,
    score_sweet_spot_turnover,
)

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)


def _snap(
    cid: str,
    sym: str,
    *,
    mcap: float = 120_000_000.0,
    vol: float = 18_000_000.0,
    r24: float = 6.0,
    r7: float = 12.0,
    r30: float = 20.0,
    rs_btc_7d: float = 8.0,
    rs_btc_30d: float = 15.0,
    rs_eth_7d: float = 5.0,
    tags: tuple[str, ...] = ("defi",),
    age_days: int = 90,
    critical_anomaly: bool = False,
) -> SnapshotInput:
    return SnapshotInput(
        canonical_provider_id=cid,
        symbol=sym,
        name=f"{sym} Protocol",
        identity_status="VERIFIED",
        tags=tags,
        source_timestamp=NOW - timedelta(minutes=5),
        price=10.0,
        market_cap=mcap,
        volume_24h=vol,
        return_1h=0.5,
        return_24h=r24,
        return_7d=r7,
        return_30d=r30,
        rs_btc_7d=rs_btc_7d,
        rs_btc_30d=rs_btc_30d,
        rs_eth_7d=rs_eth_7d,
        date_added=NOW - timedelta(days=age_days),
        critical_anomaly_flag=critical_anomaly,
    )


def _daily_series(days: int = 60, *, ohlcv: bool = False) -> list[OhlcvBar]:
    bars: list[OhlcvBar] = []
    for i in range(days):
        close = 5.0 + (i * 0.08)
        bars.append(
            OhlcvBar(
                timestamp=NOW - timedelta(days=days - i),
                close=close,
                open=close * 0.99 if ohlcv else None,
                high=close * 1.02 if ohlcv else None,
                low=close * 0.98 if ohlcv else None,
                volume=10_000_000.0,
            )
        )
    return bars


def _benchmark() -> object:
    universe = [
        _snap(str(100 + i), f"BM{i}", r24=float(i - 3), r7=float(i * 2 - 5), rs_btc_7d=float(i))
        for i in range(10)
    ]
    return build_benchmark_distribution(universe)


def test_deterministic_scoring_and_missing_data_renormalization() -> None:
    bm = _benchmark()
    asset = _snap("2001", "GEM")
    hist = compute_historical_indicators(_daily_series(60, ohlcv=False))

    first = score_candidate(
        asset,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="RANGE_CONSOLIDATION",
        historical=hist,
    )
    second = score_candidate(
        asset,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="RANGE_CONSOLIDATION",
        historical=hist,
    )
    assert first == second
    assert first.eligibility_status == "ELIGIBLE"
    assert first.liquidity_mode == "PROXY"
    assert first.liquidity_confidence <= 75.0

    # Missing historical series -> UNKNOWN components excluded, coverage < 0.60 -> INSUFFICIENT_DATA
    no_hist = HistoricalIndicators(
        daily_bar_count=0,
        bars_4h_count=0,
        has_ohlcv_candles=False,
        has_4h_candles=False,
    )
    partial = score_candidate(
        asset,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="UNKNOWN",
        historical=no_hist,
    )
    assert partial.valid_weight_coverage < 0.60
    assert partial.classification == "INSUFFICIENT_DATA"
    assert partial.eligibility_status == "INSUFFICIENT_DATA"
    assert partial.confidence_level == "INSUFFICIENT"
    assert "volume_activity" in partial.missing_components
    assert partial.components["volume_activity"].score is None


def test_hard_rejection_overrides_high_score_and_sweet_spot_turnover() -> None:
    bm = _benchmark()
    hist = compute_historical_indicators(_daily_series(60, ohlcv=True))
    flagged = _snap("3001", "TRAP", critical_anomaly=True)
    res = score_candidate(
        flagged,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SHORT_TERM",
        profile="STARTUP_CAPABILITY_PROFILE",
        regime="RISK_ON_ALTSEASON",
        historical=hist,
    )
    assert res.eligibility_status == "REJECTED"
    assert res.classification == "LOW_PRIORITY"
    assert any(r.code == "CRITICAL_ANOMALY" for r in res.rejection_reasons)

    # Sweet-spot turnover: 0.20 outscores wash-trading outlier 1.50
    sweet, sweet_pen = score_sweet_spot_turnover(0.20)
    wash, wash_pen = score_sweet_spot_turnover(1.50)
    assert sweet is not None and wash is not None
    assert sweet > wash
    assert sweet_pen is None
    assert wash_pen is not None and wash_pen.code == "EXCESSIVE_TURNOVER_ANOMALY"


def test_geometric_rs_return_4h_basic_ceiling_and_4h_ema_guard() -> None:
    assert geometric_rs(10.0, 0.0) == pytest.approx(10.0)
    assert geometric_rs(20.0, -10.0) == pytest.approx(((1.2 / 0.9) - 1.0) * 100.0)
    assert geometric_rs(5.0, -100.0) is None

    r4h = derive_return_4h(
        11.0,
        NOW,
        [(NOW - timedelta(hours=4, minutes=5), 10.0), (NOW - timedelta(hours=1), 10.8)],
    )
    assert r4h == pytest.approx(10.0)

    # Startup 4H aggregation allows EMA 50/100 only; EMA 200 attribute must not exist
    bars_1h = [
        OhlcvBar(
            timestamp=NOW - timedelta(hours=440 - i),
            open=10.0,
            high=10.2,
            low=9.8,
            close=10.0 + (i * 0.01),
            volume=1000.0,
        )
        for i in range(440)
    ]
    bars_4h = aggregate_1h_to_4h(bars_1h)
    assert len(bars_4h) >= 100
    ind = compute_historical_indicators(_daily_series(60, ohlcv=True), bars_1h)
    assert ind.ema_50_4h is not None
    assert ind.ema_100_4h is not None
    assert not hasattr(ind, "ema_200_4h")

    # Basic capability ceiling caps Track B at EMERGING_CANDIDATE & MEDIUM confidence
    bm = _benchmark()
    track_b = score_candidate(
        _snap("4001", "CONF"),
        bm,
        now=NOW,
        track="CONFIRMED",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="RISK_ON_ALTSEASON",
        historical=compute_historical_indicators(_daily_series(60, ohlcv=False)),
    )
    assert track_b.classification in {"EMERGING_CANDIDATE", "WATCH", "LOW_PRIORITY"}
    assert track_b.confidence_level in {"MEDIUM", "LOW", "INSUFFICIENT"}
    assert "NO_OHLCV_VERIFICATION" in track_b.badges


def test_duplicate_ticker_ids_and_deterministic_explanation_and_regime_rules() -> None:
    bm = _benchmark()
    hist = compute_historical_indicators(_daily_series(60, ohlcv=False))
    # Two tokens sharing ticker 'AIX' stay distinct by canonical_provider_id
    a1 = _snap("9001", "AIX")
    a2 = _snap("9002", "AIX", vol=35_000_000.0)
    r1 = score_candidate(
        a1,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="RISK_OFF_STRESS",
        historical=hist,
        preset=FilterPreset(),
    )
    r2 = score_candidate(
        a2,
        bm,
        now=NOW,
        track="EARLY",
        horizon="SWING",
        profile="BASIC_CAPABILITY_PROFILE",
        regime="RISK_OFF_STRESS",
        historical=hist,
    )
    assert r1.canonical_provider_id == "9001"
    assert r2.canonical_provider_id == "9002"
    assert r1.confidence_level != "HIGH"

    persisted_rows = [
        {
            "id": f"ev-row-{idx}",
            "evidence_type": obs.evidence_type,
            "metric_name": obs.metric_name,
            "interpretation": obs.interpretation,
            "direction": obs.direction,
        }
        for idx, obs in enumerate(r1.observations)
    ]
    exp = build_deterministic_explanation(r1, persisted_rows)
    valid_ids = {row["id"] for row in persisted_rows}
    for item in exp["positive_evidence"]:  # type: ignore[attr-defined]
        assert item["evidence_id"] in valid_ids
    assert "AIX" in str(exp["summary"])
