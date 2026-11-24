import logging

import pytest
from pydantic import ValidationError

from app.core.logging import JsonFormatter, redact, register_secrets
from app.schemas.envelope import EvidenceEnvelope, EvidenceMeta, MethodologyMeta
from app.schemas.tools import CompareAssetsInput, MarketOverviewData


def test_missing_price_stays_null() -> None:
    data = MarketOverviewData(quote_currency="USD")
    assert data.total_market_cap is None
    assert data.model_dump()["total_market_cap"] is None


def test_annualization_must_use_365_days() -> None:
    with pytest.raises(ValidationError):
        MethodologyMeta(
            metrics=[],
            observation_window="30d rolling daily",
            annualization_basis="252d",
        )


def test_compare_assets_rejects_more_than_eight_symbols() -> None:
    symbols = [f"A{index}" for index in range(9)]
    with pytest.raises(ValidationError):
        CompareAssetsInput(symbols=symbols)


def test_envelope_accepts_the_canonical_contract() -> None:
    envelope = EvidenceEnvelope[MarketOverviewData](
        tool="get_market_overview",
        engine_version="tradeguard-quant-v1.0.0",
        status="OK",
        summary="No priced fields were available.",
        data=MarketOverviewData(quote_currency="USD"),
        methodology=MethodologyMeta(
            metrics=[],
            observation_window="spot",
            annualization_basis="365d",
        ),
        evidence=EvidenceMeta(
            evidence_id="ev_0123456789",
            data_mode="LIVE",
            freshness="FRESH",
            retrieved_at_utc="2026-11-22T15:00:00Z",
            source_timestamps={},
            cmc_endpoints_called=[],
            cmc_credit_cost=0,
            cache_hit=False,
        ),
        limitations=["total market cap was not returned"],
    )
    assert envelope.evidence.cmc_credit_cost == 0


def test_logs_redact_api_keys() -> None:
    secret = "cmc-live-key-not-for-logs"
    register_secrets(secret)
    record = logging.LogRecord(
        name="cointrac",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="calling CMC with %s",
        args=(secret,),
        exc_info=None,
    )
    rendered = JsonFormatter().format(record)
    assert secret not in rendered
    assert redact(secret) == "[redacted]"


def test_stage_4_3_strict_model_validation_and_null_preservation() -> None:
    from app.schemas.tools import (
        AnalyzeAssetData,
        AnomalyHit,
        MarketRegimeData,
        MoverRow,
        ScanMoversInput,
        SectorSnapshot,
    )

    # Omitting optional max_7d_gain_pct keeps default None
    default_scan = ScanMoversInput()
    assert default_scan.max_7d_gain_pct is None

    # Valid finite bounds pass
    assert ScanMoversInput(max_7d_gain_pct=40.0).max_7d_gain_pct == 40.0
    assert ScanMoversInput(max_7d_gain_pct=-100.0).max_7d_gain_pct == -100.0
    assert ScanMoversInput(max_7d_gain_pct=10000.0).max_7d_gain_pct == 10000.0

    # Non-finite or out-of-bounds max_7d_gain_pct rejected by StrictModel
    for bad in (float("nan"), float("inf"), float("-inf"), -100.1, 10000.1):
        with pytest.raises(ValidationError):
            ScanMoversInput(max_7d_gain_pct=bad)

    # Extra unknown fields remain forbidden (StrictModel)
    with pytest.raises(ValidationError):
        ScanMoversInput(exclude_stablecoins=True)  # type: ignore[call-arg]

    # Nullable additive fields stay None (never 0) when unavailable
    asset = AnalyzeAssetData(symbol="SOL", quote_currency="USD")
    assert asset.percent_change_60d is None
    assert asset.composite_momentum_score is None
    assert asset.timeframes_available is None

    mover = MoverRow(symbol="SOL")
    assert mover.multi_horizon_risk is None

    hit = AnomalyHit(symbol="LEO", metric="ln_volume_to_mcap")
    assert hit.direction is None

    sector = SectorSnapshot(sector_slug="defi", display_name="DeFi", constituent_count=0)
    assert sector.excess_change_24h_vs_market_pct is None
    assert sector.excess_change_7d_vs_market_pct is None

    # Invalid literal enums rejected
    with pytest.raises(ValidationError):
        MoverRow(symbol="SOL", multi_horizon_risk="CONFIRMED_REVERSAL")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        AnomalyHit(symbol="TRUMP", metric="ln_volume_to_mcap", direction="BULLISH")  # type: ignore[arg-type]

    # JSON Schema consistency: all 8 approved fields present; zero forbidden deferred fields
    scan_schema = ScanMoversInput.model_json_schema()
    mover_schema = MoverRow.model_json_schema()
    asset_schema = AnalyzeAssetData.model_json_schema()
    hit_schema = AnomalyHit.model_json_schema()
    sector_schema = SectorSnapshot.model_json_schema()
    regime_schema = MarketRegimeData.model_json_schema()

    assert "max_7d_gain_pct" in scan_schema["properties"]
    assert "exclude_stablecoins" not in scan_schema["properties"]
    assert "multi_horizon_risk" in mover_schema["properties"]
    assert {"percent_change_60d", "composite_momentum_score", "timeframes_available"} <= set(
        asset_schema["properties"].keys()
    )
    assert "direction" in hit_schema["properties"]
    assert "BULLISH" not in str(hit_schema)
    assert "BEARISH" not in str(hit_schema)
    assert {
        "excess_change_24h_vs_market_pct",
        "excess_change_7d_vs_market_pct",
    } <= set(sector_schema["properties"].keys())
    assert "top_constituents" not in sector_schema["properties"]
    assert "top50_breadth_positive_7d_pct" not in regime_schema["properties"]
    assert "macro_trend_7d" not in regime_schema["properties"]
