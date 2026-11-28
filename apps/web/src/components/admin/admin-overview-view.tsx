"use client";

import {
  Activity,
  ArrowRight,
  Cpu,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { StatusIndicator } from "@/components/status-badges";
import { Badge, Button, Card, ErrorNotice, PageHeader } from "@/components/ui/primitives";
import type { AdminDailySeriesPoint } from "@/lib/control-plane-api";
import { useAdminData } from "./admin-context";
import { AdminAccessBarrier } from "./admin-guard";

function formatShortDate(dateUtc: string, locale: "en" | "id"): string {
  const parts = dateUtc.split("-");
  if (parts.length !== 3) return dateUtc;
  const dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return dt.toLocaleDateString(locale === "id" ? "id-ID" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function DailyActivityChart({
  series,
  isId,
  locale,
}: {
  series: AdminDailySeriesPoint[];
  isId: boolean;
  locale: "en" | "id";
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const maxRequests = useMemo(
    () => Math.max(1, ...series.map((d) => d.requests + d.rate_limited + d.errors)),
    [series],
  );
  const activeIdx = hoveredIdx ?? (series.length > 0 ? series.length - 1 : null);
  const activePoint = activeIdx !== null ? series[activeIdx] ?? null : null;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {isId ? "Tren Permintaan & Efisiensi Cache (14 Hari UTC)" : "14-Day Request & Cache Trend (UTC)"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isId
              ? "Perbandingan permintaan live AI, cache hit hemat token, dan blokir rate-limit harian."
              : "Live Muse Spark calls vs zero-token cache hits and rate-limit / error events."}
          </p>
        </div>

        {activePoint ? (
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-background/70 px-3 py-1.5 font-mono text-[11px]">
            <span className="font-semibold text-foreground">
              {formatShortDate(activePoint.date_utc, locale)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-link">{activePoint.requests} req</span>
            <span className="text-positive">{activePoint.cached} cached</span>
            {activePoint.rate_limited > 0 ? (
              <span className="text-warning">{activePoint.rate_limited} 429</span>
            ) : null}
            <span className="text-muted-foreground">
              {activePoint.tokens.toLocaleString()} tok (${activePoint.estimated_cost_usd.toFixed(4)})
            </span>
          </div>
        ) : null}
      </div>

      <div className="mt-5">
        <div
          className="grid h-44 items-end gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, series.length)}, minmax(0, 1fr))` }}
          role="img"
          aria-label={isId ? "Grafik permintaan AI 14 hari terakhir" : "14-day AI requests bar chart"}
        >
          {series.map((point, idx) => {
            const totalEvents = point.requests + point.rate_limited + point.errors;
            const liveNonCached = Math.max(0, point.requests - point.cached);
            const totalPct = Math.max(totalEvents > 0 ? 8 : 3, Math.round((totalEvents / maxRequests) * 100));
            const cachedPct = totalEvents > 0 ? Math.round((point.cached / totalEvents) * 100) : 0;
            const livePct = totalEvents > 0 ? Math.round((liveNonCached / totalEvents) * 100) : 0;
            const warnPct = Math.max(0, 100 - cachedPct - livePct);
            const isSelected = activeIdx === idx;

            return (
              <button
                key={point.date_utc}
                type="button"
                onMouseEnter={() => setHoveredIdx(idx)}
                onFocus={() => setHoveredIdx(idx)}
                onClick={() => setHoveredIdx(idx)}
                aria-label={`${point.date_utc}: ${point.requests} requests, ${point.cached} cached`}
                className="group flex h-full cursor-pointer flex-col items-center justify-end gap-1.5 focus:outline-none"
              >
                <div className="flex w-full flex-1 items-end justify-center">
                  <div
                    className={`flex w-full max-w-[26px] flex-col-reverse overflow-hidden rounded-t-[6px] border transition-all ${
                      totalEvents === 0
                        ? "border-border/50 bg-muted/40"
                        : isSelected
                          ? "border-primary bg-primary/10 ring-2 ring-primary/25"
                          : "border-border bg-muted/60 group-hover:border-primary/50"
                    }`}
                    style={{ height: `${totalPct}%` }}
                  >
                    {totalEvents > 0 ? (
                      <>
                        {livePct > 0 ? (
                          <div
                            className="w-full bg-primary"
                            style={{ height: `${livePct}%` }}
                          />
                        ) : null}
                        {cachedPct > 0 ? (
                          <div
                            className="w-full bg-positive"
                            style={{ height: `${cachedPct}%` }}
                          />
                        ) : null}
                        {warnPct > 0 ? (
                          <div
                            className="w-full bg-warning"
                            style={{ height: `${warnPct}%` }}
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
                <span
                  className={`font-mono text-[10px] ${
                    isSelected ? "font-semibold text-foreground" : "text-subtle-foreground"
                  }`}
                >
                  {point.date_utc.slice(8)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
            {isId ? "Panggilan Muse Live" : "Live Muse Calls"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-positive" />
            {isId ? "Cache Hit (0 Token)" : "Cache Hit (0 Tokens)"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-warning" />
            {isId ? "Rate Limit / Error" : "Rate Limit / Error"}
          </span>
        </div>
      </div>
    </Card>
  );
}

export function AdminOverviewView() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { data, loading, refreshing, error, refresh } = useAdminData();

  const title = isId ? "Ringkasan Eksekutif" : "Executive Overview";
  const description = isId
    ? "Kendali terpusat performa CoinTrac AI, konsumsi token Muse Spark 1.3, kepatuhan kuota user, dan kesehatan runtime."
    : "Centralized governance for CoinTrac AI performance, Muse Spark 1.3 token spend, user quota health, and runtime status.";

  if ((loading && !data) || (error && !data)) {
    return <AdminAccessBarrier title={title} description={description} />;
  }
  if (!data) return null;

  const { config, summary, top_tools, users } = data;
  const platformSummary = data.platform_summary;
  const platformTopTools = data.platform_top_tools ?? [];
  const series = data.daily_series ?? [];
  const engineReady = config.enabled && config.api_key_configured;
  const maxToolCalls = Math.max(1, ...top_tools.map((t) => t.calls));
  const maxPlatformToolCalls = Math.max(1, ...platformTopTools.map((t) => t.calls));

  const topUsers = [...users]
    .sort(
      (a, b) =>
        (b.mcp_calls_30d ?? 0) +
          (b.rest_calls_30d ?? 0) +
          b.used_30d_requests -
        ((a.mcp_calls_30d ?? 0) + (a.rest_calls_30d ?? 0) + a.used_30d_requests) ||
        b.used_30d_tokens - a.used_30d_tokens,
    )
    .slice(0, 5);

  const recentIssues = data.recent_logs
    .filter((log) => log.status === "RATE_LIMITED" || log.status === "ERROR")
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/app/admin/runtime"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-border-strong bg-card px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Cpu className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{isId ? "Atur Mesin AI" : "Runtime Policy"}</span>
            </Link>
            <Button
              variant="primary"
              size="md"
              loading={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>{isId ? "Muat ulang" : "Refresh"}</span>
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorNotice status={error.status} message={error.message} onRetry={() => void refresh()} />
      ) : null}

      {/* Executive Engine Status Strip */}
      <Card
        className={`p-4 sm:p-5 ${
          engineReady ? "ct-surface-featured" : "border-warning/50 bg-warning-soft/20"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-[12px] border ${
                engineReady
                  ? "border-primary/40 bg-primary/14 text-link"
                  : "border-warning/40 bg-warning-soft text-warning"
              }`}
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{config.model}</span>
                <StatusIndicator
                  state={engineReady ? "CONNECTED" : "STANDBY"}
                  label={
                    engineReady
                      ? isId
                        ? "OPERASIONAL"
                        : "OPERATIONAL"
                      : !config.enabled
                        ? isId
                          ? "DIJEDA GLOBAL"
                          : "GLOBALLY PAUSED"
                        : isId
                          ? "KEY BELUM DISET"
                          : "KEY MISSING"
                  }
                />
                <Badge tone="neutral">{config.api_key_source.toUpperCase()} KEY</Badge>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                Default limit: {config.default_rate_limit_per_min} req/min ·{" "}
                {config.default_daily_requests} req/day ·{" "}
                {config.default_daily_tokens.toLocaleString()} tok/day · Cache TTL{" "}
                {config.response_cache_ttl_seconds}s
              </p>
            </div>
          </div>

          <Link
            href="/app/admin/users"
            className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-background/80 px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/45 hover:text-link"
          >
            <span>{isId ? "Kelola Kuota User" : "Manage User Quotas"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </Card>

      {/* 4 Primary Governance KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Permintaan (Hari Ini / 30h)" : "Requests (Today / 30d)"}
            </p>
            <Activity className="h-4 w-4 text-link" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.requests_today} <span className="text-base text-muted-foreground">/ {summary.requests_30d}</span>
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {summary.avg_latency_ms !== null && summary.avg_latency_ms !== undefined
              ? `${isId ? "Rata-rata latensi" : "Avg latency"}: ${summary.avg_latency_ms} ms`
              : isId
                ? "Menunggu trafik AI pertama"
                : "Awaiting first AI traffic"}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Konsumsi Token (30h)" : "Token Burn (30d)"}
            </p>
            <Zap className="h-4 w-4 text-link" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.tokens_30d.toLocaleString()}
          </p>
          <p className="mt-1.5 font-mono text-xs text-link">
            {isId ? "Est. biaya:" : "Est. spend:"} ${summary.estimated_cost_30d_usd.toFixed(4)} USD
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Efisiensi Cache AI" : "AI Cache Hit Rate"}
            </p>
            <Gauge className="h-4 w-4 text-positive" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-positive">
            {summary.cache_hit_rate_pct !== null ? `${summary.cache_hit_rate_pct}%` : "—"}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {isId ? "Cache hit memakai 0 token Muse." : "Cache hits spend 0 Muse tokens."}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Akun & Kepatuhan Kuota" : "Accounts & Guardrails"}
            </p>
            <Users className="h-4 w-4 text-link" aria-hidden="true" />
          </div>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-foreground">
            {summary.total_registered_users ?? users.length}
          </p>
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">
            {summary.active_users_30d} {isId ? "aktif" : "active"} ·{" "}
            {summary.custom_limit_users ?? 0} {isId ? "kustom" : "custom"} ·{" "}
            {summary.rate_limited_today} {isId ? "limit hr ini" : "429 today"}
          </p>
        </Card>
      </div>

      {/* Platform-Wide Remote MCP & REST API Telemetry (30d) */}
      {platformSummary ? (
        <Card className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {isId ? "Telemetri Remote MCP & REST API (30 Hari)" : "Remote MCP & REST API Telemetry (30d)"}
                </h2>
                <Badge tone={platformSummary.mcp_requests_today > 0 ? "positive" : "neutral"}>
                  {platformSummary.mcp_requests_today} {isId ? "MCP hr ini" : "MCP today"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isId
                  ? "Mencakup panggilan ChatGPT Custom GPT / OAuth Remote MCP, MCP via API key, dan REST API lintas seluruh akun."
                  : "Tracks ChatGPT / OAuth Remote MCP connectors, API-key MCP calls, and REST API traffic across all accounts."}
              </p>
            </div>
            <Link
              href="/app/admin/audit"
              className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-link hover:underline"
            >
              <span>{isId ? "Buka Log MCP & REST" : "Inspect MCP & REST Logs"}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-[12px] border border-border bg-background/60 p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Total Remote MCP (30h)" : "Remote MCP Calls (30d)"}
              </p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                {platformSummary.mcp_requests_30d.toLocaleString()}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {platformSummary.oauth_mcp_requests_30d} OAuth · {platformSummary.api_key_mcp_requests_30d} Key
              </p>
            </div>

            <div className="rounded-[12px] border border-border bg-background/60 p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "REST & Playground (30h)" : "REST & Playground (30d)"}
              </p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                {(platformSummary.rest_requests_30d + platformSummary.playground_requests_30d).toLocaleString()}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {platformSummary.rest_requests_30d} REST · {platformSummary.playground_requests_30d} UI
              </p>
            </div>

            <div className="rounded-[12px] border border-border bg-background/60 p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Kredit CMC Terpakai" : "CMC Credits Used"}
              </p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-link">
                {platformSummary.cmc_credits_30d.toLocaleString()}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {platformSummary.cache_hit_rate_pct !== null
                  ? `${platformSummary.cache_hit_rate_pct}% cache hit`
                  : isId
                    ? "Belum ada cache sample"
                    : "No cache samples"}
              </p>
            </div>

            <div className="rounded-[12px] border border-border bg-background/60 p-3.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Akun API Aktif & Latensi" : "API Accounts & Latency"}
              </p>
              <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                {platformSummary.active_users_30d}
              </p>
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                {platformSummary.avg_latency_ms !== null
                  ? `${platformSummary.avg_latency_ms} ms avg · ${platformSummary.error_count_30d} err`
                  : `${platformSummary.error_count_30d} err`}
              </p>
            </div>
          </div>

          {platformTopTools.length > 0 ? (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2.5 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                {isId ? "Tool MCP / REST Paling Sering Dipanggil" : "Top Remote MCP & REST Endpoints"}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {platformTopTools.slice(0, 6).map((item) => {
                  const pct = Math.max(8, Math.round((item.calls / maxPlatformToolCalls) * 100));
                  return (
                    <div
                      key={item.tool_name}
                      className="rounded-[10px] border border-border bg-background/50 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 font-mono text-xs">
                        <span className="truncate font-semibold text-foreground">{item.tool_name}</span>
                        <span className="shrink-0 text-link">{item.calls}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-positive" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1.5 font-mono text-[10px] text-subtle-foreground">
                        {item.mcp_calls} MCP · {item.rest_calls} REST · {item.credits} cr
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* 14-day Trend */}
      {series.length > 0 ? (
        <DailyActivityChart series={series} isId={isId} locale={locale} />
      ) : null}

      {/* Bottom Operational Insights */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Top Intelligence Tools Called by Muse */}
        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h3 className="text-sm font-semibold text-foreground">
              {isId ? "Tool Intelligence Terbanyak" : "Top Tools Invoked by AI"}
            </h3>
            <Badge tone="neutral">{top_tools.length}</Badge>
          </div>
          {top_tools.length === 0 ? (
            <p className="p-5 text-xs text-muted-foreground">
              {isId ? "Belum ada panggilan tool oleh AI." : "No AI tool invocations yet."}
            </p>
          ) : (
            <ul className="space-y-3 p-4">
              {top_tools.slice(0, 8).map((item) => {
                const widthPct = Math.max(8, Math.round((item.calls / maxToolCalls) * 100));
                return (
                  <li key={item.tool_name} className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="truncate text-foreground">{item.tool_name}</span>
                      <span className="font-semibold text-link">{item.calls}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Top Active Accounts */}
        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h3 className="text-sm font-semibold text-foreground">
              {isId ? "Konsumsi Tertinggi (30 Hari)" : "Top Account Consumption (30d)"}
            </h3>
            <Link
              href="/app/admin/users"
              className="font-mono text-[11px] font-semibold text-link hover:underline"
            >
              {isId ? "Semua" : "All"}
            </Link>
          </div>
          {topUsers.length === 0 ? (
            <p className="p-5 text-xs text-muted-foreground">
              {isId ? "Belum ada profil terdaftar." : "No registered profiles yet."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {topUsers.map((u) => (
                <li key={u.user_id}>
                  <Link
                    href={`/app/admin/users?search=${encodeURIComponent(u.email ?? u.user_id)}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-mono text-xs font-semibold text-foreground">
                          {u.email ?? u.user_id.slice(0, 12)}
                        </p>
                        {u.platform_role === "super_admin" ? (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden="true" />
                        ) : null}
                      </div>
                      <p className="font-mono text-[11px] text-subtle-foreground">
                        {(u.mcp_calls_30d ?? 0)} MCP · {(u.rest_calls_30d ?? 0)} REST · {u.used_30d_requests} AI
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
                      {(u.cmc_credits_30d ?? 0)} cr · ${u.estimated_cost_30d_usd.toFixed(4)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Rate Limit & Error Watchlist */}
        <Card className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <h3 className="text-sm font-semibold text-foreground">
              {isId ? "Pantauan Blokir & Error" : "Rate-Limit & Error Watch"}
            </h3>
            <Link
              href="/app/admin/audit"
              className="font-mono text-[11px] font-semibold text-link hover:underline"
            >
              {isId ? "Audit Log" : "Audit Log"}
            </Link>
          </div>
          {recentIssues.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <ShieldCheck className="h-7 w-7 text-positive" aria-hidden="true" />
              <p className="mt-2 text-xs font-semibold text-foreground">
                {isId ? "Tidak ada insiden terbaru" : "No recent throttles or errors"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isId
                  ? "Semua permintaan Muse Spark terakhir berjalan normal."
                  : "Recent CoinTrac AI traffic completed within normal limits."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentIssues.map((log) => (
                <li key={log.id} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs text-foreground">
                      {log.user_email ?? log.user_id.slice(0, 10)}
                    </span>
                    <Badge tone={log.status === "ERROR" ? "destructive" : "warning"}>
                      {log.status}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {log.error_code ?? (log.prompt_summary || "—")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
