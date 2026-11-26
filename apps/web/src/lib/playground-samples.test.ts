import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_CATALOG } from "./catalog.ts";
import {
  PLAYGROUND_TOOL_GROUPS,
  getPresetSampleEnvelopes,
  getSampleEnvelopeForTool,
} from "./playground-samples.ts";

describe("playground-samples", () => {
  it("covers every tool in TOOL_CATALOG without duplicates across groups", () => {
    const grouped = PLAYGROUND_TOOL_GROUPS.flatMap((g) => g.tools);
    const catalogNames = TOOL_CATALOG.map((t) => t.name);
    assert.equal(grouped.length, catalogNames.length);
    for (const name of catalogNames) {
      assert.ok(grouped.includes(name), `Missing tool in groups: ${name}`);
    }
  });

  it("builds valid EvidenceEnvelope samples for all 10 tools in en and id locales", () => {
    for (const entry of TOOL_CATALOG) {
      for (const locale of ["en", "id"] as const) {
        const env = getSampleEnvelopeForTool(entry.name, locale);
        assert.equal(env.tool, entry.name);
        assert.equal(env.methodology.annualization_basis, "365d");
        assert.ok(env.evidence.evidence_id.startsWith("ev_sample_schema_"));
        assert.ok(env.limitations.length >= 1);
      }
    }
  });

  it("honestly preserves TIER_RESTRICTED null shape for historical performance", () => {
    const hist = getSampleEnvelopeForTool("get_historical_performance", "en");
    assert.equal(hist.status, "TIER_RESTRICTED");
    assert.equal(hist.evidence.data_mode, "UNAVAILABLE");
    assert.equal(
      (hist.data as { annualized_volatility: number | null }).annualized_volatility,
      null,
    );
  });

  it("returns paired envelopes when pairedTool is provided", () => {
    const envs = getPresetSampleEnvelopes(
      "get_market_overview",
      "analyze_market_regime",
      "en",
    );
    assert.equal(envs.length, 2);
    assert.equal(envs[0]?.tool, "analyze_market_regime");
    assert.equal(envs[1]?.tool, "get_market_overview");
  });
});
