/**
 * Centralized client API helpers for CoinTrac Developer Control Plane.
 * All requests go exclusively through the session-authenticated Next.js proxy (/api/cointrac/*).
 */

const PROXY_BASE = "/api/cointrac";

export interface ApiKeySummary {
  id: string;
  label: string;
  key_prefix: string;
  masked_key: string;
  is_active: boolean;
  revoked_at: string | null;
  rate_limit_per_min: number;
  created_at: string;
  last_used_at: string | null;
}

export interface ListKeysPayload {
  keys: ApiKeySummary[];
  active_count: number;
  max_active_keys: number;
}

export interface CreateKeyPayload {
  api_key: string;
  key: ApiKeySummary;
}

export interface UsagePayload {
  tool_quota: {
    active_tier: string;
    rate_limit_per_min: number;
    window_seconds: number;
    daily_quota_limit: number | null;
    calls_last_24h: number;
    calls_last_30d: number;
    calls_by_surface: {
      mcp: number;
      rest: number;
      playground: number;
    };
  };
  cmc_credits: {
    billing_month_utc: string;
    credits_this_month: number;
    monthly_allowance: number | null;
    remaining_credits: number | null;
    cache_hit_rate_pct: number | null;
    average_latency_ms: number | null;
  };
  daily_usage: Array<{
    date_utc: string;
    calls: number;
    cache_hits: number;
    cmc_credits: number;
  }>;
  tool_breakdown: Array<{
    tool_name: string;
    calls: number;
    cache_hits: number;
    cmc_credits: number;
  }>;
  recent_requests: Array<{
    tool_name: string;
    surface: string;
    status_code: number;
    latency_ms: number;
    cache_hit: boolean;
    credit_cost: number;
    evidence_id: string | null;
    created_at: string;
  }>;
}

export interface CapabilityProbeRow {
  endpoint: string;
  http_status: number;
  cmc_error_code: number | null;
  credit_count: number;
  status: string;
}

export interface CapabilitiesPayload {
  available?: boolean;
  generated_at_utc?: string;
  results?: CapabilityProbeRow[];
  total_credits_used?: number | null;
}

export interface SystemHealthPayload {
  status: string;
  engine_version: string;
}

export interface McpStatusPayload {
  server_name: string;
  transport: string;
  protocol_version: string;
  stateless_http: boolean;
  endpoint_path: string;
  remote_deployed: boolean;
  remote_url: string | null;
  deployment_status: "deployed" | "not_deployed" | string;
  auth_methods: string[];
  key_prefixes_supported: string[];
  tool_timeout_seconds: number;
  max_body_bytes: number;
  contracts: {
    tools: number;
    static_resources: number;
    resource_templates: number;
    prompts: number;
  };
}

export interface AuthProfilePayload {
  user_id: string;
  email: string | null;
  email_verified: boolean;
  role: string;
  base_plan_code: string;
  account_status: string;
  display_name: string | null;
  created_at: string | null;
  profile_provisioned: boolean;
}

export type ControlPlaneResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<ControlPlaneResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object"
          ? ((parsed as Record<string, unknown>).detail ??
            (parsed as Record<string, unknown>).summary)
          : null;
      return {
        ok: false,
        status: response.status,
        message:
          typeof detail === "string" && detail.trim()
            ? detail
            : `Request failed (HTTP ${response.status}).`,
      };
    }

    return { ok: true, data: parsed as T };
  } catch {
    return {
      ok: false,
      status: 503,
      message: "Unable to reach the CoinTrac intelligence API.",
    };
  }
}

export function fetchApiKeys(): Promise<ControlPlaneResult<ListKeysPayload>> {
  return requestJson<ListKeysPayload>(`${PROXY_BASE}/v1/keys`, { method: "GET" });
}

export function createApiKey(label: string): Promise<ControlPlaneResult<CreateKeyPayload>> {
  return requestJson<CreateKeyPayload>(`${PROXY_BASE}/v1/keys`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export function revokeApiKey(keyId: string): Promise<ControlPlaneResult<{ key: ApiKeySummary }>> {
  return requestJson<{ key: ApiKeySummary }>(`${PROXY_BASE}/v1/keys/${encodeURIComponent(keyId)}/revoke`, {
    method: "POST",
  });
}

export function fetchUsage(): Promise<ControlPlaneResult<UsagePayload>> {
  return requestJson<UsagePayload>(`${PROXY_BASE}/v1/telemetry/usage`, { method: "GET" });
}

export function fetchCapabilities(): Promise<ControlPlaneResult<CapabilitiesPayload>> {
  return requestJson<CapabilitiesPayload>(`${PROXY_BASE}/v1/capabilities`, { method: "GET" });
}

export function fetchSystemHealth(): Promise<ControlPlaneResult<SystemHealthPayload>> {
  return requestJson<SystemHealthPayload>(`${PROXY_BASE}/health`, { method: "GET" });
}

export function fetchMcpStatus(): Promise<ControlPlaneResult<McpStatusPayload>> {
  return requestJson<McpStatusPayload>(`${PROXY_BASE}/v1/mcp/status`, { method: "GET" });
}

export function fetchMyProfile(): Promise<ControlPlaneResult<AuthProfilePayload>> {
  return requestJson<AuthProfilePayload>(`${PROXY_BASE}/v1/auth/me`, { method: "GET" });
}

export function updateMyDisplayName(
  displayName: string,
): Promise<ControlPlaneResult<AuthProfilePayload>> {
  return requestJson<AuthProfilePayload>(`${PROXY_BASE}/v1/auth/profile`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}
