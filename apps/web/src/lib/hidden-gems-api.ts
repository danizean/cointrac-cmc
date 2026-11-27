import {
  buildCandidateQueryString,
  type AlertEventItem,
  type CandidateDetail,
  type CandidateFilterParams,
  type CandidateSummary,
  type CreateScanRequest,
  type QualityStatsRow,
  type ScanAcceptedResponse,
  type ScanConfigCreate,
  type ScanConfigItem,
  type ScanDetailResponse,
  type ScanRunSummary,
  type WatchlistAddRequest,
  type WatchlistItem,
} from "./hidden-gems-types";
import type { ApiResult } from "./types";

const PROXY_BASE = "/api/cointrac/v1/hidden-gems";

interface ProxyCallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function readError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.summary === "string" && rec.summary.trim()) return rec.summary;
    if (typeof rec.detail === "string" && rec.detail.trim()) return rec.detail;
    if (Array.isArray(rec.detail) && rec.detail.length > 0) {
      const first = rec.detail[0] as Record<string, unknown> | undefined;
      if (first && typeof first.msg === "string") return first.msg;
    }
  }
  return fallback;
}

async function callHiddenGemsProxy<T>(
  path: string,
  options: ProxyCallOptions = {},
): Promise<ApiResult<T>> {
  const started = performance.now();
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method === "POST" || method === "PATCH") {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  try {
    const response = await fetch(`${PROXY_BASE}${path}`, {
      method,
      headers,
      body:
        method === "POST" || method === "PATCH"
          ? JSON.stringify(options.body ?? {})
          : undefined,
      cache: "no-store",
      signal: options.signal,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (response.status === 204) {
      return {
        ok: true,
        status: 204,
        data: undefined as T,
        latencyMs,
      };
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const retryRaw = response.headers.get("retry-after");
      const retryParsed = retryRaw ? Number(retryRaw) : NaN;
      return {
        ok: false,
        status: response.status,
        message: readError(payload, `Request failed with HTTP ${response.status}.`),
        retryAfterSeconds: Number.isFinite(retryParsed) ? retryParsed : undefined,
        latencyMs,
      };
    }
    return {
      ok: true,
      status: response.status,
      data: payload as T,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: false,
      status: 0,
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Request cancelled."
          : "Unable to reach Hidden Gems proxy endpoint.",
      latencyMs,
    };
  }
}

export function createHiddenGemScan(
  body: CreateScanRequest,
  idempotencyKey?: string,
): Promise<ApiResult<ScanAcceptedResponse>> {
  return callHiddenGemsProxy<ScanAcceptedResponse>("/scans", {
    method: "POST",
    body,
    idempotencyKey,
  });
}

export function fetchHiddenGemScans(limit = 20): Promise<ApiResult<ScanRunSummary[]>> {
  return callHiddenGemsProxy<ScanRunSummary[]>(`/scans?limit=${limit}`);
}

export function fetchHiddenGemScanDetail(
  scanRunId: string,
): Promise<ApiResult<ScanDetailResponse>> {
  return callHiddenGemsProxy<ScanDetailResponse>(
    `/scans/${encodeURIComponent(scanRunId)}`,
  );
}

export function cancelHiddenGemScan(
  scanRunId: string,
): Promise<ApiResult<ScanRunSummary>> {
  return callHiddenGemsProxy<ScanRunSummary>(
    `/scans/${encodeURIComponent(scanRunId)}/cancel`,
    { method: "POST", body: {} },
  );
}

export function fetchHiddenGemCandidates(
  filters: CandidateFilterParams = {},
): Promise<ApiResult<CandidateSummary[]>> {
  return callHiddenGemsProxy<CandidateSummary[]>(
    `/candidates${buildCandidateQueryString(filters)}`,
  );
}

export function fetchHiddenGemCandidateDetail(
  candidateId: string,
): Promise<ApiResult<CandidateDetail>> {
  return callHiddenGemsProxy<CandidateDetail>(
    `/candidates/${encodeURIComponent(candidateId)}`,
  );
}

export function fetchHiddenGemConfigs(): Promise<ApiResult<ScanConfigItem[]>> {
  return callHiddenGemsProxy<ScanConfigItem[]>("/configs");
}

export function createHiddenGemConfig(
  body: ScanConfigCreate,
): Promise<ApiResult<ScanConfigItem>> {
  return callHiddenGemsProxy<ScanConfigItem>("/configs", {
    method: "POST",
    body,
  });
}

export function updateHiddenGemConfig(
  configId: string,
  body: Partial<ScanConfigCreate> & { is_active?: boolean },
): Promise<ApiResult<ScanConfigItem>> {
  return callHiddenGemsProxy<ScanConfigItem>(`/configs/${encodeURIComponent(configId)}`, {
    method: "PATCH",
    body,
  });
}

export function fetchHiddenGemWatchlist(): Promise<ApiResult<WatchlistItem[]>> {
  return callHiddenGemsProxy<WatchlistItem[]>("/watchlist");
}

export function addToHiddenGemWatchlist(
  body: WatchlistAddRequest,
): Promise<ApiResult<WatchlistItem>> {
  return callHiddenGemsProxy<WatchlistItem>("/watchlist", {
    method: "POST",
    body,
  });
}

export function removeFromHiddenGemWatchlist(
  itemId: string,
): Promise<ApiResult<void>> {
  return callHiddenGemsProxy<void>(`/watchlist/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

export function fetchHiddenGemAlerts(limit = 50): Promise<ApiResult<AlertEventItem[]>> {
  return callHiddenGemsProxy<AlertEventItem[]>(`/alerts?limit=${limit}`);
}

export function fetchHiddenGemQualityStats(): Promise<ApiResult<QualityStatsRow[]>> {
  return callHiddenGemsProxy<QualityStatsRow[]>("/quality-stats");
}
