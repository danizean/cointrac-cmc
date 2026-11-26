"""Strict Pydantic v2 schemas for CoinTrac Hidden Gem Discovery Engine REST API."""

from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from app.schemas.envelope import StrictModel

ScanTrackInput = Literal["EARLY", "CONFIRMED", "BOTH"]
ScanHorizonInput = Literal["SHORT_TERM", "SWING", "BOTH"]
DiscoveryTrackType = Literal["EARLY", "CONFIRMED"]
TradingHorizonType = Literal["SHORT_TERM", "SWING"]


class FilterOverridesInput(StrictModel):
    model_config = ConfigDict(extra="forbid")

    min_market_cap_usd: float | None = Field(default=None, ge=0.0)
    max_market_cap_usd: float | None = Field(default=None, ge=0.0)
    min_volume_24h_usd: float | None = Field(default=None, ge=0.0)
    min_vol_to_mcap: float | None = Field(default=None, ge=0.0)
    min_listing_age_days: int | None = Field(default=None, ge=0, strict=True)
    max_early_return_24h_pct: float | None = Field(default=None, ge=0.0)
    max_early_return_7d_pct: float | None = Field(default=None, ge=0.0)


class CreateScanRequest(StrictModel):
    model_config = ConfigDict(extra="forbid")

    track: ScanTrackInput = "BOTH"
    horizon: ScanHorizonInput = "BOTH"
    config_id: str | None = None
    universe_limit: int | None = Field(default=None, ge=50, le=1000, strict=True)
    filters: FilterOverridesInput | None = None


class ScanAcceptedResponse(StrictModel):
    model_config = ConfigDict(extra="forbid")

    scan_run_id: str
    status: str
    idempotent_replay: bool = False
    effective_tier: str
    evaluation_profile: str
    estimated_credits: int


class ScanRunSummary(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    status: str
    discovery_track: str
    trading_horizon: str
    effective_tier: str
    evaluation_profile: str
    baseline_mode: str
    market_regime: str
    universe_requested: int
    universe_scanned: int
    candidates_discovered: int
    candidates_eligible: int
    candidates_rejected: int
    cmc_credits_consumed: int
    source_metadata: dict[str, object] = Field(default_factory=dict)
    budget_metadata: dict[str, object] = Field(default_factory=dict)
    heartbeat_at: str | None = None
    cancel_requested_at: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    error_summary: str | None = None
    created_at: str | None = None


class RejectionSummary(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    asset_id: str | None = None
    symbol: str | None = None
    rejection_stage: str
    rejection_code: str
    rejection_reason: str
    observed_metrics: dict[str, object] = Field(default_factory=dict)
    created_at: str | None = None


class CandidateSummary(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    scan_run_id: str
    asset_id: str
    canonical_provider_id: str
    symbol: str
    name: str
    discovery_track: DiscoveryTrackType
    trading_horizon: TradingHorizonType
    price: float | None = None
    market_cap: float | None = None
    volume_24h: float | None = None
    return_24h: float | None = None
    return_7d: float | None = None
    rs_btc_7d: float | None = None
    raw_score: float | None = None
    adjusted_score: float | None = None
    valid_weight_coverage: float
    confidence_level: str
    data_confidence: float
    signal_confidence: float
    liquidity_confidence: float
    liquidity_mode: str
    classification: str
    eligibility_status: str
    score_version: str
    badges: list[str] = Field(default_factory=list)
    missing_components: list[str] = Field(default_factory=list)
    source_timestamp: str | None = None
    created_at: str | None = None


class EvidenceRecordItem(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    evidence_type: str
    metric_name: str
    observed_value: object
    interpretation: str
    direction: str
    source_provider: str
    source_endpoint: str
    source_timestamp: str
    fetched_at: str
    quality_status: str
    metadata: dict[str, object] = Field(default_factory=dict)


class ScoreHistoryItem(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    discovery_track: str
    trading_horizon: str
    previous_score: float | None = None
    current_score: float | None = None
    score_delta: float | None = None
    previous_status: str | None = None
    current_status: str | None = None
    observed_at: str


class CandidateDetail(StrictModel):
    model_config = ConfigDict(extra="forbid")

    candidate: CandidateSummary
    component_scores: dict[str, object] = Field(default_factory=dict)
    effective_weights: dict[str, object] = Field(default_factory=dict)
    penalties: list[dict[str, object]] = Field(default_factory=list)
    rejection_reasons: list[dict[str, object]] = Field(default_factory=list)
    explanation: dict[str, object] | None = None
    evidence: list[EvidenceRecordItem] = Field(default_factory=list)
    score_history: list[ScoreHistoryItem] = Field(default_factory=list)


class ScanConfigCreate(StrictModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    discovery_track: ScanTrackInput = "BOTH"
    trading_horizon: ScanHorizonInput = "BOTH"
    universe_config: dict[str, object] = Field(default_factory=dict)
    filter_config: dict[str, object] = Field(default_factory=dict)
    scoring_config: dict[str, object] = Field(default_factory=dict)
    schedule_config: dict[str, object] = Field(default_factory=dict)
    is_default: bool = False


class ScanConfigUpdate(StrictModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)
    discovery_track: ScanTrackInput | None = None
    trading_horizon: ScanHorizonInput | None = None
    universe_config: dict[str, object] | None = None
    filter_config: dict[str, object] | None = None
    scoring_config: dict[str, object] | None = None
    schedule_config: dict[str, object] | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ScanConfigItem(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str | None = None
    discovery_track: str
    trading_horizon: str
    universe_config: dict[str, object] = Field(default_factory=dict)
    filter_config: dict[str, object] = Field(default_factory=dict)
    scoring_config: dict[str, object] = Field(default_factory=dict)
    schedule_config: dict[str, object] = Field(default_factory=dict)
    is_default: bool
    is_active: bool
    created_at: str | None = None
    updated_at: str | None = None


class WatchlistAddRequest(StrictModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    candidate_result_id: str | None = None
    user_note: str | None = Field(default=None, max_length=400)


class WatchlistItem(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    asset_id: str
    symbol: str | None = None
    name: str | None = None
    candidate_result_id: str | None = None
    watch_status: str
    user_note: str | None = None
    added_at: str | None = None
    updated_at: str | None = None


class AlertEventItem(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    asset_id: str
    scan_run_id: str | None = None
    candidate_result_id: str | None = None
    event_type: str
    severity: str
    dedup_key: str
    payload: dict[str, object] = Field(default_factory=dict)
    delivery_channel: str
    delivery_status: str
    created_at: str | None = None


class QualityStatsRow(StrictModel):
    model_config = ConfigDict(extra="forbid")

    score_version: str
    discovery_track: str
    effective_tier: str
    total_tracked: int
    evaluated_7d: int
    positive_7d_rate: float | None = None
    avg_rel_btc_7d: float | None = None
    mean_mae_30d: float | None = None
