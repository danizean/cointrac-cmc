import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCandidateQueryString,
  confidenceBadgeTone,
  dedupeCandidatesByAsset,
  eligibilityBadgeTone,
  formatElapsedDuration,
  formatScore,
  formatWeightCoverage,
  parseScanProgress,
  pickDefaultScanRunId,
  scanStatusTone,
  type CandidateSummary,
  type ScanRunSummary,
} from "./hidden-gems-types.ts";
import { buildWorkspaceCommands, filterWorkspaceCommands } from "./workspace-navigation.ts";

describe("Hidden Gems frontend helpers", () => {
  it("builds candidate filter query strings without leaking null or empty parameters", () => {
    assert.equal(buildCandidateQueryString({}), "");
    assert.equal(
      buildCandidateQueryString({
        track: "EARLY",
        horizon: "SWING",
        min_score: 70,
        confidence: "HIGH",
        eligibility: "ELIGIBLE",
        limit: 50,
      }),
      "?track=EARLY&horizon=SWING&min_score=70&confidence=HIGH&eligibility=ELIGIBLE&limit=50",
    );
  });

  it("renders missing scores and coverage honestly without converting null to zero", () => {
    assert.equal(formatScore(null), "—");
    assert.equal(formatScore(undefined), "—");
    assert.equal(formatScore(Number.NaN), "—");
    assert.equal(formatScore(82.34), "82.3");

    assert.equal(formatWeightCoverage(null), "—");
    assert.equal(formatWeightCoverage(0.74), "74%");
  });

  it("maps confidence, eligibility, and scan status to semantic badge tones", () => {
    assert.equal(confidenceBadgeTone("HIGH"), "positive");
    assert.equal(confidenceBadgeTone("MEDIUM"), "info");
    assert.equal(confidenceBadgeTone("LOW"), "warning");
    assert.equal(confidenceBadgeTone("INSUFFICIENT"), "neutral");

    assert.equal(eligibilityBadgeTone("ELIGIBLE"), "positive");
    assert.equal(eligibilityBadgeTone("WATCH"), "brand");
    assert.equal(eligibilityBadgeTone("REJECTED"), "destructive");
    assert.equal(eligibilityBadgeTone("INSUFFICIENT_DATA"), "warning");

    assert.equal(scanStatusTone("COMPLETED"), "positive");
    assert.equal(scanStatusTone("RUNNING"), "info");
    assert.equal(scanStatusTone("PARTIAL"), "warning");
    assert.equal(scanStatusTone("FAILED"), "destructive");
  });

  it("registers /app/hidden-gems in Market Intelligence command search", () => {
    const commands = buildWorkspaceCommands("en");
    const hits = filterWorkspaceCommands(commands, "hidden gem");
    assert.ok(hits.some((item) => item.href === "/app/hidden-gems"));
  });

  it("dedupes repeated asset track/horizon pairs keeping best ELIGIBLE candidate first", () => {
    const base: CandidateSummary = {
      id: "c1",
      scan_run_id: "r1",
      asset_id: "a-bless",
      canonical_provider_id: "123",
      symbol: "BLESS",
      name: "Bless",
      discovery_track: "CONFIRMED",
      trading_horizon: "SHORT_TERM",
      price: 0.1,
      market_cap: 20_000_000,
      volume_24h: 2_000_000,
      return_24h: 5,
      return_7d: 18,
      rs_btc_7d: 14,
      raw_score: 90,
      adjusted_score: 90.5,
      valid_weight_coverage: 1,
      confidence_level: "HIGH",
      data_confidence: 95,
      signal_confidence: 90,
      liquidity_confidence: 85,
      liquidity_mode: "PROXY",
      classification: "HIGH_QUALITY_CANDIDATE",
      eligibility_status: "WATCH",
      score_version: "hg-v1.2.0",
      badges: [],
      missing_components: [],
      source_timestamp: null,
      created_at: null,
    };
    const grouped = dedupeCandidatesByAsset([
      base,
      {
        ...base,
        id: "c2",
        discovery_track: "EARLY",
        trading_horizon: "SWING",
        adjusted_score: 88.2,
        eligibility_status: "ELIGIBLE",
      },
      {
        ...base,
        id: "c3",
        asset_id: "a-tfuel",
        symbol: "TFUEL",
        adjusted_score: 85.1,
        eligibility_status: "ELIGIBLE",
      },
    ]);
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0]?.primary.symbol, "BLESS");
    assert.equal(grouped[0]?.primary.id, "c2"); // ELIGIBLE takes priority over WATCH
    assert.equal(grouped[0]?.variants.length, 2);
    assert.equal(grouped[1]?.primary.symbol, "TFUEL");
  });

  it("picks latest COMPLETED or PARTIAL scan run id before falling back to failed scans", () => {
    const mk = (id: string, status: string): ScanRunSummary => ({
      id,
      status,
      discovery_track: "BOTH",
      trading_horizon: "BOTH",
      effective_tier: "STARTUP",
      evaluation_profile: "STARTUP_FULL_INDICATOR_PROFILE",
      baseline_mode: "LIVE_SNAPSHOTS",
      market_regime: "RANGE_CONSOLIDATION",
      universe_requested: 400,
      universe_scanned: 400,
      candidates_discovered: 5,
      candidates_eligible: 2,
      candidates_rejected: 10,
      cmc_credits_consumed: 2,
      source_metadata: {},
      budget_metadata: {},
      heartbeat_at: null,
      cancel_requested_at: null,
      started_at: null,
      completed_at: null,
      error_summary: null,
      created_at: null,
    });
    assert.equal(pickDefaultScanRunId([mk("r-fail", "FAILED"), mk("r-ok", "COMPLETED")]), "r-ok");
    assert.equal(pickDefaultScanRunId([mk("r-fail", "FAILED")]), "r-fail");
    assert.equal(pickDefaultScanRunId([]), null);
  });

  it("computes honest scan progress purely from verified completed stages without hallucinated metrics", () => {
    const running: ScanRunSummary = {
      id: "r-prog",
      status: "RUNNING",
      discovery_track: "BOTH",
      trading_horizon: "BOTH",
      effective_tier: "STARTUP",
      evaluation_profile: "STARTUP_CAPABILITY_PROFILE",
      baseline_mode: "LIVE_SNAPSHOTS",
      market_regime: "RANGE_CONSOLIDATION",
      universe_requested: 400,
      universe_scanned: 0,
      candidates_discovered: 0,
      candidates_eligible: 0,
      candidates_rejected: 0,
      cmc_credits_consumed: 1,
      source_metadata: {
        progress: {
          stage_index: 3,
          stage_total: 5,
          stage_code: "HARD_GATES",
          stages_completed: ["PREFLIGHT", "INGESTION"],
          universe_ingested: 400,
          hard_gate_passed: null,
          hard_gate_rejected: null,
        },
      },
      budget_metadata: {},
      heartbeat_at: null,
      cancel_requested_at: null,
      started_at: "2026-11-27T09:00:00.000Z",
      completed_at: null,
      error_summary: null,
      created_at: "2026-11-27T09:00:00.000Z",
    };

    const parsed = parseScanProgress(running);
    assert.equal(parsed.stageIndex, 3);
    assert.equal(parsed.completedCount, 2);
    assert.equal(parsed.stagePct, 40); // Exact 2/5 = 40%
    assert.equal(parsed.universeIngested, 400);
    assert.equal(parsed.hardGatePassed, null); // Unmeasured counters stay null
    assert.equal(parsed.hardGateRejected, null);
    assert.equal(
      formatElapsedDuration("2026-11-27T09:00:00.000Z", Date.parse("2026-11-27T09:01:25.000Z")),
      "01:25",
    );
  });
});
