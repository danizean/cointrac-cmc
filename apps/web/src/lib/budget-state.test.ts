import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_BUDGET_STATES, presentBudgetState } from "./budget-state.ts";

test("every ledger status the console knows has its own label and tone", () => {
  const tones = new Set<string>();
  for (const state of KNOWN_BUDGET_STATES) {
    const presented = presentBudgetState(state.toLowerCase());
    assert.equal(presented.code, state);
    assert.equal(presented.label, state);
    assert.notEqual(presented.description, "");
    tones.add(presented.tone);
  }
  assert.equal(tones.size, 4);
  const visuals = KNOWN_BUDGET_STATES.map((state) => presentBudgetState(state).visual);
  assert.equal(new Set(visuals).size, KNOWN_BUDGET_STATES.length);
});

test("an unrecognized budget state stays UNKNOWN", () => {
  const presented = presentBudgetState("warmup");
  assert.equal(presented.code, "UNKNOWN");
  assert.equal(presented.label, "UNKNOWN");
  assert.match(presented.description, /warmup/);
  assert.doesNotMatch(presented.description, /unavailable/i);
});

test("a missing budget state is not described as telemetry that has not started", () => {
  const presented = presentBudgetState(null);
  assert.equal(presented.code, "UNSET");
  assert.equal(presented.label, "—");
  assert.match(presented.description, /not included/i);
  assert.doesNotMatch(presented.description, /unavailable/i);
});
