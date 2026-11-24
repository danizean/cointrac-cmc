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
  ToolName,
} from "./types";

const PROXY_BASE = "/api/cointrac";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  byok?: string;
  signal?: AbortSignal;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.summary === "string" && record.summary.trim()) {
      return record.summary;
    }
    if (typeof record.detail === "string" && record.detail.trim()) {
      return record.detail;
    }
    if (Array.isArray(record.detail) && record.detail.length > 0) {
      const first = record.detail[0] as Record<string, unknown> | undefined;
      if (first && typeof first.msg === "string") {
        const loc = Array.isArray(first.loc) ? first.loc.join(".") : "";
        return loc ? `${loc}: ${first.msg}` : first.msg;
      }
    }
  }
  return fallback;
}

async function requestProxy<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const started = performance.now();
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};

  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }
  const trimmedByok = options.byok?.trim();
  if (trimmedByok) {
    headers["x-cmc-api-key"] = trimmedByok;
  }

  try {
    const response = await fetch(`${PROXY_BASE}${path}`, {
      method,
      headers,
      body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
      cache: "no-store",
      signal: options.signal,
    });

    const latencyMs = Math.round(performance.now() - started);
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const retryHeader = response.headers.get("retry-after");
      const retryParsed = retryHeader ? Number(retryHeader) : NaN;
      return {
        ok: false,
        status: response.status,
        message: extractErrorMessage(
          payload,
          `Request failed with HTTP ${response.status}.`,
        ),
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
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request cancelled."
        : "Unable to reach the CoinTrac proxy endpoint.";
    return {
      ok: false,
      status: 0,
      message,
      latencyMs,
    };
  }
}

export function buildToolRequest(
  tool: ToolName,
  params: Record<string, unknown>,
): { method: "GET" | "POST"; path: string; body?: Record<string, unknown> } {
  const quote =
    typeof params.quote_currency === "string" && params.quote_currency.trim()
      ? params.quote_currency.trim().toUpperCase()
      : "USD";

  switch (tool) {
    case "get_market_overview":
      return {
        method: "GET",
        path: `/v1/intelligence/market-overview?quote_currency=${encodeURIComponent(quote)}`,
      };
    case "analyze_market_regime":
      return {
        method: "GET",
        path: `/v1/intelligence/market-regime?quote_currency=${encodeURIComponent(quote)}`,
      };
    case "scan_market_movers":
      return {
        method: "POST",
        path: "/v1/intelligence/scan-movers",
        body: { ...params, quote_currency: quote },
      };
    case "compare_assets":
      return {
        method: "POST",
        path: "/v1/intelligence/compare-assets",
        body: { ...params, quote_currency: quote },
      };
    case "analyze_asset": {
      const symbol = encodeURIComponent(
        String(params.symbol ?? "BTC").trim().toUpperCase(),
      );
      return {
        method: "GET",
        path: `/v1/intelligence/assets/${symbol}?quote_currency=${encodeURIComponent(quote)}`,
      };
    }
    case "analyze_momentum":
      return {
        method: "POST",
        path: "/v1/intelligence/momentum",
        body: { ...params, quote_currency: quote },
      };
    case "detect_market_anomalies":
      return {
        method: "POST",
        path: "/v1/intelligence/anomalies",
        body: { ...params, quote_currency: quote },
      };
    case "analyze_sector_rotation":
      return {
        method: "POST",
        path: "/v1/intelligence/sector-rotation",
        body: { ...params, quote_currency: quote },
      };
    case "get_historical_performance": {
      const symbol = encodeURIComponent(
        String(params.symbol ?? "SOL").trim().toUpperCase(),
      );
      const count =
        typeof params.count === "number" && Number.isFinite(params.count)
          ? Math.max(5, Math.min(90, Math.round(params.count)))
          : 30;
      return {
        method: "GET",
        path: `/v1/intelligence/assets/${symbol}/historical?quote_currency=${encodeURIComponent(quote)}&count=${count}`,
      };
    }
    case "analyze_derivatives": {
      const symbol = encodeURIComponent(
        String(params.symbol ?? "BTC").trim().toUpperCase(),
      );
      return {
        method: "GET",
        path: `/v1/intelligence/assets/${symbol}/derivatives?quote_currency=${encodeURIComponent(quote)}`,
      };
    }
  }
}

export async function runIntelligenceTool(
  tool: ToolName,
  params: Record<string, unknown>,
  options?: { byok?: string; signal?: AbortSignal },
): Promise<ApiResult<EvidenceEnvelope>> {
  const req = buildToolRequest(tool, params);
  return requestProxy<EvidenceEnvelope>(req.path, {
    method: req.method,
    body: req.body,
    byok: options?.byok,
    signal: options?.signal,
  });
}

export function fetchEvidenceList(): Promise<ApiResult<EvidenceListResponse>> {
  return requestProxy<EvidenceListResponse>("/v1/evidence");
}

export function fetchEvidenceDetail(
  evidenceId: string,
): Promise<ApiResult<EvidenceRecord>> {
  return requestProxy<EvidenceRecord>(
    `/v1/evidence/${encodeURIComponent(evidenceId.trim())}`,
  );
}

export function fetchTelemetrySummary(): Promise<ApiResult<TelemetrySummary>> {
  return requestProxy<TelemetrySummary>("/v1/telemetry/summary");
}

export function fetchHealth(): Promise<ApiResult<HealthResponse>> {
  return requestProxy<HealthResponse>("/health");
}

export function fetchMarketOverview(
  quoteCurrency = "USD",
): Promise<ApiResult<EvidenceEnvelope<MarketOverviewData>>> {
  return requestProxy<EvidenceEnvelope<MarketOverviewData>>(
    `/v1/intelligence/market-overview?quote_currency=${encodeURIComponent(quoteCurrency)}`,
  );
}

export function fetchMarketRegime(
  quoteCurrency = "USD",
): Promise<ApiResult<EvidenceEnvelope<MarketRegimeData>>> {
  return requestProxy<EvidenceEnvelope<MarketRegimeData>>(
    `/v1/intelligence/market-regime?quote_currency=${encodeURIComponent(quoteCurrency)}`,
  );
}

export function fetchSectorRotation(
  quoteCurrency = "USD",
): Promise<ApiResult<EvidenceEnvelope<SectorRotationData>>> {
  return requestProxy<EvidenceEnvelope<SectorRotationData>>(
    "/v1/intelligence/sector-rotation",
    {
      method: "POST",
      body: { quote_currency: quoteCurrency },
    },
  );
}
