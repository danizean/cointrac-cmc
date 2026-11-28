from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EvidenceStatus(StrEnum):
    OK = "OK"
    PARTIAL = "PARTIAL"
    TIER_RESTRICTED = "TIER_RESTRICTED"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class DataMode(StrEnum):
    LIVE = "LIVE"
    CACHED = "CACHED"
    VERIFIED_SNAPSHOT_FALLBACK = "VERIFIED_SNAPSHOT_FALLBACK"
    UNAVAILABLE = "UNAVAILABLE"


class Freshness(StrEnum):
    FRESH = "FRESH"
    AGING = "AGING"
    STALE = "STALE"


FieldAvailability = Literal[
    "AVAILABLE",
    "UNAVAILABLE_TIER",
    "UNAVAILABLE_SOURCE",
    "INSUFFICIENT_SAMPLE",
    "NOT_APPLICABLE",
    "INVALID_SYMBOL",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FieldProvenance(StrictModel):
    availability: FieldAvailability
    reason_code: str | None = None
    source: str | None = None
    endpoint: str | None = None
    source_timestamp: datetime | None = None
    retrieved_at: datetime | None = None
    data_mode: DataMode | None = None
    freshness: Freshness | None = None


class MethodologyMeta(StrictModel):
    version: str | None = None
    metrics: list[str]
    observation_window: str
    annualization_basis: str = Field(pattern=r"^365d$")
    parameters: dict[str, object] | None = None


class EvidenceMeta(StrictModel):
    evidence_id: str = Field(pattern=r"^ev_[0-9a-f]{10}$")
    data_mode: DataMode
    freshness: Freshness
    retrieved_at_utc: datetime
    source_timestamps: dict[str, datetime]
    cmc_endpoints_called: list[str]
    cmc_credit_cost: int = Field(ge=0)
    cache_hit: bool


class AgentAction(StrictModel):
    reason: str
    retry_after_seconds: int | None = Field(default=None, ge=0)
    suggested_tool: str | None = None


class EvidenceEnvelope[T](StrictModel):
    tool: str
    engine_version: str
    status: EvidenceStatus
    summary: str
    data: T
    methodology: MethodologyMeta
    evidence: EvidenceMeta
    field_provenance: dict[str, FieldProvenance] | None = None
    limitations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    agent_actions: list[AgentAction] = Field(default_factory=list)
