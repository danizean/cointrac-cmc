"use client";

import {
  Activity,
  ChevronDown,
  ChevronUp,
  Coins,
  Gauge,
  Layers,
  RefreshCw,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import {
  BudgetStateBadge,
  QuotaProfileBadge,
  StatusIndicator,
} from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  InfoTip,
  PageHeader,
  SectionHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { KNOWN_BUDGET_STATES, presentBudgetState } from "@/lib/budget-state";
import {
  fetchCapabilities,
  fetchUsage,
  type CapabilitiesPayload,
  type UsagePayload,
} from "@/lib/control-plane-api";

type DateWindow = "7d" | "30d" | "all";

function formatUtcTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms.toLocaleString()} ms`;
}

function daysAgoUtc(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function capabilityTone(status: string): "positive" | "warning" | "neutral" {
  const normalized = status.toUpperCase();
  if (normalized === "OK" || normalized === "LIVE" || normalized === "AVAILABLE") {
    return "positive";
  }
  if (
    normalized === "TIER_RESTRICTED" ||
    normalized === "RESTRICTED" ||
    normalized === "FORBIDDEN"
  ) {
    return "warning";
  }
  return "neutral";
}

function ToolLabel({ name }: { name: string }) {
  if (name === "hidden_gem_scan") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono text-foreground">{name}</span>
        <Badge tone="brand">SCAN</Badge>
      </span>
    );
  }
  return <span className="font-mono text-foreground">{name}</span>;
}

export function UsageConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [capLoading, setCapLoading] = useState(false);
  const [usageError, setUsageError] = useState<{ status: number; message: string } | null>(null);
  const [capError, setCapError] = useState<{ status: number; message: string } | null>(null);
  const [windowFilter, setWindowFilter] = useState<DateWindow>("30d");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const loadCapabilities = useCallback(async () => {
    setCapLoading(true);
    setCapError(null);
    const capRes = await fetchCapabilities();
    setCapLoading(false);
    if (capRes.ok) {
      setCapabilities(capRes.data);
    } else {
      setCapabilities(null);
      setCapError({ status: capRes.status, message: capRes.message });
    }
    return capRes.ok;
  }, []);

  const loadUsage = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);
      setUsageError(null);

      const [usageRes, capOk] = await Promise.all([
        fetchUsage(),
        diagnosticsOpen ? loadCapabilities() : Promise.resolve(true),
      ]);
      setLoading(false);
      setRefreshing(false);

      if (usageRes.ok) {
        setUsage(usageRes.data);
      } else {
        setUsage(null);
        setUsageError({ status: usageRes.status, message: usageRes.message });
      }

      if (isManual) {
        if (!usageRes.ok || !capOk) {
          pushToast(
            isId
              ? "Pembaruan telemetri selesai dengan status terdegradasi."
              : "Usage telemetry check completed with degraded status.",
            "info",
          );
        } else {
          pushToast(
            isId ? "Telemetri penggunaan diperbarui." : "Usage telemetry refreshed.",
            "success",
          );
        }
      }
    },
    [diagnosticsOpen, isId, loadCapabilities, pushToast],
  );

  useEffect(() => {
    let active = true;
    void fetchUsage().then((usageRes) => {
      if (!active) return;
      setLoading(false);
      if (usageRes.ok) {
        setUsage(usageRes.data);
      } else {
        setUsageError({ status: usageRes.status, message: usageRes.message });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleToggleDiagnostics = () => {
    const next = !diagnosticsOpen;
    setDiagnosticsOpen(next);
    if (next && capabilities === null && !capLoading) {
      void loadCapabilities();
    }
  };

  const filteredDaily = useMemo(() => {
    const rows = usage?.daily_usage ?? [];
    if (windowFilter === "all") return rows;
    const cutoff = daysAgoUtc(windowFilter === "7d" ? 7 : 30);
    return rows.filter((row) => row.date_utc >= cutoff);
  }, [usage, windowFilter]);

  const filteredRequests = useMemo(() => {
    const rows = usage?.recent_requests ?? [];
    if (windowFilter === "all") return rows;
    const cutoff = daysAgoUtc(windowFilter === "7d" ? 7 : 30);
    return rows.filter((row) => row.created_at.slice(0, 10) >= cutoff);
  }, [usage, windowFilter]);

  const quota = usage?.tool_quota ?? null;
  const credits = usage?.cmc_credits ?? null;
  const serverMode = usage?.server_mode ?? null;
  const probeRows = capabilities?.results ?? [];

  const budget = presentBudgetState(serverMode?.budget_state);
  const creditUtilizationPct =
    credits && credits.monthly_allowance !== null && credits.monthly_allowance > 0
      ? Math.min(100, Math.round((credits.credits_this_month / credits.monthly_allowance) * 100))
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isId ? "Penggunaan & Kredit" : "Usage & Credits"}
        description={
          isId
            ? "Pemakaian kredit CoinMarketCap (termasuk Hidden Gem scan & tool calls) dan kuota API CoinTrac akun Anda."
            : "Account-scoped CoinMarketCap credit spend (including Hidden Gem scans & tool calls) and CoinTrac API quota."
        }
        actions={
          <Button
            variant="primary"
            size="md"
            loading={refreshing}
            onClick={() => void loadUsage(true)}
            className="ct-btn-glow"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />

      {usageError ? (
        <ErrorNotice
          status={usageError.status}
          message={usageError.message}
          onRetry={() => void loadUsage(true)}
        />
      ) : null}

      {/* Executive 4-Card KPI Strip */}
      <section
        aria-label={isId ? "Ringkasan kuota dan kredit" : "Quota and credit overview"}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {/* KPI 1: Attributed CMC Credits */}
        <Card className="ct-surface-featured flex flex-col justify-between gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Coins className="h-4 w-4 text-link" aria-hidden="true" />
              <span>{isId ? "Kredit CMC Bulan Ini" : "CMC Credits This Month"}</span>
            </span>
            <InfoTip
              label="About CMC credits"
              text="Tracks uncached upstream CoinMarketCap credits across tool calls and Hidden Gem discovery scans for your account. Cache hits spend 0 credits."
            />
          </div>

          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {credits ? credits.credits_this_month.toLocaleString() : "—"}
                </p>
                <span className="font-mono text-[11px] text-subtle-foreground">
                  {credits?.billing_month_utc ?? "UTC"}
                </span>
              </div>

              {creditUtilizationPct !== null && credits?.monthly_allowance !== null ? (
                <div className="space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${
                        creditUtilizationPct >= 85
                          ? "bg-destructive"
                          : creditUtilizationPct >= 65
                            ? "bg-warning"
                            : "bg-primary"
                      }`}
                      style={{ width: `${creditUtilizationPct}%` }}
                    />
                  </div>
                  <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {credits?.remaining_credits !== null && credits?.remaining_credits !== undefined
                      ? `${credits.remaining_credits.toLocaleString()} / ${credits.monthly_allowance.toLocaleString()} ${isId ? "tersisa" : "left"}`
                      : `${creditUtilizationPct}% ${isId ? "terpakai" : "used"}`}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {isId
                    ? "Mencakup panggilan API & Hidden Gem scan."
                    : "Includes API tool calls & Hidden Gem scans."}
                </p>
              )}
            </div>
          )}
        </Card>

        {/* KPI 2: CoinTrac API Quota */}
        <Card className="flex flex-col justify-between gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Activity className="h-4 w-4 text-link" aria-hidden="true" />
              <span>{isId ? "Panggilan CoinTrac" : "CoinTrac API Calls"}</span>
            </span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : (
              <Badge tone="brand">{quota ? `${quota.active_tier.toUpperCase()}` : "—"}</Badge>
            )}
          </div>

          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <p className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                  {quota ? quota.calls_last_24h.toLocaleString() : "—"}
                </p>
                <span className="font-mono text-xs text-muted-foreground">
                  24h · {quota ? `${quota.calls_last_30d.toLocaleString()} (30d)` : "—"}
                </span>
              </div>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {quota
                  ? `MCP ${quota.calls_by_surface.mcp} · REST ${quota.calls_by_surface.rest} · UI ${quota.calls_by_surface.playground}`
                  : "—"}
              </p>
              <p className="font-mono text-[11px] text-subtle-foreground">
                {quota
                  ? `${quota.rate_limit_per_min} req/${quota.window_seconds}s${
                      quota.daily_quota_limit !== null
                        ? ` · ${quota.daily_quota_limit.toLocaleString()}/d cap`
                        : ""
                    }`
                  : "—"}
              </p>
            </div>
          )}
        </Card>

        {/* KPI 3: Cache Efficiency & Latency */}
        <Card className="flex flex-col justify-between gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Zap className="h-4 w-4 text-positive" aria-hidden="true" />
              <span>{isId ? "Efisiensi Cache & Latensi" : "Cache Hit & Latency"}</span>
            </span>
          </div>

          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-baseline gap-2">
                <p className="font-mono text-2xl font-semibold tabular-nums text-positive">
                  {credits && credits.cache_hit_rate_pct !== null
                    ? `${credits.cache_hit_rate_pct}%`
                    : "—"}
                </p>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  ·{" "}
                  {credits && credits.average_latency_ms !== null
                    ? formatLatency(Math.round(credits.average_latency_ms))
                    : "—"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {isId
                  ? "Respon cache menghemat biaya & memakai 0 kredit CMC."
                  : "Cache hits preserve upstream budget with 0 CMC credit cost."}
              </p>
            </div>
          )}
        </Card>

        {/* KPI 4: Upstream Governance & Deep Scan */}
        <Card className="flex flex-col justify-between gap-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <Gauge className="h-4 w-4 text-link" aria-hidden="true" />
              <span>{isId ? "Status Anggaran & Scan" : "Budget & Deep Scan"}</span>
            </span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : (
              <BudgetStateBadge state={serverMode?.budget_state} />
            )}
          </div>

          {loading ? (
            <Skeleton className="h-14 w-full" />
          ) : (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {serverMode?.deep_scan_available === true ? (
                  <StatusIndicator state="CONNECTED" label="DEEP SCAN READY" />
                ) : serverMode?.deep_scan_available === false ? (
                  <StatusIndicator state="STANDBY" label="DEEP SCAN CONSERVED" />
                ) : (
                  <StatusIndicator state="UNVERIFIED" label="—" />
                )}
                <QuotaProfileBadge profile={serverMode?.effective_profile} />
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{budget.description}</p>
            </div>
          )}
        </Card>
      </section>

      {/* Primary Work Area: Credit & Activity Ledger */}
      <section aria-labelledby="usage-history-heading" className="space-y-4">
        <SectionHeader
          id="usage-history-heading"
          title={isId ? "Buku besar aktivitas & kredit" : "Activity & credit ledger"}
          description={
            isId
              ? "Riwayat permintaan API dan Hidden Gem scan terverifikasi untuk akun ini."
              : "Verified API calls and Hidden Gem discovery scans attributed to your account."
          }
          action={
            <div
              role="group"
              aria-label="Filter retrieved usage logs by window"
              className="inline-flex h-9 items-center rounded-full border border-border bg-card/80 p-0.5"
            >
              {(
                [
                  { value: "7d", label: "7d" },
                  { value: "30d", label: "30d" },
                  { value: "all", label: isId ? "Semua" : "All" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={windowFilter === opt.value}
                  onClick={() => setWindowFilter(opt.value)}
                  className={`min-h-7 cursor-pointer rounded-full px-3 font-mono text-[11px] font-semibold transition-colors ${
                    windowFilter === opt.value
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="grid gap-5 lg:grid-cols-5">
          {/* Per-Tool & Scan Breakdown */}
          <Card className="overflow-hidden lg:col-span-3">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {isId ? "Konsumsi per tool & scan" : "Usage by tool & scan"}
              </h3>
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : usageError ? (
              <p className="p-4 text-xs text-muted-foreground">
                {isId
                  ? "Rincian tool tidak tersedia saat telemetri terganggu."
                  : "Tool breakdown unavailable while telemetry endpoint is in standby."}
              </p>
            ) : (usage?.tool_breakdown ?? []).length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {isId
                  ? "Belum ada eksekusi tool atau scan untuk akun ini."
                  : "No tool calls or Hidden Gem scans recorded yet."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">{isId ? "Tool / Scan" : "Tool / Scan"}</th>
                      <th className="px-4 py-2.5 text-right">{isId ? "Jumlah" : "Runs"}</th>
                      <th className="px-4 py-2.5 text-right">Cache</th>
                      <th className="px-4 py-2.5 text-right">{isId ? "Kredit CMC" : "CMC credits"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {(usage?.tool_breakdown ?? []).map((row) => (
                      <tr key={row.tool_name} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <ToolLabel name={row.tool_name} />
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">{row.calls}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {row.cache_hits}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {row.cmc_credits.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Daily Totals */}
          <Card className="overflow-hidden lg:col-span-2">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {isId ? "Ringkasan harian (UTC)" : "Daily totals (UTC)"}
              </h3>
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : usageError ? (
              <p className="p-4 text-xs text-muted-foreground">
                {isId
                  ? "Aktivitas harian tidak tersedia."
                  : "Daily activity unavailable while telemetry endpoint is in standby."}
              </p>
            ) : filteredDaily.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">
                {isId
                  ? "Belum ada aktivitas di rentang tanggal ini."
                  : "No recorded activity in this window."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5 text-right">Runs</th>
                      <th className="px-4 py-2.5 text-right">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {filteredDaily.map((row) => (
                      <tr key={row.date_utc} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-foreground">{row.date_utc}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.calls}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {row.cmc_credits.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Recent Requests & Scans */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              {isId ? "Aktivitas terbaru (maks. 25)" : "Recent requests & scans (latest 25)"}
            </h3>
            <span className="font-mono text-[11px] text-subtle-foreground">
              {filteredRequests.length} {isId ? "entri" : "entries"}
            </span>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : usageError ? (
            <p className="p-4 text-xs text-muted-foreground">
              {isId
                ? "Riwayat permintaan tidak tersedia."
                : "Recent requests unavailable while telemetry endpoint is in standby."}
            </p>
          ) : filteredRequests.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                title={isId ? "Belum ada aktivitas di jendela ini" : "No activity in this window"}
                description={
                  isId
                    ? "Jalankan Hidden Gem scan atau tool Market Intelligence untuk melihat konsumsi kredit dan bukti audit di sini."
                    : "Run a Hidden Gem scan or Market Intelligence tool to see per-request latency, credit cost, and audit links here."
                }
              />
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">Timestamp (UTC)</th>
                      <th className="px-4 py-2.5">Tool / Scan</th>
                      <th className="px-4 py-2.5">Surface</th>
                      <th className="px-4 py-2.5">Cache</th>
                      <th className="px-4 py-2.5 text-right">Duration</th>
                      <th className="px-4 py-2.5 text-right">CMC credits</th>
                      <th className="px-4 py-2.5">Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {filteredRequests.map((req, idx) => (
                      <tr key={`${req.created_at}-${req.tool_name}-${idx}`} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {formatUtcTimestamp(req.created_at)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <ToolLabel name={req.tool_name} />
                            {req.status_code !== 200 && req.status_code !== 0 ? (
                              <Badge tone={req.status_code >= 500 ? "warning" : "neutral"}>
                                {req.status_code === 499 ? "CANCELLED" : req.status_code}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 uppercase text-muted-foreground">{req.surface}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={req.cache_hit ? "info" : "neutral"}>
                            {req.cache_hit ? "CACHED" : "LIVE"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {formatLatency(req.latency_ms)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                          {req.credit_cost.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          {req.evidence_id ? (
                            <Link
                              href={`/app/evidence?id=${encodeURIComponent(req.evidence_id)}`}
                              className="inline-flex min-h-8 items-center font-semibold text-link hover:underline"
                            >
                              {req.evidence_id}
                            </Link>
                          ) : (
                            <span className="text-subtle-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-border md:hidden">
                {filteredRequests.map((req, idx) => (
                  <li key={`${req.created_at}-${req.tool_name}-${idx}`} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <ToolLabel name={req.tool_name} />
                      <Badge tone={req.cache_hit ? "info" : "neutral"}>
                        {req.cache_hit ? "CACHED" : "LIVE"}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-subtle-foreground">
                      {formatUtcTimestamp(req.created_at)} · {req.surface.toUpperCase()} ·{" "}
                      {formatLatency(req.latency_ms)} · {req.credit_cost.toLocaleString()} CMC credit
                      {req.credit_cost === 1 ? "" : "s"}
                    </p>
                    {req.evidence_id ? (
                      <Link
                        href={`/app/evidence?id=${encodeURIComponent(req.evidence_id)}`}
                        className="inline-flex min-h-11 items-center font-mono text-xs font-semibold text-link hover:underline"
                      >
                        Inspect {req.evidence_id}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      {/* Secondary Collapsible Drawer: Upstream Diagnostics & Budget Thresholds */}
      <Card className="overflow-hidden">
        <button
          type="button"
          aria-expanded={diagnosticsOpen}
          onClick={handleToggleDiagnostics}
          className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/30"
        >
          <div className="space-y-0.5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers className="h-4 w-4 text-link" aria-hidden="true" />
              <span>
                {isId
                  ? "Diagnostik Upstream & Matriks Endpoint CMC"
                  : "Upstream Diagnostics & CMC Endpoint Matrix"}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">
              {isId
                ? "Tahapan tata kelola anggaran kredit server & status akses endpoint CoinMarketCap."
                : "Server budget governance stages and cached CoinMarketCap endpoint capability disclosures."}
            </p>
          </div>
          {diagnosticsOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
        </button>

        {diagnosticsOpen ? (
          <div className="space-y-5 border-t border-border p-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Tahapan status anggaran server" : "Server budget governance stages"}
                </p>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {isId ? "Tier terdeteksi:" : "Detected tier:"}{" "}
                  <strong className="uppercase text-foreground">
                    {serverMode?.detected_tier ?? "—"}
                  </strong>
                </span>
              </div>
              <div
                className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5"
                aria-label="Budget governance stages"
              >
                {KNOWN_BUDGET_STATES.map((stage) => {
                  const stagePresentation = presentBudgetState(stage);
                  const isCurrent = budget.code === stage;
                  const activeClass =
                    stagePresentation.visual === "NORMAL"
                      ? "border-positive/45 bg-positive-soft text-positive"
                      : stagePresentation.visual === "ELEVATED"
                        ? "border-info/45 bg-info-soft text-info"
                        : stagePresentation.visual === "CONSERVATION"
                          ? "border-warning/45 bg-warning-soft text-warning"
                          : stagePresentation.visual === "EMERGENCY"
                            ? "border-destructive/45 bg-destructive-soft text-destructive"
                            : "border-destructive bg-destructive text-destructive-foreground";
                  return (
                    <div
                      key={stage}
                      className={`rounded-[8px] border px-2 py-1.5 text-center font-mono text-[10px] font-semibold ${
                        isCurrent
                          ? activeClass
                          : "border-border bg-background/50 text-subtle-foreground"
                      }`}
                    >
                      {stage}
                    </div>
                  );
                })}
              </div>
              {serverMode?.deep_scan_reason ? (
                <p className="text-xs text-muted-foreground">{serverMode.deep_scan_reason}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Kemampuan endpoint CoinMarketCap" : "CoinMarketCap endpoint capabilities"}
              </p>

              {capLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : capError ? (
                <ErrorNotice
                  status={capError.status}
                  message={capError.message}
                  onRetry={() => void loadCapabilities()}
                />
              ) : probeRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {isId
                    ? "Belum ada laporan probe kapabilitas upstream yang tersimpan di cache."
                    : "No cached upstream capability probe report is currently available."}
                </p>
              ) : (
                <>
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                          <th className="px-3 py-2">CoinMarketCap endpoint</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 text-right">HTTP</th>
                          <th className="px-3 py-2 text-right">CMC code</th>
                          <th className="px-3 py-2 text-right">Credit cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border font-mono tabular-nums">
                        {probeRows.map((row) => (
                          <tr key={row.endpoint} className="hover:bg-muted/40">
                            <td className="px-3 py-2 text-foreground">{row.endpoint}</td>
                            <td className="px-3 py-2">
                              <Badge tone={capabilityTone(row.status)}>
                                {row.status.replaceAll("_", " ")}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                              {row.http_status}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                              {row.cmc_error_code ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right text-foreground">
                              {row.credit_count}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <ul className="divide-y divide-border md:hidden">
                    {probeRows.map((row) => (
                      <li key={row.endpoint} className="space-y-1.5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="break-all font-mono text-xs text-foreground">
                            {row.endpoint}
                          </span>
                          <Badge tone={capabilityTone(row.status)}>
                            {row.status.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <p className="font-mono text-[11px] text-subtle-foreground">
                          HTTP {row.http_status} · CMC {row.cmc_error_code ?? "—"} ·{" "}
                          {row.credit_count} credit{row.credit_count === 1 ? "" : "s"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
