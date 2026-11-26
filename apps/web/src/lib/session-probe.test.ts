import assert from "node:assert/strict";
import test from "node:test";
import { probeAccountSession, probeSession } from "./session-probe.ts";

function fakeFetch(status: number, body?: unknown): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
    })) as typeof fetch;
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

test("probeAccountSession identifies authenticated, unverified, and anonymous Supabase sessions", async () => {
  assert.deepEqual(
    await probeAccountSession(
      fakeFetch(200, {
        configured: true,
        authenticated: true,
        emailVerified: true,
        email: "trader@example.com",
      }),
    ),
    { status: "authenticated", email: "trader@example.com" },
  );

  assert.deepEqual(
    await probeAccountSession(
      fakeFetch(200, {
        configured: true,
        authenticated: false,
        emailVerified: false,
        email: "pending@example.com",
      }),
    ),
    { status: "email_unverified", email: "pending@example.com" },
  );

  assert.deepEqual(
    await probeAccountSession(
      fakeFetch(200, {
        configured: true,
        authenticated: false,
        emailVerified: false,
        email: null,
      }),
    ),
    { status: "anonymous", email: null },
  );
});
