import assert from "node:assert/strict";
import test from "node:test";
import { probeSession } from "./session-probe.ts";

function fakeFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as typeof fetch;
}

test("probeSession treats a verified identity response as authenticated", async () => {
  assert.equal(await probeSession(fakeFetch(200)), "authenticated");
});

test("probeSession treats 401 as anonymous and does not treat other failures as anonymous", async () => {
  assert.equal(await probeSession(fakeFetch(401)), "anonymous");
  assert.equal(await probeSession(fakeFetch(503)), "unavailable");
});

test("probeSession reports an unreachable checker as unavailable", async () => {
  const failing = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  assert.equal(await probeSession(failing), "unavailable");
});
