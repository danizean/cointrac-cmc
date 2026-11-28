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
  server_mode?: {
    effective_profile: string | null;
    detected_tier: string | null;
    budget_state: string | null;
    deep_scan_available: boolean | null;
    deep_scan_reason: string | null;
  };
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
  platform_role?: string;
  is_super_admin?: boolean;
}

export interface AIQuotaSnapshot {
  ai_enabled: boolean;
  user_ai_enabled: boolean;
  key_configured: boolean;
  model: string;
  rate_limit_per_min: number;
  used_last_minute: number;
  remaining_this_minute: number;
  daily_requests_limit: number;
  used_today_requests: number;
  remaining_today_requests: number;
  daily_tokens_limit: number;
  used_today_tokens: number;
  remaining_today_tokens: number;
  reset_in_seconds: number;
}

export interface AIUsageLogItem {
  id: string;
  user_id: string;
  user_email?: string | null;
  model: string;
  status: string;
  prompt_summary: string;
  tools_called: string[];
  evidence_ids: string[];
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  cache_hit: boolean;
  error_code?: string | null;
  created_at: string;
}

export interface AIStatusPayload {
  quota: AIQuotaSnapshot;
  recent_logs: AIUsageLogItem[];
}

export interface AIChatResponsePayload {
  answer: string;
  model: string;
  locale: "en" | "id";
  tools_used: string[];
  evidence_refs: Array<{
    evidence_id: string;
    tool: string;
    data_mode: string | null;
    freshness: string | null;
  }>;
  tool_calls_count: number;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    estimated_cost_usd: number;
  };
  latency_ms: number;
  cache_hit: boolean;
  quota: AIQuotaSnapshot;
}

export interface AIRuntimeConfigPayload {
  enabled: boolean;
  provider: string;
  base_url: string;
  model: string;
  default_rate_limit_per_min: number;
  default_daily_requests: number;
  default_daily_tokens: number;
  max_tool_rounds: number;
  max_output_tokens: number;
  temperature: number;
  response_cache_ttl_seconds: number;
  system_directive: string;
  api_key_configured: boolean;
  api_key_source: "db" | "env" | "none";
  api_key_hint: string | null;
  updated_at: string | null;
}

export interface AdminAIUserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  base_plan_code: string;
  platform_role: "user" | "super_admin";
  ai_enabled: boolean;
  rate_limit_per_min: number | null;
  daily_requests_limit: number | null;
  daily_tokens_limit: number | null;
  effective_rate_limit_per_min: number;
  effective_daily_requests_limit: number;
  effective_daily_tokens_limit: number;
  notes: string | null;
  used_today_requests: number;
  used_today_tokens: number;
  used_30d_requests: number;
  used_30d_tokens: number;
  estimated_cost_30d_usd: number;
  mcp_calls_30d?: number;
  rest_calls_30d?: number;
  api_calls_today?: number;
  cmc_credits_30d?: number;
  last_api_activity_at?: string | null;
}

export interface AdminDailySeriesPoint {
  date_utc: string;
  requests: number;
  cached: number;
  rate_limited: number;
  errors: number;
  tokens: number;
  estimated_cost_usd: number;
  mcp_requests?: number;
  rest_requests?: number;
  api_credits?: number;
}

export interface AdminPlatformSummary {
  requests_today: number;
  requests_30d: number;
  mcp_requests_today: number;
  mcp_requests_30d: number;
  rest_requests_30d: number;
  playground_requests_30d: number;
  oauth_mcp_requests_30d: number;
  api_key_mcp_requests_30d: number;
  cmc_credits_30d: number;
  cache_hit_rate_pct: number | null;
  error_count_30d: number;
  avg_latency_ms: number | null;
  active_users_30d: number;
}

export interface AdminPlatformToolRow {
  tool_name: string;
  calls: number;
  mcp_calls: number;
  rest_calls: number;
  credits: number;
}

export interface PlatformRequestLogItem {
  id: string;
  user_id: string;
  user_email?: string | null;
  api_key_id?: string | null;
  auth_mode: "api_key" | "oauth" | "session" | string;
  surface: "mcp" | "rest" | "playground" | string;
  tool_name: string;
  status_code: number;
  latency_ms: number;
  cache_hit: boolean;
  credit_cost: number;
  evidence_id?: string | null;
  created_at: string;
}

export interface AdminAIOverviewPayload {
  config: AIRuntimeConfigPayload;
  summary: {
    requests_today: number;
    requests_30d: number;
    tokens_30d: number;
    estimated_cost_30d_usd: number;
    cache_hit_rate_pct: number | null;
    rate_limited_today: number;
    active_users_30d: number;
    error_count_30d?: number;
    avg_latency_ms?: number | null;
    total_registered_users?: number;
    super_admin_count?: number;
    ai_paused_users?: number;
    custom_limit_users?: number;
  };
  platform_summary?: AdminPlatformSummary;
  daily_series?: AdminDailySeriesPoint[];
  top_tools: Array<{ tool_name: string; calls: number }>;
  platform_top_tools?: AdminPlatformToolRow[];
  users: AdminAIUserRow[];
  recent_logs: AIUsageLogItem[];
  recent_api_logs?: PlatformRequestLogItem[];
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

export function fetchAiStatus(): Promise<ControlPlaneResult<AIStatusPayload>> {
  return requestJson<AIStatusPayload>(`${PROXY_BASE}/v1/ai/status`, { method: "GET" });
}

export function sendAiChat(payload: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  locale: "en" | "id";
  context_hint?: string | null;
  bypass_cache?: boolean;
}): Promise<ControlPlaneResult<AIChatResponsePayload>> {
  return requestJson<AIChatResponsePayload>(`${PROXY_BASE}/v1/ai/chat`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAdminAiOverview(): Promise<ControlPlaneResult<AdminAIOverviewPayload>> {
  return requestJson<AdminAIOverviewPayload>(`${PROXY_BASE}/v1/admin/ai/overview`, {
    method: "GET",
  });
}

export function updateAdminAiConfig(payload: {
  enabled?: boolean;
  base_url?: string;
  model?: string;
  api_key_secret?: string;
  clear_api_key_secret?: boolean;
  default_rate_limit_per_min?: number;
  default_daily_requests?: number;
  default_daily_tokens?: number;
  max_tool_rounds?: number;
  max_output_tokens?: number;
  temperature?: number;
  response_cache_ttl_seconds?: number;
  system_directive?: string;
}): Promise<ControlPlaneResult<AIRuntimeConfigPayload>> {
  return requestJson<AIRuntimeConfigPayload>(`${PROXY_BASE}/v1/admin/ai/config`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateAdminUserLimits(
  targetUserId: string,
  payload: {
    ai_enabled: boolean;
    rate_limit_per_min: number | null;
    daily_requests_limit: number | null;
    daily_tokens_limit: number | null;
    notes: string | null;
  },
): Promise<ControlPlaneResult<unknown>> {
  return requestJson<unknown>(
    `${PROXY_BASE}/v1/admin/ai/users/${encodeURIComponent(targetUserId)}/limits`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function resetAdminUserLimits(targetUserId: string): Promise<ControlPlaneResult<unknown>> {
  return requestJson<unknown>(
    `${PROXY_BASE}/v1/admin/ai/users/${encodeURIComponent(targetUserId)}/limits`,
    {
      method: "DELETE",
    },
  );
}

export function updateAdminUserRole(
  targetUserId: string,
  platform_role: "user" | "super_admin",
): Promise<ControlPlaneResult<{ user_id: string; platform_role: string }>> {
  return requestJson<{ user_id: string; platform_role: string }>(
    `${PROXY_BASE}/v1/admin/ai/users/${encodeURIComponent(targetUserId)}/role`,
    {
      method: "PATCH",
      body: JSON.stringify({ platform_role }),
    },
  );
}
