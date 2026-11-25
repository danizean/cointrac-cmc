import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { proxyAuthHeaders } from "./proxy-auth.ts";

test("proxy auth forwards only a session JWT", () => {
  const missing = proxyAuthHeaders("");
  assert.equal(missing, null);
  const headers = proxyAuthHeaders("aaa.bbb.ccc");
  assert.ok(headers);
  assert.equal(headers?.get("authorization"), "Bearer aaa.bbb.ccc");
  assert.equal(headers?.get("x-cointrac-key"), null);
  assert.equal(headers?.get("x-tradeguard-key"), null);
  assert.equal(headers?.get("x-user-id"), null);
});

test("shared browser proxy handler never attaches shared sandbox or tenant override headers", () => {
  const shared = readFileSync(new URL("./intelligence-proxy.ts", import.meta.url), "utf8");
  assert.equal(shared.includes("SANDBOX_API_KEY"), false);
  assert.equal(shared.includes("x-cointrac-key"), false);
  assert.equal(shared.includes("x-tradeguard-key"), false);
  assert.equal(shared.includes("x-user-id"), false);
  assert.equal(shared.includes('"x-content-type-options": "nosniff"'), true);
  assert.equal(shared.includes('"x-accel-buffering": "no"'), true);
  assert.equal(shared.includes("text/event-stream"), true);
  assert.equal(shared.includes("Engine Standby"), true);
});

test("the only intelligence proxy route is /api/cointrac", () => {
  const cointracRoute = readFileSync(
    new URL("../app/api/cointrac/[...path]/route.ts", import.meta.url),
    "utf8",
  );
  assert.equal(cointracRoute.includes("handleIntelligenceProxy"), true);
  assert.equal(cointracRoute.includes("export const GET = handleIntelligenceProxy"), true);
  assert.equal(cointracRoute.includes("export const POST = handleIntelligenceProxy"), true);
  assert.equal(cointracRoute.includes("export const PATCH = handleIntelligenceProxy"), true);
  assert.equal(cointracRoute.includes("SANDBOX_API_KEY"), false);
  assert.equal(cointracRoute.includes("x-tradeguard-key"), false);
  assert.equal(cointracRoute.includes("x-cointrac-key"), false);

  let legacyExists = true;
  try {
    readFileSync(new URL("../app/api/tg/[...path]/route.ts", import.meta.url), "utf8");
  } catch {
    legacyExists = false;
  }
  assert.equal(legacyExists, false);
});

test("active frontend API clients route exclusively through /api/cointrac and server-api uses x-cointrac-key", () => {
  const apiSource = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  const controlPlaneSource = readFileSync(
    new URL("./control-plane-api.ts", import.meta.url),
    "utf8",
  );
  const serverApiSource = readFileSync(new URL("./server-api.ts", import.meta.url), "utf8");

  assert.equal(apiSource.includes('PROXY_BASE = "/api/cointrac"'), true);
  assert.equal(apiSource.includes("/api/tg"), false);

  assert.equal(controlPlaneSource.includes('PROXY_BASE = "/api/cointrac"'), true);
  assert.equal(controlPlaneSource.includes("/api/tg"), false);

  assert.equal(serverApiSource.includes('"x-cointrac-key"'), true);
  assert.equal(serverApiSource.includes('"x-tradeguard-key"'), false);
});
