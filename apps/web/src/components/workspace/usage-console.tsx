"use client";

import { Activity, Coins, Layers, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusIndicator } from "@/components/status-badges";
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

export function UsageConsole() {
  const { pushToast } = useToast();

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [usageError, setUsageError] = useState<{ status: number; message: string } | null>(null);
  const [capError, setCapError] = useState<{ status: number; message: string } | null>(null);
  const [windowFilter, setWindowFilter] = useState<DateWindow>("30d");

  const loadAll = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);
      setUsageError(null);
      setCapError(null);

      const [usageRes, capRes] = await Promise.all([fetchUsage(), fetchCapabilities()]);
      setLoading(false);
      setRefreshing(false);

      if (usageRes.ok) {
        setUsage(usageRes.data);
      } else {
        setUsage(null);
        setUsageError({ status: usageRes.status, message: usageRes.message });
      }
      if (capRes.ok) {
        setCapabilities(capRes.data);
      } else {
        setCapabilities(null);
        setCapError({ status: capRes.status, message: capRes.message });
      }

      if (isManual) {
        if (!usageRes.ok || !capRes.ok) {
          pushToast("Usage refresh completed with errors.", "error");
        } else {
          pushToast("Usage telemetry refreshed.", "info");
        }
      }
    },
    [pushToast],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [usageRes, capRes] = await Promise.all([fetchUsage(), fetchCapabilities()]);
      if (!active) return;
      setLoading(false);
      if (usageRes.ok) {
        setUsage(usageRes.data);
      } else {
        setUsageError({ status: usageRes.status, message: usageRes.message });
      }
      if (capRes.ok) {
        setCapabilities(capRes.data);
      } else {
        setCapError({ status: capRes.status, message: capRes.message });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
  const probeRows = capabilities?.results ?? [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Usage & Limits"
        description="Monitor CoinTrac tool consumption and upstream data-provider usage separately."
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={refreshing}
            onClick={() => void loadAll(true)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        }
      />

      {usageError ? (
        <ErrorNotice
          status={usageError.status}
          message={usageError.message}
          onRetry={() => void loadAll(true)}
        />
      ) : null}

      {/* Strictly Separated Top-Level Sections: CoinTrac Usage vs CoinMarketCap Credits */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Section 1: CoinTrac Usage */}
        <Card className="flex flex-col justify-between space-y-4 p-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-link" aria-hidden="true" />
                <h2 className="text-base font-semibold text-foreground">CoinTrac Usage</h2>
                <InfoTip
                  label="About CoinTrac application quota"
                  text="Tracks requests processed by CoinTrac across MCP, REST, and Playground under your verified account. All API keys you create share this single account rate window."
                />
              </div>
              {loading ? (
                <StatusIndicator state="LOADING" />
              ) : usageError ? (
                <StatusIndicator state="ERROR" />
              ) : (
                <Badge tone="brand">
                  {quota ? `${quota.active_tier.toUpperCase()} TIER` : "UNAVAILABLE"}
                </Badge>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Application-level tool quota enforced by CoinTrac per account. Separate from upstream
              CoinMarketCap plan billing.
            </p>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Rate limit window
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {quota
                    ? `${quota.rate_limit_per_min} req / ${quota.window_seconds}s`
                    : "Unavailable"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Calls (24h / 30d)
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {quota ? `${quota.calls_last_24h} / ${quota.calls_last_30d}` : "Unavailable"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Daily quota limit
                </p>
                <p className="mt-1 font-mono text-xs font-medium text-foreground">
                  {!quota
                    ? "Unavailable"
                    : quota.daily_quota_limit !== null
                      ? `${quota.daily_quota_limit} calls / day`
                      : "No daily cap returned"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Calls by surface
                </p>
                {quota ? (
                  <p className="mt-1 font-mono text-xs tabular-nums text-foreground">
                    MCP {quota.calls_by_surface.mcp} · REST {quota.calls_by_surface.rest} · UI{" "}
                    {quota.calls_by_surface.playground}
                  </p>
                ) : (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">Unavailable</p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Section 2: CoinMarketCap API Credits */}
        <Card className="flex flex-col justify-between space-y-4 p-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-link" aria-hidden="true" />
                <h2 className="text-base font-semibold text-foreground">
                  CoinMarketCap API Credits
                </h2>
                <InfoTip
                  label="About upstream CoinMarketCap credits"
                  text="CoinMarketCap credits are upstream data-provider consumption tracked separately from your CoinTrac quota. CoinTrac does not own, control, or reset CoinMarketCap credits. Consult your CoinMarketCap developer dashboard for authoritative billing."
                />
              </div>
              <Badge tone="neutral">UPSTREAM PROVIDER</Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Estimated upstream CoinMarketCap credit cost attributed to your account&apos;s uncached
              calls in{" "}
              <span className="font-mono text-foreground">
                {credits?.billing_month_utc ?? "current UTC month"}
              </span>
              . Cached responses consume 0 upstream credits. Consult your CoinMarketCap account for
              authoritative plan billing.
            </p>
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Attributed this month
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {credits ? `${credits.credits_this_month} credits` : "Unavailable"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Plan allowance / left
                </p>
                <p className="mt-1 font-mono text-xs font-medium text-muted-foreground">
                  {credits && credits.monthly_allowance !== null
                    ? `${credits.monthly_allowance} (${credits.remaining_credits ?? "—"} remaining)`
                    : "Unavailable"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Cache hit rate
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {credits && credits.cache_hit_rate_pct !== null
                    ? `${credits.cache_hit_rate_pct}%`
                    : "Unavailable"}
                </p>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Average latency
                </p>
                <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                  {credits && credits.average_latency_ms !== null
                    ? `${credits.average_latency_ms} ms`
                    : "Unavailable"}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Section 3: Account Activity Breakdown */}
      <section aria-labelledby="usage-history-heading" className="space-y-4">
        <SectionHeader
          id="usage-history-heading"
          title="Activity breakdown"
          description="Client-side date filter over retrieved account logs (backend returns up to 1,000 recent request logs)."
          action={
            <div
              role="group"
              aria-label="Filter retrieved usage logs by window"
              className="inline-flex rounded-[10px] border border-border bg-card p-1"
            >
              {(
                [
                  { value: "7d", label: "7d" },
                  { value: "30d", label: "30d" },
                  { value: "all", label: "All retrieved" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={windowFilter === opt.value}
                  onClick={() => setWindowFilter(opt.value)}
                  className={`min-h-8 cursor-pointer rounded-[8px] px-3 font-mono text-xs font-semibold transition-colors ${
                    windowFilter === opt.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          }
        />

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Daily Totals */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Daily activity (UTC)</h3>
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : usageError ? (
              <p className="p-4 text-xs text-muted-foreground">
                Daily activity unavailable while telemetry endpoint is unreachable.
              </p>
            ) : filteredDaily.length === 0 ? (
              <p className="p-5 text-center text-xs text-muted-foreground">
                No recorded tool calls in this window yet (0 calls).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">Date (UTC)</th>
                      <th className="px-4 py-2.5 text-right">Calls</th>
                      <th className="px-4 py-2.5 text-right">Cache hits</th>
                      <th className="px-4 py-2.5 text-right">CMC credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {filteredDaily.map((row) => (
                      <tr key={row.date_utc} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-foreground">{row.date_utc}</td>
                        <td className="px-4 py-2.5 text-right text-foreground">{row.calls}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {row.cache_hits}
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {row.cmc_credits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Per-Tool Breakdown */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">Per-tool breakdown</h3>
            </div>
            {loading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : usageError ? (
              <p className="p-4 text-xs text-muted-foreground">
                Tool breakdown unavailable while telemetry endpoint is unreachable.
              </p>
            ) : (usage?.tool_breakdown ?? []).length === 0 ? (
              <p className="p-5 text-center text-xs text-muted-foreground">
                No tool executions recorded for this account yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">Tool</th>
                      <th className="px-4 py-2.5 text-right">Calls</th>
                      <th className="px-4 py-2.5 text-right">Cache hits</th>
                      <th className="px-4 py-2.5 text-right">CMC credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {(usage?.tool_breakdown ?? []).map((row) => (
                      <tr key={row.tool_name} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-foreground">{row.tool_name}</td>
                        <td className="px-4 py-2.5 text-right text-foreground">{row.calls}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {row.cache_hits}
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {row.cmc_credits}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Recent Requests */}
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              Recent requests (latest 25 retrieved)
            </h3>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : usageError ? (
            <p className="p-4 text-xs text-muted-foreground">
              Recent requests unavailable while telemetry endpoint is unreachable.
            </p>
          ) : filteredRequests.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                title="No requests recorded in this window"
                description="Run a Market Intelligence tool in the workspace or over MCP to see per-request latency, cache status, and evidence links here."
              />
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">Timestamp (UTC)</th>
                      <th className="px-4 py-2.5">Tool</th>
                      <th className="px-4 py-2.5">Surface</th>
                      <th className="px-4 py-2.5">Cache</th>
                      <th className="px-4 py-2.5 text-right">Latency</th>
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
                        <td className="px-4 py-2.5 text-foreground">{req.tool_name}</td>
                        <td className="px-4 py-2.5 uppercase text-muted-foreground">{req.surface}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={req.cache_hit ? "info" : "neutral"}>
                            {req.cache_hit ? "CACHED" : "UNCACHED"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {req.latency_ms} ms
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {req.credit_cost}
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
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {req.tool_name}
                      </span>
                      <Badge tone={req.cache_hit ? "info" : "neutral"}>
                        {req.cache_hit ? "CACHED" : "UNCACHED"}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-subtle-foreground">
                      {formatUtcTimestamp(req.created_at)} · {req.surface.toUpperCase()} ·{" "}
                      {req.latency_ms} ms · {req.credit_cost} CMC credit
                      {req.credit_cost === 1 ? "" : "s"}
                    </p>
                    {req.evidence_id ? (
                      <Link
                        href={`/app/evidence?id=${encodeURIComponent(req.evidence_id)}`}
                        className="inline-flex min-h-8 items-center font-mono text-xs font-semibold text-link hover:underline"
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

      {/* Section 4: Upstream Endpoint Capability Matrix */}
      <section aria-labelledby="tier-transparency-heading" className="space-y-4">
        <SectionHeader
          id="tier-transparency-heading"
          title="CoinMarketCap endpoint capabilities & data modes"
          description="CoinTrac discloses LIVE, CACHED, SNAPSHOT, and TIER_RESTRICTED explicitly (for example, historical OHLCV returns HTTP 403 / CMC code 1006 on Basic plans)."
        />

        <Card className="overflow-hidden">
          {loading ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : capError ? (
            <div className="p-4">
              <ErrorNotice
                status={capError.status}
                message={capError.message}
                onRetry={() => void loadAll(true)}
              />
            </div>
          ) : probeRows.length === 0 ? (
            <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
              <Layers className="h-4 w-4 text-subtle-foreground" aria-hidden="true" />
              <span>No cached upstream capability probe report is currently available.</span>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2.5">CoinMarketCap endpoint</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">HTTP</th>
                      <th className="px-4 py-2.5 text-right">CMC code</th>
                      <th className="px-4 py-2.5 text-right">Credit cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {probeRows.map((row) => (
                      <tr key={row.endpoint} className="hover:bg-muted/40">
                        <td className="px-4 py-2.5 text-foreground">{row.endpoint}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={capabilityTone(row.status)}>
                            {row.status.replaceAll("_", " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {row.http_status}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {row.cmc_error_code ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">
                          {row.credit_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-border md:hidden">
                {probeRows.map((row) => (
                  <li key={row.endpoint} className="space-y-1.5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-all font-mono text-xs text-foreground">
                        {row.endpoint}
                      </span>
                      <Badge tone={capabilityTone(row.status)}>
                        {row.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-subtle-foreground">
                      HTTP {row.http_status} · CMC {row.cmc_error_code ?? "—"} · {row.credit_count}{" "}
                      credit{row.credit_count === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
