"use client";

import {
  Activity,
  Cpu,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { StatusIndicator } from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  fetchAdminAiOverview,
  resetAdminUserLimits,
  updateAdminAiConfig,
  updateAdminUserLimits,
  updateAdminUserRole,
  type AdminAIOverviewPayload,
  type AdminAIUserRow,
} from "@/lib/control-plane-api";

type AdminTab = "overview" | "config" | "users";

const INPUT =
  "mt-1 min-h-10 w-full rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

interface UserDraft {
  ai_enabled: boolean;
  rate_limit_per_min: string;
  daily_requests_limit: string;
  daily_tokens_limit: string;
  notes: string;
}

function toIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function SuperAdminConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();

  const [tab, setTab] = useState<AdminTab>("overview");
  const [data, setData] = useState<AdminAIOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  // Global config form fields
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState("muse-spark-1.3");
  const [baseUrl, setBaseUrl] = useState("https://api.meta.ai/v1");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [rateMin, setRateMin] = useState("10");
  const [dailyReq, setDailyReq] = useState("50");
  const [dailyTok, setDailyTok] = useState("150000");
  const [maxRounds, setMaxRounds] = useState("4");
  const [maxOutputTok, setMaxOutputTok] = useState("900");
  const [temperature, setTemperature] = useState("0.2");
  const [cacheTtl, setCacheTtl] = useState("120");
  const [directive, setDirective] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Users management state
  const [userSearch, setUserSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const hydrateFromPayload = useCallback((payload: AdminAIOverviewPayload) => {
    setData(payload);
    const c = payload.config;
    setEnabled(c.enabled);
    setModel(c.model);
    setBaseUrl(c.base_url);
    setRateMin(String(c.default_rate_limit_per_min));
    setDailyReq(String(c.default_daily_requests));
    setDailyTok(String(c.default_daily_tokens));
    setMaxRounds(String(c.max_tool_rounds));
    setMaxOutputTok(String(c.max_output_tokens));
    setTemperature(String(c.temperature));
    setCacheTtl(String(c.response_cache_ttl_seconds));
    setDirective(c.system_directive);

    const nextDrafts: Record<string, UserDraft> = {};
    for (const u of payload.users) {
      nextDrafts[u.user_id] = {
        ai_enabled: u.ai_enabled,
        rate_limit_per_min: u.rate_limit_per_min !== null ? String(u.rate_limit_per_min) : "",
        daily_requests_limit:
          u.daily_requests_limit !== null ? String(u.daily_requests_limit) : "",
        daily_tokens_limit: u.daily_tokens_limit !== null ? String(u.daily_tokens_limit) : "",
        notes: u.notes ?? "",
      };
    }
    setDrafts(nextDrafts);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetchAdminAiOverview();
    setLoading(false);
    if (!res.ok) {
      setError({ status: res.status, message: res.message });
      return;
    }
    setError(null);
    hydrateFromPayload(res.data);
  }, [hydrateFromPayload]);

  useEffect(() => {
    let active = true;
    void fetchAdminAiOverview().then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setError({ status: res.status, message: res.message });
        return;
      }
      setError(null);
      hydrateFromPayload(res.data);
    });
    return () => {
      active = false;
    };
  }, [hydrateFromPayload]);

  async function handleSaveConfig(clearKey = false) {
    setSavingConfig(true);
    const res = await updateAdminAiConfig({
      enabled,
      model: model.trim() || "muse-spark-1.3",
      base_url: baseUrl.trim() || "https://api.meta.ai/v1",
      ...(clearKey
        ? { clear_api_key_secret: true }
        : apiKeyInput.trim()
          ? { api_key_secret: apiKeyInput.trim() }
          : {}),
      default_rate_limit_per_min: Number(rateMin) || 10,
      default_daily_requests: Number(dailyReq) || 50,
      default_daily_tokens: Number(dailyTok) || 150000,
      max_tool_rounds: Number(maxRounds) || 4,
      max_output_tokens: Number(maxOutputTok) || 900,
      temperature: Number(temperature),
      response_cache_ttl_seconds: Number(cacheTtl),
      system_directive: directive,
    });
    setSavingConfig(false);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    setApiKeyInput("");
    pushToast(
      isId ? "Konfigurasi CoinTrac AI tersimpan." : "CoinTrac AI config updated.",
      "success",
    );
    void refresh();
  }

  async function handleSaveUserLimits(user: AdminAIUserRow) {
    const draft = drafts[user.user_id];
    if (!draft) return;
    setBusyUserId(user.user_id);
    const res = await updateAdminUserLimits(user.user_id, {
      ai_enabled: draft.ai_enabled,
      rate_limit_per_min: toIntOrNull(draft.rate_limit_per_min),
      daily_requests_limit: toIntOrNull(draft.daily_requests_limit),
      daily_tokens_limit: toIntOrNull(draft.daily_tokens_limit),
      notes: draft.notes.trim() || null,
    });
    setBusyUserId(null);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    pushToast(
      isId ? `Limit AI untuk ${user.email ?? user.user_id} diperbarui.` : "User AI limits updated.",
      "success",
    );
    void refresh();
  }

  async function handleResetUserLimits(userId: string) {
    setBusyUserId(userId);
    const res = await resetAdminUserLimits(userId);
    setBusyUserId(null);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    pushToast(isId ? "Limit user dikembalikan ke default global." : "User limits reset.", "info");
    void refresh();
  }

  async function handleToggleRole(user: AdminAIUserRow) {
    const nextRole = user.platform_role === "super_admin" ? "user" : "super_admin";
    setBusyUserId(user.user_id);
    const res = await updateAdminUserRole(user.user_id, nextRole);
    setBusyUserId(null);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    pushToast(
      isId ? `Role diperbarui ke ${nextRole}.` : `Role updated to ${nextRole}.`,
      "success",
    );
    void refresh();
  }

  const filteredUsers = useMemo(() => {
    const list = data?.users ?? [];
    const q = userSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q) ||
        u.user_id.toLowerCase().includes(q),
    );
  }, [data?.users, userSearch]);

  if (error && (error.status === 401 || error.status === 403)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Super Admin Console"
          description={
            isId
              ? "Akses khusus Super Admin untuk konfigurasi Muse Spark 1.3 dan limit per pengguna."
              : "Restricted Super Admin governance for Muse Spark 1.3 configuration and user quotas."
          }
        />
        <Card className="border-destructive/40 bg-destructive-soft/40 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-foreground">
                {isId ? "Akses Super Admin Ditolak (HTTP 403)" : "Super Admin Access Restricted (403)"}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {error.message}{" "}
                {isId
                  ? "Pastikan email Anda terdaftar di SUPER_ADMIN_EMAILS atau profiles.platform_role = 'super_admin'."
                  : "Ensure your verified email is listed in SUPER_ADMIN_EMAILS or profiles.platform_role = 'super_admin'."}
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const summary = data?.summary;
  const config = data?.config;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Super Admin · CoinTrac AI Governance"
        description={
          isId
            ? "Pantau konsumsi Muse Spark 1.3, biaya estimasi, konfigurasi global, dan atur rate limit per pengguna."
            : "Monitor Muse Spark 1.3 usage, estimated cost, global runtime config, and per-user rate limits."
        }
        actions={
          <Button variant="primary" size="md" loading={loading} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />

      {error ? (
        <ErrorNotice status={error.status} message={error.message} onRetry={() => void refresh()} />
      ) : null}

      {/* Top Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Super Admin sections"
        className="inline-flex flex-wrap gap-1.5 rounded-full border border-border bg-card/80 p-1"
      >
        {(
          [
            { id: "overview", labelEn: "Usage & Telemetry", labelId: "Penggunaan & Audit", icon: Activity },
            { id: "config", labelEn: "AI Runtime & Limits", labelId: "Konfigurasi & Limit Global", icon: Cpu },
            { id: "users", labelEn: "User Quotas & Roles", labelId: "Kuota & Role Pengguna", icon: Users },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 font-mono text-xs font-semibold transition-colors ${
                active ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isId ? item.labelId : item.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Usage & Audit Telemetry */}
      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="ct-surface-featured p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Permintaan (Hari ini / 30h)" : "Requests (Today / 30d)"}
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-28" />
              ) : (
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {summary ? `${summary.requests_today} / ${summary.requests_30d}` : "—"}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {summary ? `${summary.active_users_30d} ${isId ? "pengguna aktif (30h)" : "active users (30d)"}` : "—"}
              </p>
            </Card>

            <Card className="p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Total Token (30h)" : "Total Tokens (30d)"}
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-28" />
              ) : (
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {summary ? summary.tokens_30d.toLocaleString() : "—"}
                </p>
              )}
              <p className="mt-1 font-mono text-xs text-link">
                {summary ? `Est. $${summary.estimated_cost_30d_usd.toFixed(4)} USD` : "—"}
              </p>
            </Card>

            <Card className="p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Efisiensi Cache AI" : "AI Cache Hit Rate"}
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-20" />
              ) : (
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-positive">
                  {summary && summary.cache_hit_rate_pct !== null
                    ? `${summary.cache_hit_rate_pct}%`
                    : "—"}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {isId ? "Cache hit menghemat 100% token Muse." : "Cache hits spend 0 Muse tokens."}
              </p>
            </Card>

            <Card className="p-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Terkena Rate Limit (Hari Ini)" : "Rate Limited Today"}
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-16" />
              ) : (
                <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {summary ? summary.rate_limited_today : "—"}
                </p>
              )}
              <div className="mt-1">
                {config ? (
                  <StatusIndicator
                    state={config.enabled && config.api_key_configured ? "CONNECTED" : "STANDBY"}
                    label={
                      config.enabled && config.api_key_configured
                        ? `${config.model}`
                        : "KEY / AI OFF"
                    }
                  />
                ) : null}
              </div>
            </Card>
          </div>

          {/* Top Tools & Recent AI Logs */}
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="overflow-hidden">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {isId ? "Tool Terbanyak Dipanggil AI" : "Top Tools Invoked by AI"}
                </h3>
              </div>
              {(data?.top_tools ?? []).length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  {isId ? "Belum ada panggilan tool oleh AI." : "No AI tool invocations yet."}
                </p>
              ) : (
                <ul className="divide-y divide-border font-mono text-xs">
                  {(data?.top_tools ?? []).map((item) => (
                    <li key={item.tool_name} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-foreground">{item.tool_name}</span>
                      <Badge tone="brand">{item.calls}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="overflow-hidden lg:col-span-2">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {isId ? "Log Audit CoinTrac AI Terbaru" : "Recent CoinTrac AI Audit Logs"}
                </h3>
              </div>
              {(data?.recent_logs ?? []).length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">
                  {isId ? "Belum ada aktivitas AI." : "No AI logs yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                        <th className="px-4 py-2.5">User</th>
                        <th className="px-4 py-2.5">Prompt</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5 text-right">Tokens</th>
                        <th className="px-4 py-2.5 text-right">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono tabular-nums">
                      {(data?.recent_logs ?? []).map((log) => (
                        <tr key={log.id} className="hover:bg-muted/40">
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {log.user_email ?? log.user_id.slice(0, 8)}
                          </td>
                          <td className="max-w-[240px] truncate px-4 py-2.5 font-sans text-foreground">
                            {log.prompt_summary || "—"}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge
                              tone={
                                log.status === "OK"
                                  ? "positive"
                                  : log.status === "CACHED"
                                    ? "info"
                                    : "warning"
                              }
                            >
                              {log.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right text-foreground">
                            {log.total_tokens.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">
                            {log.latency_ms} ms
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </div>
      ) : null}

      {/* TAB 2: Global Runtime Config & Muse API Key */}
      {tab === "config" ? (
        <Card className="ct-surface-featured space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <KeyRound className="h-4 w-4 text-link" aria-hidden="true" />
                <span>{isId ? "Konfigurasi Muse Spark 1.3 & Limit Global" : "Muse Spark 1.3 Runtime & Global Limits"}</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                {config?.api_key_configured
                  ? `API Key Active (${config.api_key_source.toUpperCase()}) · ${config.api_key_hint ?? "***"}`
                  : isId
                    ? "Belum ada API key Muse yang aktif."
                    : "No Muse API key currently configured."}
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2 text-xs font-semibold text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>{enabled ? (isId ? "CoinTrac AI Aktif" : "CoinTrac AI Enabled") : isId ? "Dijeda Global" : "Globally Paused"}</span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-medium text-muted-foreground">
              Model ID
              <input className={INPUT} value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Muse Base URL
              <input className={INPUT} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Set / Ganti Muse API Key (Write-Only)" : "Set / Replace Muse API Key (Write-Only)"}
              <input
                type="password"
                autoComplete="off"
                className={INPUT}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={config?.api_key_hint ?? "Paste dev.meta.ai API key..."}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Default Rate Limit (req / mnt / user)" : "Default Rate Limit (req / min / user)"}
              <input
                type="number"
                min={1}
                max={240}
                className={INPUT}
                value={rateMin}
                onChange={(e) => setRateMin(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Default Kuota Harian (req / user)" : "Default Daily Quota (req / user)"}
              <input
                type="number"
                min={1}
                max={10000}
                className={INPUT}
                value={dailyReq}
                onChange={(e) => setDailyReq(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Default Token Harian / user" : "Default Daily Tokens / user"}
              <input
                type="number"
                min={1000}
                max={10000000}
                className={INPUT}
                value={dailyTok}
                onChange={(e) => setDailyTok(e.target.value)}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              Max Tool Rounds (1–8)
              <input
                type="number"
                min={1}
                max={8}
                className={INPUT}
                value={maxRounds}
                onChange={(e) => setMaxRounds(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Max Output Tokens (128–4096)
              <input
                type="number"
                min={128}
                max={4096}
                className={INPUT}
                value={maxOutputTok}
                onChange={(e) => setMaxOutputTok(e.target.value)}
              />
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Cache TTL (seconds) · Temp ({temperature})
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={0}
                  max={3600}
                  className={INPUT}
                  value={cacheTtl}
                  onChange={(e) => setCacheTtl(e.target.value)}
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className={INPUT}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                />
              </div>
            </label>
          </div>

          <label className="block text-xs font-medium text-muted-foreground">
            {isId ? "Instruksi Tambahan Super Admin (Opsional)" : "Super Admin System Directive (Optional)"}
            <textarea
              rows={3}
              className={INPUT}
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder={
                isId
                  ? "Contoh: Selalu tampilkan perbandingan 7d vs BTC jika user menanyakan altcoin."
                  : "Example: Always highlight 7d RS vs BTC when analyzing altcoins."
              }
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            {config?.api_key_source === "db" ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={savingConfig}
                onClick={() => void handleSaveConfig(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isId ? "Hapus Key DB (Pakai .env)" : "Clear DB Key (Fallback .env)"}</span>
              </Button>
            ) : (
              <span />
            )}

            <Button
              type="button"
              variant="primary"
              size="md"
              loading={savingConfig}
              onClick={() => void handleSaveConfig(false)}
              className="ct-btn-glow"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>{isId ? "Simpan Konfigurasi" : "Save Configuration"}</span>
            </Button>
          </div>
        </Card>
      ) : null}

      {/* TAB 3: Per-User Rate Limits & Platform Role */}
      {tab === "users" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground"
                aria-hidden="true"
              />
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={isId ? "Cari email atau user ID..." : "Search email or user ID..."}
                className="min-h-10 w-full rounded-[10px] border border-border bg-card py-2 pr-3 pl-9 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {filteredUsers.length} {isId ? "akun" : "accounts"}
            </span>
          </div>

          <div className="space-y-3">
            {filteredUsers.map((user) => {
              const draft = drafts[user.user_id];
              if (!draft) return null;
              const isBusy = busyUserId === user.user_id;
              return (
                <Card key={user.user_id} className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {user.email ?? user.user_id}
                        </span>
                        <Badge tone={user.platform_role === "super_admin" ? "brand" : "neutral"}>
                          {user.platform_role}
                        </Badge>
                      </div>
                      <p className="font-mono text-[11px] text-subtle-foreground">
                        {isId ? "Hari ini:" : "Today:"} {user.used_today_requests}/
                        {user.effective_daily_requests_limit} req ·{" "}
                        {user.used_today_tokens.toLocaleString()}/
                        {user.effective_daily_tokens_limit.toLocaleString()} tok · 30d Est: $
                        {user.estimated_cost_30d_usd.toFixed(4)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground">
                        <input
                          type="checkbox"
                          checked={draft.ai_enabled}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [user.user_id]: { ...draft, ai_enabled: e.target.checked },
                            }))
                          }
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span>AI On</span>
                      </label>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void handleToggleRole(user)}
                      >
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {user.platform_role === "super_admin" ? "Set User" : "Make Super Admin"}
                        </span>
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Req / min ({isId ? "kosong = default" : "blank = default"})
                      <input
                        type="number"
                        min={1}
                        max={240}
                        placeholder={String(config?.default_rate_limit_per_min ?? 10)}
                        className={INPUT}
                        value={draft.rate_limit_per_min}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, rate_limit_per_min: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Daily Requests
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        placeholder={String(config?.default_daily_requests ?? 50)}
                        className={INPUT}
                        value={draft.daily_requests_limit}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, daily_requests_limit: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Daily Tokens
                      <input
                        type="number"
                        min={1000}
                        max={10000000}
                        placeholder={String(config?.default_daily_tokens ?? 150000)}
                        className={INPUT}
                        value={draft.daily_tokens_limit}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, daily_tokens_limit: e.target.value },
                          }))
                        }
                      />
                    </label>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Admin Note
                      <input
                        className={INPUT}
                        value={draft.notes}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [user.user_id]: { ...draft, notes: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => void handleResetUserLimits(user.user_id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{isId ? "Reset Default" : "Reset"}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      loading={isBusy}
                      onClick={() => void handleSaveUserLimits(user)}
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{isId ? "Simpan Limit" : "Save Limits"}</span>
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
