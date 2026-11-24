import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveIntelligenceTarget } from "./intelligence-target.ts";

const LOCAL = "http://127.0.0.1:8000";

describe("resolveIntelligenceTarget", () => {
  it("allows the health check and versioned API paths", () => {
    const health = resolveIntelligenceTarget(LOCAL, ["health"], "");
    assert.equal(health.ok, true);
    if (health.ok) assert.equal(health.url.href, "http://127.0.0.1:8000/health");

    const overview = resolveIntelligenceTarget(
      LOCAL,
      ["v1", "intelligence", "market-overview"],
      "?quote=USD",
    );
    assert.equal(overview.ok, true);
    if (overview.ok) {
      assert.equal(overview.url.href, "http://127.0.0.1:8000/v1/intelligence/market-overview?quote=USD");
    }
  });

  it("rejects traversal, foreign origins, and paths outside the API", () => {
    assert.equal(resolveIntelligenceTarget(LOCAL, ["..", "secret"], "").ok, false);
    assert.equal(resolveIntelligenceTarget(LOCAL, ["https:", "evil.com"], "").ok, false);
    assert.equal(resolveIntelligenceTarget(LOCAL, ["mcp"], "").ok, false);
    assert.equal(resolveIntelligenceTarget(LOCAL, ["v1"], "").ok, false);
    assert.equal(resolveIntelligenceTarget(LOCAL, ["health"], "?\nSet-Cookie: a=b").ok, false);
  });

  it("rejects credentialed, cleartext public, and metadata base URLs", () => {
    assert.equal(resolveIntelligenceTarget("http://user:pass@127.0.0.1:8000", ["health"], "").ok, false);
    assert.equal(resolveIntelligenceTarget("http://api.example.com", ["health"], "").ok, false);
    assert.equal(resolveIntelligenceTarget("http://169.254.169.254", ["health"], "").ok, false);
    assert.equal(resolveIntelligenceTarget("https://metadata.google.internal", ["health"], "").ok, false);

    const remote = resolveIntelligenceTarget("https://api.example.com", ["health"], "");
    assert.equal(remote.ok, true);
    if (remote.ok) assert.equal(remote.url.origin, "https://api.example.com");
  });
});
