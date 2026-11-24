import { intelligenceApiUrl } from "@/lib/env";
import { resolveIntelligenceTarget } from "@/lib/intelligence-target";
import { proxyAuthHeaders } from "@/lib/proxy-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MAX_BODY_BYTES = 32 * 1024;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{8,128}$/;

export type IntelligenceProxyRouteContext = {
  params: Promise<{ path: string[] }>;
};

function jsonError(status: number, summary: string) {
  return NextResponse.json(
    { status: "INSUFFICIENT_DATA", summary },
    { status, headers: { "cache-control": "no-store" } },
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
 * Shared server-side BFF proxy for CoinTrac Intelligence API.
 * Served only on `/api/cointrac/*`.
 */
export async function handleIntelligenceProxy(
  request: Request,
  context: IntelligenceProxyRouteContext,
) {
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = resolveIntelligenceTarget(intelligenceApiUrl(), path, incoming.search);
  if (!target.ok) return jsonError(target.status, target.summary);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return jsonError(401, "Authentication is required.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) return jsonError(401, "Authentication is required.");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = proxyAuthHeaders(session?.access_token);
  if (!headers) return jsonError(401, "Authentication is required.");

  const byok = request.headers.get("x-cmc-api-key")?.trim();
  if (byok) {
    if (!SAFE_TOKEN.test(byok)) {
      return jsonError(400, "Invalid CoinMarketCap BYOK API key format.");
    }
    headers.set("x-cmc-api-key", byok);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
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
    if (!/^application\/json(?:\s*;|$)/i.test(responseType)) {
      return jsonError(502, "The intelligence API returned an unexpected response.");
    }
    const responseHeaders: Record<string, string> = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
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
    return jsonError(503, "Intelligence API is unreachable.");
  }
}
