import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PLAYGROUND_PRESETS,
  PROMPT_CATALOG,
  RESOURCE_CATALOG,
  SECTOR_OPTIONS,
  TOOL_CATALOG,
} from "./catalog.ts";
import {
  formatCompactUsd,
  formatDurationMs,
  formatInteger,
  formatNumber,
  formatPct,
  formatRatio,
  formatUsd,
  formatUtc,
  MISSING,
} from "./format.ts";

describe("format helpers preserve missing market values", () => {
  it("never converts null, undefined, or non-finite values to zero", () => {
    for (const missing of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatUsd(missing), MISSING);
      assert.equal(formatCompactUsd(missing), MISSING);
      assert.equal(formatPct(missing), MISSING);
      assert.equal(formatNumber(missing), MISSING);
      assert.equal(formatInteger(missing), MISSING);
      assert.equal(formatRatio(missing), MISSING);
      assert.equal(formatDurationMs(missing), MISSING);
    }
    assert.equal(formatUtc(null), MISSING);
    assert.equal(formatUtc(undefined), MISSING);
  });

  it("formats signed percentages and timestamps predictably", () => {
    assert.equal(formatPct(11.42, { signed: true }), "+11.42%");
    assert.equal(formatPct(-3.5, { signed: true }), "-3.50%");
    assert.equal(formatPct(0, { signed: true }), "0.00%");
    assert.equal(formatUtc("2026-11-23T14:05:12Z"), "2026-11-23 14:05:12 UTC");
  });

  it("formats compact USD deterministically across Node SSR and browser ICU versions", () => {
    assert.equal(formatCompactUsd(2_150_000_000_000), "$2.15T");
    assert.equal(formatCompactUsd(1_900_000_000), "$1.90B");
    assert.equal(formatCompactUsd(45_200_000), "$45.20M");
    assert.equal(formatCompactUsd(12_300), "$12.30K");
    assert.equal(formatCompactUsd(-1_900_000_000), "-$1.90B");
    assert.equal(formatCompactUsd(99.5), "$99.50");
  });
});

describe("MCP control plane catalog completeness", () => {
  it("registers 10 tools, 5 resources, 3 prompts, 4 presets, and 7 sectors including RWA", () => {
    assert.equal(TOOL_CATALOG.length, 10);
    assert.equal(RESOURCE_CATALOG.length, 5);
    assert.equal(
      RESOURCE_CATALOG.every((r) => r.uri.startsWith("cointrac://")),
      true,
    );
    assert.equal(
      RESOURCE_CATALOG.some((r) => r.uri.startsWith("tradeguard://")),
      false,
    );
    assert.equal(PROMPT_CATALOG.length, 3);
    assert.equal(PLAYGROUND_PRESETS.length, 4);
    assert.equal(SECTOR_OPTIONS.length, 7);
    assert.equal(
      SECTOR_OPTIONS.some((sector) => sector.slug === "rwa"),
      true,
    );
  });

  it("exposes all 8 Stage 4.3 approved additive contract fields and zero deferred fields in types.ts", () => {
    const typesSource = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
    const approvedFields = [
      "percent_change_60d?: number | null;",
      "composite_momentum_score?: number | null;",
      "timeframes_available?: number | null;",
      "multi_horizon_risk?: MultiHorizonRisk | null;",
      "max_7d_gain_pct?: number | null;",
      "direction?: AnomalyDirection | null;",
      "excess_change_24h_vs_market_pct?: number | null;",
      "excess_change_7d_vs_market_pct?: number | null;",
    ];
    for (const field of approvedFields) {
      assert.equal(
        typesSource.includes(field),
        true,
        `Missing approved Stage 4.3 TypeScript field: ${field}`,
      );
    }

    const forbiddenFields = [
      "top50_breadth_positive_7d_pct",
      "macro_trend_7d",
      "clean_venue_open_interest",
      "zero_exclusion_open_interest",
      "top_constituents",
      "exclude_stablecoins",
    ];
    for (const field of forbiddenFields) {
      assert.equal(
        typesSource.includes(field),
        false,
        `Deferred/forbidden field must NOT appear in types.ts: ${field}`,
      );
    }
  });
});
