import { intelligenceApiUrl } from "@/lib/env";
import { resolveIntelligenceTarget } from "@/lib/intelligence-target";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 32 * 1024;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;
const UPSTREAM_JSON_TIMEOUT_MS = 25_000;

export type IntelligenceProxyRouteContext = {
  params: Promise<{ path: string[] }>;
};

const PROXY_SECURITY_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-accel-buffering": "no",
};

function jsonError(
  status: number,
  summary: string,
  extra?: Record<string, string>,
) {
  return NextResponse.json(
    {
      status: "INSUFFICIENT_DATA",
      ...(extra ?? {}),
      summary,
    },
    { status, headers: PROXY_SECURITY_HEADERS },
  );
}

async function readLimitedBody(request: Request): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "too-large";
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * Shared server-side BFF proxy for CoinTrac Intelligence API (VPS / FastAPI).
 * Served exclusively on `/api/cointrac/*`.
 */
export async function handleIntelligenceProxy(
  request: Request,
  context: IntelligenceProxyRouteContext,
) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = resolveIntelligenceTarget(intelligenceApiUrl(), path, incoming.search);
  if (!target.ok) return jsonError(target.status, target.summary);

  const isPublicHealthProbe =
    request.method === "GET" && path.length === 1 && path[0] === "health";

  let headers: Headers;
  if (isPublicHealthProbe) {
    headers = new Headers({ accept: "application/json" });
  } else {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return jsonError(401, "Authentication is required.");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email_confirmed_at) return jsonError(401, "Authentication is required.");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const authHeaders = proxyAuthHeaders(session?.access_token);
    if (!authHeaders) return jsonError(401, "Authentication is required.");
    headers = authHeaders;
  }

  const acceptHeader = request.headers.get("accept") ?? "";
  const wantsEventStream = acceptHeader.includes("text/event-stream");
  if (wantsEventStream) {
    headers.set("accept", "text/event-stream");
  } else if (!headers.has("accept")) {
    headers.set("accept", "application/json");
  }

  if (!isPublicHealthProbe) {
    const byok = request.headers.get("x-cmc-api-key")?.trim();
    if (byok) {
      if (!SAFE_TOKEN.test(byok)) {
        return jsonError(400, "Invalid CoinMarketCap BYOK API key format.");
      }
      headers.set("x-cmc-api-key", byok);
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
    signal: wantsEventStream
      ? request.signal
      : AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_JSON_TIMEOUT_MS)]),
  };

  if (request.method === "POST" || request.method === "PATCH") {
    const contentType = request.headers.get("content-type") ?? "";
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > 0 || contentType !== "") {
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        return jsonError(415, "Send a JSON body.");
      }
      const body = await readLimitedBody(request);
      if (body === "too-large") return jsonError(413, "The request body is too large.");
      headers.set("content-type", "application/json");
      init.body = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
    }
  }

  try {
    const response = await fetch(target.url, init);
    const responseType = response.headers.get("content-type") ?? "";
    if (responseType.startsWith("text/event-stream")) {
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store, no-transform",
          "x-content-type-options": "nosniff",
          "x-accel-buffering": "no",
        },
      });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(responseType)) {
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        return jsonError(
          503,
          "Engine Standby — Intelligence Engine is warming up or undergoing maintenance.",
          { engine_state: "STANDBY" },
        );
      }
      return jsonError(502, "The intelligence API returned an unexpected response.");
    }
    const responseHeaders: Record<string, string> = {
      ...PROXY_SECURITY_HEADERS,
      "content-type": "application/json",
    };
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      responseHeaders["retry-after"] = retryAfter;
    }
    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(
      503,
      "Engine Standby — Connecting to Intelligence Engine timed out or service is unreachable.",
      { engine_state: "STANDBY" },
    );
  }
}
