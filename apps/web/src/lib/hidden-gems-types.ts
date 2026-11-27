import type { BadgeTone } from "@/components/ui/primitives";

export type ScanTrackInput = "EARLY" | "CONFIRMED" | "BOTH";
export type ScanHorizonInput = "SHORT_TERM" | "SWING" | "BOTH";
export type DiscoveryTrack = "EARLY" | "CONFIRMED";
export type TradingHorizon = "SHORT_TERM" | "SWING";

export interface FilterOverridesInput {
  min_market_cap_usd?: number | null;
  max_market_cap_usd?: number | null;
  min_volume_24h_usd?: number | null;
  min_vol_to_mcap?: number | null;
  min_listing_age_days?: number | null;
  max_early_return_24h_pct?: number | null;
  max_early_return_7d_pct?: number | null;
}

export interface CreateScanRequest {
  track: ScanTrackInput;
  horizon: ScanHorizonInput;
  config_id?: string | null;
  universe_limit?: number | null;
  filters?: FilterOverridesInput | null;
}

export interface ScanAcceptedResponse {
  scan_run_id: string;
  status: string;
  idempotent_replay: boolean;
  effective_tier: string;
  evaluation_profile: string;
  estimated_credits: number;
}

export interface ScanRunSummary {
  id: string;
  status: string;
  discovery_track: string;
  trading_horizon: string;
  effective_tier: string;
  evaluation_profile: string;
  baseline_mode: string;
  market_regime: string;
  universe_requested: number;
  universe_scanned: number;
  candidates_discovered: number;
  candidates_eligible: number;
  candidates_rejected: number;
  cmc_credits_consumed: number;
  source_metadata: Record<string, unknown>;
  budget_metadata: Record<string, unknown>;
  heartbeat_at: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_summary: string | null;
  created_at: string | null;
}

export interface RejectionSummary {
  id: string;
  asset_id: string | null;
  symbol: string | null;
  rejection_stage: string;
  rejection_code: string;
  rejection_reason: string;
  observed_metrics: Record<string, unknown>;
  created_at: string | null;
}

export interface ScanDetailResponse {
  scan_run: ScanRunSummary;
  rejections: RejectionSummary[];
}

export interface CandidateSummary {
  id: string;
  scan_run_id: string;
  asset_id: string;
  canonical_provider_id: string;
  symbol: string;
  name: string;
  discovery_track: DiscoveryTrack;
  trading_horizon: TradingHorizon;
  price: number | null;
  market_cap: number | null;
  volume_24h: number | null;
  return_24h: number | null;
  return_7d: number | null;
  rs_btc_7d: number | null;
  raw_score: number | null;
  adjusted_score: number | null;
  valid_weight_coverage: number;
  confidence_level: string;
  data_confidence: number;
  signal_confidence: number;
  liquidity_confidence: number;
  liquidity_mode: string;
  classification: string;
  eligibility_status: string;
  score_version: string;
  badges: string[];
  missing_components: string[];
  source_timestamp: string | null;
  created_at: string | null;
}

export interface ComponentScoreItem {
  score: number | null;
  base_weight: number;
  effective_weight: number;
  quality_status: string;
}

export interface PenaltyEntry {
  code: string;
  points: number;
  reason: string;
}

export interface RejectionEntry {
  stage: string;
  code: string;
  reason: string;
  observed_metrics?: Record<string, unknown>;
}

export interface EvidenceCitationClaim {
  claim?: string;
  risk?: string;
  evidence_id: string;
}

export interface DeterministicExplanation {
  summary: string;
  why_discovered: EvidenceCitationClaim[];
  positive_evidence: EvidenceCitationClaim[];
  negative_evidence: EvidenceCitationClaim[];
  missing_data: string[];
  key_risks: EvidenceCitationClaim[];
  what_to_monitor: string[];
  invalidation_conditions: string[];
}

export interface EvidenceRecordItem {
  id: string;
  evidence_type: string;
  metric_name: string;
  observed_value: unknown;
  interpretation: string;
  direction: string;
  source_provider: string;
  source_endpoint: string;
  source_timestamp: string;
  fetched_at: string;
  quality_status: string;
  metadata: Record<string, unknown>;
}

export interface ScoreHistoryItem {
  id: string;
  discovery_track: string;
  trading_horizon: string;
  previous_score: number | null;
  current_score: number | null;
  score_delta: number | null;
  previous_status: string | null;
  current_status: string | null;
  observed_at: string;
}

export interface OutcomeCheckpointSummary {
  id: string;
  entry_price: number | null;
  entry_btc_price: number | null;
  entry_observed_at: string;
  ret_1d: number | null;
  ret_3d: number | null;
  ret_7d: number | null;
  ret_14d: number | null;
  ret_30d: number | null;
  rel_btc_7d: number | null;
  rel_btc_30d: number | null;
  mfe_30d: number | null;
  mae_30d: number | null;
  invalidated_at: string | null;
  last_evaluated_at: string | null;
}

export interface CandidateDetail {
  candidate: CandidateSummary;
  component_scores: Record<string, ComponentScoreItem>;
  effective_weights: Record<string, number>;
  penalties: PenaltyEntry[];
  rejection_reasons: RejectionEntry[];
  explanation: DeterministicExplanation | null;
  evidence: EvidenceRecordItem[];
  score_history: ScoreHistoryItem[];
  outcome_checkpoint?: OutcomeCheckpointSummary | null;
}

export interface ScanConfigCreate {
  name: string;
  description?: string | null;
  discovery_track: ScanTrackInput;
  trading_horizon: ScanHorizonInput;
  universe_config?: Record<string, unknown>;
  filter_config?: FilterOverridesInput;
  schedule_config?: Record<string, unknown>;
  is_default?: boolean;
}

export interface ScanConfigItem {
  id: string;
  name: string;
  description: string | null;
  discovery_track: string;
  trading_horizon: string;
  universe_config: Record<string, unknown>;
  filter_config: Record<string, unknown>;
  scoring_config: Record<string, unknown>;
  schedule_config: Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface WatchlistAddRequest {
  asset_id: string;
  candidate_result_id?: string | null;
  user_note?: string | null;
}

export interface WatchlistItem {
  id: string;
  asset_id: string;
  symbol: string | null;
  name: string | null;
  candidate_result_id: string | null;
  watch_status: string;
  user_note: string | null;
  added_at: string | null;
  updated_at: string | null;
}

export interface AlertEventItem {
  id: string;
  asset_id: string;
  scan_run_id: string | null;
  candidate_result_id: string | null;
  event_type: string;
  severity: string;
  dedup_key: string;
  payload: Record<string, unknown>;
  delivery_channel: string;
  delivery_status: string;
  created_at: string | null;
}

export interface QualityStatsRow {
  score_version: string;
  discovery_track: string;
  effective_tier: string;
  total_tracked: number;
  evaluated_7d: number;
  positive_7d_rate: number | null;
  avg_rel_btc_7d: number | null;
  mean_mae_30d: number | null;
}

export interface CandidateFilterParams {
  track?: DiscoveryTrack | "";
  horizon?: TradingHorizon | "";
  min_score?: number | null;
  confidence?: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT" | "";
  eligibility?: string;
  run_id?: string;
  limit?: number;
  offset?: number;
}

export interface GroupedCandidate {
  primary: CandidateSummary;
  variants: CandidateSummary[];
}

export function buildCandidateQueryString(filters: CandidateFilterParams): string {
  const qs = new URLSearchParams();
  if (filters.track) qs.set("track", filters.track);
  if (filters.horizon) qs.set("horizon", filters.horizon);
  if (typeof filters.min_score === "number" && Number.isFinite(filters.min_score)) {
    qs.set("min_score", String(filters.min_score));
  }
  if (filters.confidence) qs.set("confidence", filters.confidence);
  if (filters.eligibility) qs.set("eligibility", filters.eligibility);
  if (filters.run_id) qs.set("run_id", filters.run_id);
  if (typeof filters.limit === "number" && Number.isFinite(filters.limit)) {
    qs.set("limit", String(filters.limit));
  }
  if (typeof filters.offset === "number" && Number.isFinite(filters.offset) && filters.offset > 0) {
    qs.set("offset", String(filters.offset));
  }
  const encoded = qs.toString();
  return encoded ? `?${encoded}` : "";
}

function eligibilityPriority(status: string): number {
  if (status === "ELIGIBLE") return 3;
  if (status === "WATCH" || status === "WATCHLIST_ONLY") return 2;
  if (status === "INSUFFICIENT_DATA") return 1;
  return 0;
}

function compareCandidatePriority(a: CandidateSummary, b: CandidateSummary): number {
  const eligDiff =
    eligibilityPriority(b.eligibility_status) - eligibilityPriority(a.eligibility_status);
  if (eligDiff !== 0) return eligDiff;
  const aScore = typeof a.adjusted_score === "number" ? a.adjusted_score : -1;
  const bScore = typeof b.adjusted_score === "number" ? b.adjusted_score : -1;
  if (bScore !== aScore) return bScore - aScore;
  return 0;
}

export function dedupeCandidatesByAsset(candidates: CandidateSummary[]): GroupedCandidate[] {
  const buckets = new Map<string, CandidateSummary[]>();
  for (const row of candidates) {
    const key = row.asset_id || row.canonical_provider_id || row.symbol;
    const list = buckets.get(key);
    if (list) {
      list.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }
  const grouped: GroupedCandidate[] = [];
  for (const variants of buckets.values()) {
    const ordered = [...variants].sort(compareCandidatePriority);
    const primary = ordered[0];
    if (primary) {
      grouped.push({ primary, variants: ordered });
    }
  }
  return grouped.sort((a, b) => {
    const aScore = typeof a.primary.adjusted_score === "number" ? a.primary.adjusted_score : -1;
    const bScore = typeof b.primary.adjusted_score === "number" ? b.primary.adjusted_score : -1;
    if (bScore !== aScore) return bScore - aScore;
    return compareCandidatePriority(a.primary, b.primary);
  });
}

export function pickDefaultScanRunId(scans: ScanRunSummary[]): string | null {
  const completed = scans.find((s) => s.status === "COMPLETED" || s.status === "PARTIAL");
  return completed?.id ?? scans[0]?.id ?? null;
}

export function confidenceBadgeTone(level: string): BadgeTone {
  if (level === "HIGH") return "positive";
  if (level === "MEDIUM") return "info";
  if (level === "INSUFFICIENT") return "neutral";
  return "warning";
}

export function eligibilityBadgeTone(status: string): BadgeTone {
  if (status === "ELIGIBLE") return "positive";
  if (status === "WATCH" || status === "WATCHLIST_ONLY") return "brand";
  if (status === "REJECTED") return "destructive";
  return "warning";
}

export function scanStatusTone(status: string): BadgeTone {
  if (status === "COMPLETED") return "positive";
  if (status === "RUNNING" || status === "QUEUED") return "info";
  if (status === "PARTIAL" || status === "CANCELLED") return "warning";
  return "destructive";
}

export function formatScore(score: number | null | undefined): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "—";
  return score.toFixed(1);
}

export const HIDDEN_GEM_PIPELINE_STAGES = [
  "PREFLIGHT",
  "INGESTION",
  "HARD_GATES",
  "ENRICHMENT",
  "SCORING_PERSIST",
] as const;

export type HiddenGemStageCode = (typeof HIDDEN_GEM_PIPELINE_STAGES)[number];

export interface ParsedScanProgress {
  stageIndex: number;
  stageTotal: number;
  stageCode: string;
  stagesCompleted: HiddenGemStageCode[];
  completedCount: number;
  stagePct: number;
  universeIngested: number | null;
  hardGatePassed: number | null;
  hardGateRejected: number | null;
  enrichmentTargets: number | null;
  candidatesScored: number | null;
  hasBackendTelemetry: boolean;
}

function asNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

export function parseScanProgress(scan: ScanRunSummary): ParsedScanProgress {
  const total = HIDDEN_GEM_PIPELINE_STAGES.length;
  const rawProgress = scan.source_metadata?.progress;
  const record =
    rawProgress && typeof rawProgress === "object"
      ? (rawProgress as Record<string, unknown>)
      : null;

  if (!record) {
    if (scan.status === "COMPLETED" || scan.status === "PARTIAL") {
      return {
        stageIndex: total,
        stageTotal: total,
        stageCode: "COMPLETED",
        stagesCompleted: [...HIDDEN_GEM_PIPELINE_STAGES],
        completedCount: total,
        stagePct: 100,
        universeIngested: scan.universe_scanned > 0 ? scan.universe_scanned : null,
        hardGatePassed: null,
        hardGateRejected: scan.candidates_rejected > 0 ? scan.candidates_rejected : null,
        enrichmentTargets: null,
        candidatesScored: scan.candidates_discovered > 0 ? scan.candidates_discovered : null,
        hasBackendTelemetry: false,
      };
    }
    return {
      stageIndex: scan.status === "QUEUED" ? 1 : 1,
      stageTotal: total,
      stageCode: scan.status === "RUNNING" ? "PREFLIGHT" : scan.status,
      stagesCompleted: [],
      completedCount: 0,
      stagePct: 0,
      universeIngested: scan.universe_scanned > 0 ? scan.universe_scanned : null,
      hardGatePassed: null,
      hardGateRejected: scan.candidates_rejected > 0 ? scan.candidates_rejected : null,
      enrichmentTargets: null,
      candidatesScored: scan.candidates_discovered > 0 ? scan.candidates_discovered : null,
      hasBackendTelemetry: false,
    };
  }

  const rawCompleted = Array.isArray(record.stages_completed)
    ? record.stages_completed.filter((s): s is HiddenGemStageCode =>
        (HIDDEN_GEM_PIPELINE_STAGES as readonly string[]).includes(String(s)),
      )
    : [];
  const completedCount = rawCompleted.length;
  const exactPct = Math.round((completedCount / total) * 100);
  const rawIdx = asNullableInt(record.stage_index) ?? 1;

  return {
    stageIndex: Math.max(1, Math.min(total, rawIdx)),
    stageTotal: total,
    stageCode: typeof record.stage_code === "string" ? record.stage_code : scan.status,
    stagesCompleted: rawCompleted,
    completedCount,
    stagePct: exactPct,
    universeIngested: asNullableInt(record.universe_ingested),
    hardGatePassed: asNullableInt(record.hard_gate_passed),
    hardGateRejected: asNullableInt(record.hard_gate_rejected),
    enrichmentTargets: asNullableInt(record.enrichment_targets),
    candidatesScored: asNullableInt(record.candidates_scored),
    hasBackendTelemetry: true,
  };
}

export function formatElapsedDuration(startedIso: string | null, nowMs: number): string {
  if (!startedIso) return "00:00";
  const startMs = Date.parse(startedIso);
  if (!Number.isFinite(startMs)) return "00:00";
  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatWeightCoverage(coverage: number | null | undefined): string {
  if (typeof coverage !== "number" || !Number.isFinite(coverage)) return "—";
  return `${Math.round(coverage * 100)}%`;
}
