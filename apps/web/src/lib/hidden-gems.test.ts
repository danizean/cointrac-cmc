import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCandidateQueryString,
  confidenceBadgeTone,
  eligibilityBadgeTone,
  formatScore,
  formatWeightCoverage,
  scanStatusTone,
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
});
