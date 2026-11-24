import "server-only";
import { connection } from "next/server";
import { intelligenceApiUrl, sandboxApiKey } from "./env";
import { proxyAuthHeaders } from "./proxy-auth";
import { resolveIntelligenceTarget } from "./intelligence-target";
import { createSupabaseServerClient } from "./supabase/server";
import type {
  ApiResult,
  EvidenceEnvelope,
  EvidenceListResponse,
  EvidenceRecord,
  HealthResponse,
  MarketOverviewData,
  MarketRegimeData,
  SectorRotationData,
  TelemetrySummary,
} from "./types";

const SERVER_TIMEOUT_MS = 8000;
const OVERVIEW_MEMO_TTL_MS = 15_000;

interface MemoEntry<T> {
  expiresAt: number;
  result: ApiResult<T>;
}

const overviewMemo = new Map<string, MemoEntry<unknown>>();
const inflightMemo = new Map<string, Promise<ApiResult<unknown>>>();

async function cachedServerCall<T>(
  key: string,
  loader: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T>> {
  await connection();
  const now = performance.now();
  const hit = overviewMemo.get(key) as MemoEntry<T> | undefined;
  if (hit && hit.expiresAt > now) {
    return hit.result;
  }
  const pending = inflightMemo.get(key) as Promise<ApiResult<T>> | undefined;
  if (pending) {
    return pending;
  }
  const promise = loader()
    .then((result) => {
      if (result.ok) {
        overviewMemo.set(key, {
          expiresAt: performance.now() + OVERVIEW_MEMO_TTL_MS,
          result,
        });
      }
      return result;
    })
    .finally(() => {
      inflightMemo.delete(key);
    });
  inflightMemo.set(key, promise as Promise<ApiResult<unknown>>);
  return promise;
}

function extractServerError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.summary === "string" && record.summary.trim()) {
      return record.summary;
    }
    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail;
    }
  }
  return fallback;
}

async function sessionAuthorization(): Promise<{ authorization: string; userId: string } | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const authorization = proxyAuthHeaders(session?.access_token)?.get("authorization");
  if (!authorization) return null;
  return { authorization, userId: user.id };
}

function unauthorized<T>(): ApiResult<T> {
  return { ok: false, status: 401, message: "Authentication is required.", latencyMs: 0 };
}

async function serverRequest<T>(
  pathSegments: string[],
  options?: {
    method?: "GET" | "POST";
    search?: string;
    body?: unknown;
    sessionAuthorization?: string;
  },
): Promise<ApiResult<T>> {
  const started = performance.now();
  const target = resolveIntelligenceTarget(
    intelligenceApiUrl(),
    pathSegments,
    options?.search ?? "",
  );
  if (!target.ok) {
    return {
      ok: false,
      status: target.status,
      message: target.summary,
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const headers = new Headers();
  if (options?.sessionAuthorization) {
    headers.set("authorization", options.sessionAuthorization);
  } else {
    const key = sandboxApiKey();
    if (key) {
      headers.set("x-cointrac-key", key);
    }
  }

  const method = options?.method ?? "GET";
  if (method === "POST") {
    headers.set("content-type", "application/json");
  }

  try {
    const response = await fetch(target.url, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(options?.body ?? {}) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
    });

    const latencyMs = Math.round(performance.now() - started);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: extractServerError(
          payload,
          `Intelligence API returned HTTP ${response.status}.`,
        ),
        latencyMs,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: payload as T,
      latencyMs,
    };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "Intelligence API is unreachable.",
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

export function serverFetchHealth(): Promise<ApiResult<HealthResponse>> {
  return cachedServerCall("health", () =>
    serverRequest<HealthResponse>(["health"]),
  );
}

export function serverFetchMarketOverview(): Promise<
  ApiResult<EvidenceEnvelope<MarketOverviewData>>
> {
  return cachedServerCall("overview:USD", () =>
    serverRequest<EvidenceEnvelope<MarketOverviewData>>(
      ["v1", "intelligence", "market-overview"],
      { search: "?quote_currency=USD" },
    ),
  );
}

export function serverFetchMarketRegime(): Promise<
  ApiResult<EvidenceEnvelope<MarketRegimeData>>
> {
  return cachedServerCall("regime:USD", () =>
    serverRequest<EvidenceEnvelope<MarketRegimeData>>(
      ["v1", "intelligence", "market-regime"],
      { search: "?quote_currency=USD" },
    ),
  );
}

export function serverFetchSectorRotation(): Promise<
  ApiResult<EvidenceEnvelope<SectorRotationData>>
> {
  return cachedServerCall("sectors:USD", () =>
    serverRequest<EvidenceEnvelope<SectorRotationData>>(
      ["v1", "intelligence", "sector-rotation"],
      { method: "POST", body: { quote_currency: "USD" } },
    ),
  );
}

export async function serverFetchTelemetrySummary(): Promise<
  ApiResult<TelemetrySummary>
> {
  const session = await sessionAuthorization();
  if (!session) return unauthorized();
  return cachedServerCall(`telemetry:${session.userId}`, () =>
    serverRequest<TelemetrySummary>(["v1", "telemetry", "summary"], {
      sessionAuthorization: session.authorization,
    }),
  );
}

export async function serverFetchEvidenceList(): Promise<
  ApiResult<EvidenceListResponse>
> {
  const session = await sessionAuthorization();
  if (!session) return unauthorized();
  return serverRequest<EvidenceListResponse>(["v1", "evidence"], {
    sessionAuthorization: session.authorization,
  });
}

export async function serverFetchEvidenceById(
  evidenceId: string,
): Promise<ApiResult<EvidenceRecord>> {
  const session = await sessionAuthorization();
  if (!session) return unauthorized();
  return serverRequest<EvidenceRecord>(["v1", "evidence", evidenceId], {
    sessionAuthorization: session.authorization,
  });
}
