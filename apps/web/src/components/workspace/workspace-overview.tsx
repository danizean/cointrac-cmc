"use client";

import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Circle,
  FileCheck2,
  Flame,
  Gem,
  HelpCircle,
  History,
  KeyRound,
  Layers,
  LineChart,
  Loader2,
  Plug,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import {
  BudgetStateBadge,
  DataModeBadge,
  FreshnessBadge,
  QuotaProfileBadge,
} from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  ProgressIndicator,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { fetchEvidenceList } from "@/lib/api";
import {
  fetchApiKeys,
  fetchMcpStatus,
  fetchUsage,
  type ListKeysPayload,
  type McpStatusPayload,
  type UsagePayload,
} from "@/lib/control-plane-api";
import { formatUtc } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/types";
import {
  computeOnboardingSteps,
  derivePrimaryNextAction,
  isMarketIntelligenceTool,
  type OnboardingStep,
} from "@/lib/workspace-navigation";

const QUICKSTART_STORAGE_KEY = "ct_onboarding_dismissed";
const QUICKSTART_EVENT = "ct-quickstart-toggle";

function subscribeQuickstart(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(QUICKSTART_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(QUICKSTART_EVENT, callback);
  };
}

function readQuickstartHidden(): boolean {
  try {
    return window.localStorage.getItem(QUICKSTART_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface Loadable<T> {
  loading: boolean;
  data: T | null;
  error: { status: number; message: string } | null;
}

function initialLoadable<T>(): Loadable<T> {
  return { loading: true, data: null, error: null };
}

function isStandbyStatus(status: number | undefined): boolean {
  return status === 0 || status === 502 || status === 503 || status === 504;
}

const STEP_LABELS: Record<
  "en" | "id",
  Record<OnboardingStep["id"], { title: string; summary: string }>
> = {
  en: {
    api_key: {
      title: "Create API key",
      summary: "Generate a ct_live_* key for REST and MCP clients.",
    },
    connect_mcp: {
      title: "Connect AI client",
      summary: "Copy ready-to-use HTTPS config for Claude, ChatGPT, or Cursor.",
    },
    first_query: {
      title: "Run first market query",
      summary: "Execute any intelligence desk to log verifiable evidence.",
    },
  },
  id: {
    api_key: {
      title: "Buat API key",
      summary: "Buat key ct_live_* untuk klien REST API dan MCP.",
    },
    connect_mcp: {
      title: "Hubungkan klien AI",
      summary: "Salin konfigurasi HTTPS siap pakai untuk Claude, ChatGPT, atau Cursor.",
    },
    first_query: {
      title: "Jalankan analisis pertama",
      summary: "Buka alat riset pasar untuk menyimpan bukti teraudit pertama Anda.",
    },
  },
};

const SECONDARY_DESKS = [
  { href: "/app/movers", label: { en: "Movers", id: "Movers" }, icon: TrendingUp },
  { href: "/app/assets", label: { en: "Assets", id: "Aset" }, icon: BarChart3 },
  { href: "/app/sectors", label: { en: "Sectors", id: "Sektor" }, icon: Layers },
  { href: "/app/derivatives", label: { en: "Derivatives", id: "Derivatif" }, icon: Flame },
  { href: "/app/anomalies", label: { en: "Anomalies", id: "Anomali" }, icon: Activity },
  { href: "/app/historical", label: { en: "Historical", id: "Historis" }, icon: History },
] as const;

export function WorkspaceOverview() {
  const { locale } = useAppPreferences();
  const { pushToast } = useToast();

  const [keys, setKeys] = useState<Loadable<ListKeysPayload>>(initialLoadable);
  const [mcpStatus, setMcpStatus] = useState<Loadable<McpStatusPayload>>(initialLoadable);
  const [usage, setUsage] = useState<Loadable<UsagePayload>>(initialLoadable);
  const [evidence, setEvidence] = useState<Loadable<EvidenceRecord[]>>(initialLoadable);
  const [refreshing, setRefreshing] = useState(false);

  const hideQuickstart = useSyncExternalStore(
    subscribeQuickstart,
    readQuickstartHidden,
    () => false,
  );

  const toggleQuickstart = useCallback(() => {
    const next = !readQuickstartHidden();
    try {
      window.localStorage.setItem(QUICKSTART_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage access restrictions
    }
    window.dispatchEvent(new Event(QUICKSTART_EVENT));
  }, []);

  const fetchOverviewData = useCallback(async () => {
    const [keysRes, mcpRes, usageRes, evRes] = await Promise.all([
      fetchApiKeys(),
      fetchMcpStatus(),
      fetchUsage(),
      fetchEvidenceList(),
    ]);
    return { keysRes, mcpRes, usageRes, evRes };
  }, []);

  const applyOverviewResults = useCallback(
    (res: Awaited<ReturnType<typeof fetchOverviewData>>) => {
      setKeys({
        loading: false,
        data: res.keysRes.ok ? res.keysRes.data : null,
        error: res.keysRes.ok
          ? null
          : { status: res.keysRes.status, message: res.keysRes.message },
      });
      setMcpStatus({
        loading: false,
        data: res.mcpRes.ok ? res.mcpRes.data : null,
        error: res.mcpRes.ok
          ? null
          : { status: res.mcpRes.status, message: res.mcpRes.message },
      });
      setUsage({
        loading: false,
        data: res.usageRes.ok ? res.usageRes.data : null,
        error: res.usageRes.ok
          ? null
          : { status: res.usageRes.status, message: res.usageRes.message },
      });
      setEvidence({
        loading: false,
        data: res.evRes.ok ? res.evRes.data.records : null,
        error: res.evRes.ok ? null : { status: res.evRes.status, message: res.evRes.message },
      });
    },
    [],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const results = await fetchOverviewData();
    applyOverviewResults(results);
    setRefreshing(false);
    const failures = [
      results.keysRes,
      results.mcpRes,
      results.usageRes,
      results.evRes,
    ].filter((r) => !r.ok).length;
    if (failures > 0) {
      pushToast(
        locale === "id"
          ? `Sebagian status belum merespons (${failures}).`
          : `Refresh completed with ${failures} endpoint(s) unavailable.`,
        "info",
      );
    } else {
      pushToast(locale === "id" ? "Ringkasan diperbarui." : "Workspace refreshed.", "success");
    }
  }, [applyOverviewResults, fetchOverviewData, locale, pushToast]);

  useEffect(() => {
    let active = true;
    void fetchOverviewData().then((results) => {
      if (!active) return;
      applyOverviewResults(results);
    });
    return () => {
      active = false;
    };
  }, [applyOverviewResults, fetchOverviewData]);

  const derivedMetrics = useMemo(() => {
    const keyRows = keys.data?.keys ?? [];
    const revokedKeyCount = keyRows.filter((k) => !k.is_active || k.revoked_at !== null).length;
    const verifiedKeyCount = keyRows.filter((k) => k.is_active && k.last_used_at !== null).length;

    const recentReqs = usage.data?.recent_requests ?? [];
    const successfulMcpCalls = recentReqs.filter(
      (r) => r.surface === "mcp" && r.status_code >= 200 && r.status_code < 300,
    ).length;
    const failedMcpCalls = recentReqs.filter(
      (r) => r.surface === "mcp" && r.status_code >= 400,
    ).length;
    const successfulMarketUsageQueries = recentReqs.filter(
      (r) => isMarketIntelligenceTool(r.tool_name) && r.status_code >= 200 && r.status_code < 300,
    ).length;

    const evidenceRows = evidence.data ?? [];
    const verifiedMarketEvidenceCount = evidenceRows.filter(
      (row) => isMarketIntelligenceTool(row.tool_name) && row.data_mode !== "UNAVAILABLE",
    ).length;

    return {
      revokedKeyCount,
      verifiedKeyCount,
      successfulMcpCalls,
      failedMcpCalls,
      successfulMarketUsageQueries,
      verifiedMarketEvidenceCount,
    };
  }, [keys.data, usage.data, evidence.data]);

  const onboardingSteps = useMemo(
    () =>
      computeOnboardingSteps({
        keysLoading: keys.loading,
        keysLoaded: !keys.loading && keys.data !== null,
        activeKeyCount: keys.data?.active_count ?? null,
        revokedKeyCount: derivedMetrics.revokedKeyCount,
        verifiedKeyCount: derivedMetrics.verifiedKeyCount,
        usageLoading: usage.loading,
        usageLoaded: !usage.loading && usage.data !== null,
        callsLast30d: usage.data?.tool_quota.calls_last_30d ?? null,
        mcpCalls: usage.data?.tool_quota.calls_by_surface.mcp ?? null,
        successfulMcpCalls: derivedMetrics.successfulMcpCalls,
        failedMcpCalls: derivedMetrics.failedMcpCalls,
        successfulMarketUsageQueries: derivedMetrics.successfulMarketUsageQueries,
        mcpStatusLoading: mcpStatus.loading,
        mcpStatusLoaded: !mcpStatus.loading && mcpStatus.data !== null,
        remoteMcpDeployed: Boolean(mcpStatus.data?.remote_deployed),
        evidenceLoading: evidence.loading,
        evidenceLoaded: !evidence.loading && evidence.data !== null,
        verifiedMarketEvidenceCount: derivedMetrics.verifiedMarketEvidenceCount,
      }),
    [keys, usage, mcpStatus, evidence, derivedMetrics],
  );

  const failedEndpoints = useMemo(() => {
    const out: Array<{ label: string; status: number }> = [];
    if (keys.error) out.push({ label: "API keys", status: keys.error.status });
    if (mcpStatus.error) out.push({ label: "MCP status", status: mcpStatus.error.status });
    if (usage.error) out.push({ label: "Usage", status: usage.error.status });
    if (evidence.error) out.push({ label: "Evidence", status: evidence.error.status });
    return out;
  }, [keys.error, mcpStatus.error, usage.error, evidence.error]);

  const allStandby =
    failedEndpoints.length > 0 && failedEndpoints.every((item) => isStandbyStatus(item.status));

  const verifiedCount = onboardingSteps.filter((s) => s.status === "verified").length;
  const setupComplete = !keys.loading && !usage.loading && verifiedCount === onboardingSteps.length;
  const primaryAction = derivePrimaryNextAction(onboardingSteps);
  const recentEvidence = useMemo(() => (evidence.data ?? []).slice(0, 5), [evidence.data]);

  return (
    <div className="space-y-6">
      {/* 1. Crisp Header — instant paint, single primary next action */}
      <PageHeader
        title={locale === "id" ? "Command Hub" : "Command Hub"}
        description={
          locale === "id"
            ? "Satu tempat untuk riset pasar deterministik, koneksi AI MCP, dan audit bukti."
            : "Start market research, connect AI agents over MCP, and inspect verifiable evidence."
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={refreshing}
              onClick={() => void handleRefresh()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>{locale === "id" ? "Muat ulang" : "Refresh"}</span>
            </Button>
            <Link
              href={setupComplete ? "/app/hidden-gems" : primaryAction.href}
              className="tg-btn tg-btn-primary inline-flex"
            >
              <span>
                {setupComplete
                  ? locale === "id"
                    ? "Buka Hidden Gems"
                    : "Open Hidden Gems"
                  : primaryAction.label}
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {failedEndpoints.length > 0 ? (
        <ErrorNotice
          status={allStandby ? 503 : failedEndpoints[0]?.status}
          title={
            allStandby
              ? locale === "id"
                ? "Backend API sedang standby"
                : "Backend API currently unreachable"
              : locale === "id"
                ? "Sebagian telemetri belum termuat"
                : "Some telemetry could not load"
          }
          message={
            locale === "id"
              ? "Navigasi riset dan halaman lain tetap bisa dibuka; klik muat ulang untuk mencoba lagi."
              : "Navigation remains ready; click refresh to retry loading live account telemetry."
          }
          onRetry={() => void handleRefresh()}
        />
      ) : null}

      {/* CoinTrac AI Spotlight */}
      <Card className="ct-surface-featured p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-primary/40 bg-primary/14 text-link">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">CoinTrac AI Analyst</h2>
                <Badge tone="brand">Muse Spark 1.3</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "id"
                  ? "Tanya kondisi pasar, Hidden Gems, movers anti-FOMO, atau perbandingan koin dengan hasil ringkas berbasis bukti live."
                  : "Ask for market regime, Hidden Gems, anti-chase movers, or coin comparisons backed by live deterministic evidence."}
              </p>
            </div>
          </div>
          <Link
            href="/app/ai"
            className="tg-btn tg-btn-primary ct-btn-glow inline-flex min-h-10 items-center gap-1.5 px-4 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{locale === "id" ? "Buka CoinTrac AI" : "Launch CoinTrac AI"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </Card>

      {/* 2. Compact 4-Metric Telemetry Bar — zero bloated cards, skeleton only on numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Panggilan (24j)" : "Calls (24h)"}
          </p>
          {usage.loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {usage.data ? usage.data.tool_quota.calls_last_24h : "—"}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <QuotaProfileBadge profile={usage.data?.server_mode?.effective_profile} />
            <BudgetStateBadge state={usage.data?.server_mode?.budget_state} />
          </div>
        </Card>

        <Card className="p-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Kredit CMC (Bulan)" : "CMC Credits (Mo)"}
          </p>
          {usage.loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {usage.data ? usage.data.cmc_credits.credits_this_month : "—"}
            </p>
          )}
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {usage.data?.cmc_credits.cache_hit_rate_pct !== null &&
            usage.data?.cmc_credits.cache_hit_rate_pct !== undefined
              ? `${usage.data.cmc_credits.cache_hit_rate_pct.toFixed(0)}% cache hit`
              : "Cache ratio —"}
          </p>
        </Card>

        <Card className="p-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "API Key Aktif" : "Active Keys"}
          </p>
          {keys.loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {keys.data ? `${keys.data.active_count} / ${keys.data.max_active_keys}` : "—"}
            </p>
          )}
          <p className="font-mono text-[11px] text-muted-foreground">
            {derivedMetrics.verifiedKeyCount > 0
              ? locale === "id"
                ? `${derivedMetrics.verifiedKeyCount} pernah dipakai`
                : `${derivedMetrics.verifiedKeyCount} verified in use`
              : (keys.data?.active_count ?? 0) > 0
                ? locale === "id"
                  ? "Aktif · siap dipakai"
                  : "Active · ready for first call"
                : locale === "id"
                  ? "Belum dibuat"
                  : "Key needed"}
          </p>
        </Card>

        <Card className="p-4 space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            MCP Endpoint
          </p>
          {mcpStatus.loading ? (
            <Skeleton className="h-6 w-24" />
          ) : (
            <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
              {mcpStatus.data ? `${mcpStatus.data.contracts.tools} Tools` : "—"}
            </p>
          )}
          <p className="font-mono text-[11px] text-muted-foreground">
            {mcpStatus.data
              ? mcpStatus.data.remote_deployed
                ? "HTTPS Ready"
                : "Streamable HTTP"
              : "—"}
          </p>
        </Card>
      </div>

      {/* 3. Two Clear Primary Paths (Static instant paint, zero sidebar clutter) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Path A: Flagship Research Entry (7 cols) */}
        <Card className="flex flex-col justify-between gap-5 p-5 lg:col-span-7">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="brand">
                {locale === "id" ? "Riset Pasar Utama" : "Primary Research"}
              </Badge>
              <Link
                href="/playground"
                className="font-mono text-[11px] font-medium text-link hover:underline"
              >
                API Playground →
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Link
                href="/app/hidden-gems"
                className="group flex flex-col justify-between gap-3 rounded-[12px] border border-primary/35 bg-primary/8 p-4 transition-colors hover:border-primary/60 hover:bg-primary/12"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-primary/30 bg-card text-link">
                      <Gem className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-link transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">Hidden Gem Discovery</h2>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {locale === "id"
                      ? "Scan altcoin Early Asymmetric & Confirmed Momentum lengkap dengan bukti & outcome."
                      : "Screen Early Asymmetric & Confirmed altcoins with component evidence & checkpoints."}
                  </p>
                </div>
                <span className="font-mono text-[11px] font-semibold text-link">
                  {locale === "id" ? "Mulai scan →" : "Launch scanner →"}
                </span>
              </Link>

              <Link
                href="/app/market"
                className="group flex flex-col justify-between gap-3 rounded-[12px] border border-border bg-card-elevated p-4 transition-colors hover:border-border-strong hover:bg-muted/70"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-border bg-card text-link">
                      <LineChart className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-link"
                      aria-hidden="true"
                    />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {locale === "id" ? "Makro & Rezim Pasar" : "Market & Macro Regime"}
                  </h2>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {locale === "id"
                      ? "Kapitalisasi, dominasi BTC/ETH, Fear & Greed, dan klasifikasi rezim 4-sinyal."
                      : "Market cap, BTC/ETH dominance, Fear & Greed, and deterministic 4-signal regime."}
                  </p>
                </div>
                <span className="font-mono text-[11px] font-semibold text-link">
                  {locale === "id" ? "Buka makro →" : "Open overview →"}
                </span>
              </Link>
            </div>
          </div>

          {/* Quick Jump Pills to Secondary Desks */}
          <div className="space-y-2 border-t border-border pt-3.5">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
              {locale === "id" ? "Alat Intelijen Lainnya" : "More Intelligence Desks"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SECONDARY_DESKS.map((desk) => {
                const Icon = desk.icon;
                return (
                  <Link
                    key={desk.href}
                    href={desk.href}
                    className="inline-flex min-h-9 sm:min-h-8 items-center gap-1.5 rounded-[8px] border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
                  >
                    <Icon className="h-3.5 w-3.5 text-link" aria-hidden="true" />
                    <span>{desk.label[locale]}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Path B: AI Agent & API Quick Setup (5 cols) */}
        <Card className="flex flex-col justify-between gap-4 p-5 lg:col-span-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h2 className="text-sm font-semibold text-foreground">
                  {locale === "id" ? "Koneksi AI & Developer" : "AI Agents & API Setup"}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {setupComplete
                    ? locale === "id"
                      ? "Akun siap dipakai lewat Web, REST, maupun MCP."
                      : "Your account is verified across Web, REST, and MCP."
                    : locale === "id"
                      ? "3 langkah singkat menghubungkan Claude, ChatGPT, atau skrip."
                      : "3 quick steps to connect Claude, ChatGPT, or custom code."}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={toggleQuickstart}>
                {hideQuickstart
                  ? locale === "id"
                    ? "Tampilkan"
                    : "Show"
                  : locale === "id"
                    ? "Ringkas"
                    : "Hide"}
              </Button>
            </div>

            {!hideQuickstart ? (
              <div className="space-y-3">
                <ProgressIndicator
                  completed={verifiedCount}
                  total={onboardingSteps.length}
                  label={
                    locale === "id"
                      ? `${verifiedCount} dari ${onboardingSteps.length} langkah terverifikasi`
                      : `${verifiedCount} of ${onboardingSteps.length} verified`
                  }
                />

                <ol className="space-y-2">
                  {onboardingSteps.map((step) => {
                    const copy = STEP_LABELS[locale][step.id];
                    const isVerified = step.status === "verified";
                    const isConfigured = step.status === "configured";
                    const isLoading = step.status === "loading";
                    return (
                      <li key={step.id}>
                        <Link
                          href={step.href}
                          className="flex items-center justify-between gap-3 rounded-[10px] border border-border bg-background/70 px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-muted/60"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {isLoading ? (
                              <Loader2
                                className="h-4 w-4 shrink-0 animate-spin text-subtle-foreground"
                                aria-hidden="true"
                              />
                            ) : isVerified ? (
                              <CheckCircle2
                                className="h-4 w-4 shrink-0 text-positive"
                                aria-hidden="true"
                              />
                            ) : isConfigured ? (
                              <CheckCircle2
                                className="h-4 w-4 shrink-0 text-info"
                                aria-hidden="true"
                              />
                            ) : step.status === "action_required" ? (
                              <Circle className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                            ) : (
                              <HelpCircle
                                className="h-4 w-4 shrink-0 text-subtle-foreground"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-foreground">
                                {copy.title}
                              </p>
                              <p className="truncate text-[11px] text-muted-foreground">
                                {copy.summary}
                              </p>
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] font-medium text-link">
                            {step.ctaLabel} →
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3.5">
            <Link
              href="/app/keys"
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-border-strong bg-card-elevated px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <KeyRound className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "API Keys" : "API Keys"}</span>
            </Link>
            <Link
              href="/app/connections"
              className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-border-strong bg-card-elevated px-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Plug className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Koneksi MCP" : "MCP Setup"}</span>
            </Link>
          </div>
        </Card>
      </div>

      {/* 4. Compact Recent Verified Evidence Ledger */}
      <section aria-labelledby="recent-activity-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 id="recent-activity-heading" className="text-sm font-semibold text-foreground">
              {locale === "id" ? "Aktivitas Bukti Terbaru" : "Recent Verified Evidence"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {locale === "id"
                ? "Setiap analisis pasar & panggilan MCP mencatat jejak audit terverifikasi."
                : "Latest timestamped audit records stored for your account."}
            </p>
          </div>
          <Link
            href="/app/evidence"
            className="inline-flex min-h-9 items-center gap-1 rounded-[8px] px-2.5 text-xs font-semibold text-link hover:bg-muted/60 hover:underline"
          >
            <span>{locale === "id" ? "Semua bukti" : "View all"}</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {evidence.loading ? (
          <Card className="space-y-2.5 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Card>
        ) : recentEvidence.length === 0 ? (
          <EmptyState
            icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />}
            title={locale === "id" ? "Belum ada catatan bukti" : "No evidence records yet"}
            description={
              locale === "id"
                ? "Jalankan analisis di Hidden Gems atau Market Overview untuk menghasilkan evidence_id teraudit."
                : "Run any Market Intelligence tool or Hidden Gems scan to log your first timestamped evidence record."
            }
            action={
              <Link href="/app/hidden-gems" className="tg-btn tg-btn-primary inline-flex">
                <span>{locale === "id" ? "Buka Hidden Gems" : "Open Hidden Gems"}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {recentEvidence.map((row) => (
                <li key={row.evidence_id}>
                  <Link
                    href={`/app/evidence?id=${encodeURIComponent(row.evidence_id)}`}
                    className="flex min-h-12 flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-link">
                        {row.evidence_id}
                      </span>
                      <span className="truncate font-mono text-xs text-foreground">
                        {row.tool_name}
                      </span>
                      <span className="font-mono text-[11px] text-subtle-foreground">
                        · {formatUtc(row.created_at)} · {row.credit_cost} cr
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <DataModeBadge mode={row.data_mode} />
                      <FreshnessBadge freshness={row.freshness} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
