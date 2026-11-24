import assert from "node:assert/strict";
import test from "node:test";
import { symbolList, validateToolInput } from "./tool-input.ts";

test("symbolList uppercases and deduplicates tickers", () => {
  assert.deepEqual(symbolList(" sol, btc, SOL "), ["SOL", "BTC"]);
});

test("validateToolInput enforces comparison and momentum bounds", () => {
  assert.equal(validateToolInput("compare_assets", { symbols: ["BTC"] }), "Provide between 2 and 8 unique ticker symbols.");
  assert.equal(validateToolInput("compare_assets", { symbols: ["BTC", "ETH"] }), null);
  assert.equal(validateToolInput("analyze_momentum", { symbols: [] }), "Provide between 1 and 20 unique ticker symbols.");
  assert.equal(validateToolInput("analyze_asset", { symbol: "  " }), "Enter an asset symbol.");
  assert.equal(validateToolInput("analyze_sector_rotation", { sectors: [] }), "Select at least one sector.");
  assert.equal(validateToolInput("get_market_overview", {}), null);
});
