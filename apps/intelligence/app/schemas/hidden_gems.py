"""Strict Pydantic v2 schemas for CoinTrac Hidden Gem Discovery Engine REST API."""

from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field, field_validator

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


class OutcomeCheckpointSummary(StrictModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    entry_price: float | None = None
    entry_btc_price: float | None = None
    entry_observed_at: str
    ret_1d: float | None = None
    ret_3d: float | None = None
    ret_7d: float | None = None
    ret_14d: float | None = None
    ret_30d: float | None = None
    rel_btc_7d: float | None = None
    rel_btc_30d: float | None = None
    mfe_30d: float | None = None
    mae_30d: float | None = None
    invalidated_at: str | None = None
    last_evaluated_at: str | None = None


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
    outcome_checkpoint: OutcomeCheckpointSummary | None = None


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


class HiddenGemCandidatesInput(StrictModel):
    model_config = ConfigDict(extra="forbid")

    track: DiscoveryTrackType | None = None
    horizon: TradingHorizonType | None = None
    min_score: float | None = Field(default=None, ge=0.0, le=100.0)
    confidence: Literal["HIGH", "MEDIUM", "LOW", "INSUFFICIENT"] | None = None
    classification: str | None = Field(default=None, min_length=1, max_length=64)
    eligibility: str | None = Field(default=None, min_length=1, max_length=64)
    run_id: str | None = Field(default=None, min_length=1, max_length=128)
    limit: int = Field(default=50, ge=1, le=200, strict=True)
    offset: int = Field(default=0, ge=0, strict=True)


class HiddenGemDetailInput(StrictModel):
    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(min_length=1, max_length=128)

    @field_validator("candidate_id")
    @classmethod
    def _clean_candidate_id(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("candidate_id must not be blank")
        return cleaned


class HiddenGemQualityStatsInput(StrictModel):
    model_config = ConfigDict(extra="forbid")

    track: DiscoveryTrackType | None = None
    score_version: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("score_version")
    @classmethod
    def _clean_score_version(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class HiddenGemCandidatesData(StrictModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[CandidateSummary] = Field(default_factory=list)
    count: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)
    has_more: bool = False
    filters: dict[str, object] = Field(default_factory=dict)


class HiddenGemDetailData(StrictModel):
    model_config = ConfigDict(extra="forbid")

    found: bool
    detail: CandidateDetail | None = None


class HiddenGemQualityStatsData(StrictModel):
    model_config = ConfigDict(extra="forbid")

    rows: list[QualityStatsRow] = Field(default_factory=list)
    total_groups: int = Field(ge=0)
    total_tracked: int = Field(ge=0)
    filters: dict[str, object] = Field(default_factory=dict)
