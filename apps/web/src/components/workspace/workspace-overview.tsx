"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Circle,
  Cpu,
  FileCheck2,
  Flame,
  HelpCircle,
  History,
  KeyRound,
  Layers,
  LineChart,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  BudgetStateBadge,
  DataModeBadge,
  FreshnessBadge,
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
  ProgressIndicator,
  SectionHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useAppPreferences } from "@/components/app-preferences";
import { SnapshotFreshness } from "@/components/workspace/snapshot-freshness";
import { useToast } from "@/components/ui/toast";
import { fetchEvidenceList } from "@/lib/api";
import {
  fetchApiKeys,
  fetchMcpStatus,
  fetchMyProfile,
  fetchSystemHealth,
  fetchUsage,
  type AuthProfilePayload,
  type ListKeysPayload,
  type McpStatusPayload,
  type SystemHealthPayload,
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

const STEP_COPY: Record<
  "en" | "id",
  Record<OnboardingStep["id"], { title: string; summary: string; whyItMatters: string }>
> = {
  en: {
    api_key: {
      title: "Create your CoinTrac API key",
      summary: "Generate a personal key (ct_live_*) from API Keys. The secret is shown once.",
      whyItMatters: "Used to authenticate REST API requests and MCP client connections.",
    },
    connect_mcp: {
      title: "Connect an AI client or script",
      summary: "Copy a ready-to-use config in MCP Connections for ChatGPT, Claude, Gemini, or Hermes.",
      whyItMatters: "Lets your AI assistant or code call CoinTrac tools over HTTPS.",
    },
    first_query: {
      title: "Run your first market query",
      summary: "Open Market Intelligence to run a market overview, asset check, or movers scan.",
      whyItMatters: "Saves a timestamped evidence record under your account.",
    },
  },
  id: {
    api_key: {
      title: "Buat API key CoinTrac Anda",
      summary: "Buat key pribadi (ct_live_*) di halaman API Keys. Rahasia hanya tampil sekali.",
      whyItMatters: "Dipakai untuk autentikasi request REST API dan koneksi klien MCP.",
    },
    connect_mcp: {
      title: "Hubungkan klien AI atau skrip",
      summary: "Salin konfigurasi di Koneksi MCP untuk ChatGPT, Claude, Gemini, atau Hermes.",
      whyItMatters: "Memungkinkan asisten AI atau kode Anda memanggil tool CoinTrac via HTTPS.",
    },
    first_query: {
      title: "Jalankan analisis pasar pertama",
      summary: "Buka Intelijen Pasar untuk cek ringkasan pasar, aset, atau penyaring movers.",
      whyItMatters: "Menyimpan catatan bukti berstempel waktu di akun Anda.",
    },
  },
};

const ANALYSIS_DESKS = [
  {
    href: "/app/market",
    title: { en: "Market & Regime", id: "Pasar & Rezim" },
    description: {
      en: "Total market cap, BTC/ETH dominance, Fear & Greed, and 4-signal regime.",
      id: "Kapitalisasi pasar, dominasi BTC/ETH, Fear & Greed, dan rezim 4-sinyal.",
    },
    icon: LineChart,
  },
  {
    href: "/app/assets",
    title: { en: "Assets & Compare", id: "Aset & Bandingkan" },
    description: {
      en: "Single-asset fundamentals, FDV overhang, momentum, and peer comparison.",
      id: "Fundamental aset, FDV overhang, momentum, dan perbandingan antaraset.",
    },
    icon: BarChart3,
  },
  {
    href: "/app/movers",
    title: { en: "Movers Screener", id: "Penyaring Movers" },
    description: {
      en: "Momentum screening with liquidity floors, RS vs BTC, and 24h gain caps.",
      id: "Screening momentum dengan batas likuiditas, RS vs BTC, dan cap kenaikan 24j.",
    },
    icon: TrendingUp,
  },
  {
    href: "/app/sectors",
    title: { en: "Sector Rotation", id: "Rotasi Sektor" },
    description: {
      en: "Median and cap-weighted returns across DeFi, AI, L1, L2, Gaming, RWA, and Memes.",
      id: "Return median dan cap-weighted di sektor DeFi, AI, L1, L2, Gaming, RWA, dan Memes.",
    },
    icon: Layers,
  },
  {
    href: "/app/derivatives",
    title: { en: "Derivatives & Stress", id: "Derivatif & Tekanan" },
    description: {
      en: "Open interest, funding rates, outlier flags, or spot-stress proxy.",
      id: "Open interest, funding rate, outlier, atau proksi tekanan pasar spot.",
    },
    icon: Flame,
  },
  {
    href: "/app/anomalies",
    title: { en: "Outliers & History", id: "Anomali & Historis" },
    description: {
      en: "Volume/return outliers, BTC divergences, and 365-day risk metrics.",
      id: "Deteksi anomali volume/return, divergensi BTC, dan metrik risiko 365 hari.",
    },
    icon: AlertTriangle,
  },
] as const;

const QUICK_ACTIONS = [
  {
    href: "/app/keys",
    title: { en: "Manage API Keys", id: "Kelola API Key" },
    description: {
      en: "Create new ct_live_* keys or revoke existing credentials.",
      id: "Buat key ct_live_* baru atau cabut kredensial lama.",
    },
    icon: KeyRound,
  },
  {
    href: "/app/connections",
    title: { en: "MCP Connections", id: "Koneksi MCP" },
    description: {
      en: "Set up ChatGPT, Claude, Gemini, or Hermes over HTTPS.",
      id: "Hubungkan ChatGPT, Claude, Gemini, atau Hermes via HTTPS.",
    },
    icon: Plug,
  },
  {
    href: "/app/usage",
    title: { en: "Usage & Quotas", id: "Penggunaan & Kuota" },
    description: {
      en: "Track tool calls, rate limits, and CoinMarketCap credits.",
      id: "Pantau jumlah panggilan tool, rate limit, dan kredit CMC.",
    },
    icon: Activity,
  },
  {
    href: "/app/historical",
    title: { en: "Historical Performance", id: "Performa Historis" },
    description: {
      en: "Review daily closes, volatility, beta, and max drawdown.",
      id: "Lihat penutupan harian, volatilitas, beta, dan max drawdown.",
    },
    icon: History,
  },
] as const;

export function WorkspaceOverview() {
  const { locale } = useAppPreferences();
  const { pushToast } = useToast();

  const [profile, setProfile] = useState<Loadable<AuthProfilePayload>>(initialLoadable);
  const [keys, setKeys] = useState<Loadable<ListKeysPayload>>(initialLoadable);
  const [mcpStatus, setMcpStatus] = useState<Loadable<McpStatusPayload>>(initialLoadable);
  const [usage, setUsage] = useState<Loadable<UsagePayload>>(initialLoadable);
  const [health, setHealth] = useState<Loadable<SystemHealthPayload>>(initialLoadable);
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

  const loadAll = useCallback(
    async (isManualRefresh: boolean) => {
      if (isManualRefresh) {
        setRefreshing(true);
      }
      const [profRes, keysRes, mcpRes, usageRes, healthRes, evRes] = await Promise.all([
        fetchMyProfile(),
        fetchApiKeys(),
        fetchMcpStatus(),
        fetchUsage(),
        fetchSystemHealth(),
        fetchEvidenceList(),
      ]);

      setProfile({
        loading: false,
        data: profRes.ok ? profRes.data : null,
        error: profRes.ok ? null : { status: profRes.status, message: profRes.message },
      });
      setKeys({
        loading: false,
        data: keysRes.ok ? keysRes.data : null,
        error: keysRes.ok ? null : { status: keysRes.status, message: keysRes.message },
      });
      setMcpStatus({
        loading: false,
        data: mcpRes.ok ? mcpRes.data : null,
        error: mcpRes.ok ? null : { status: mcpRes.status, message: mcpRes.message },
      });
      setUsage({
        loading: false,
        data: usageRes.ok ? usageRes.data : null,
        error: usageRes.ok ? null : { status: usageRes.status, message: usageRes.message },
      });
      setHealth({
        loading: false,
        data: healthRes.ok ? healthRes.data : null,
        error: healthRes.ok ? null : { status: healthRes.status, message: healthRes.message },
      });
      setEvidence({
        loading: false,
        data: evRes.ok ? evRes.data.records : null,
        error: evRes.ok ? null : { status: evRes.status, message: evRes.message },
      });

      if (isManualRefresh) {
        setRefreshing(false);
        const failures = [profRes, keysRes, mcpRes, usageRes, healthRes, evRes].filter(
          (r) => !r.ok,
        ).length;
        if (failures > 0) {
          pushToast(
            `Status check completed (${failures} service${failures === 1 ? "" : "s"} in standby or unverified).`,
            "info",
          );
        } else {
          pushToast("Workspace telemetry refreshed.", "success");
        }
      }
    },
    [pushToast],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [profRes, keysRes, mcpRes, usageRes, healthRes, evRes] = await Promise.all([
        fetchMyProfile(),
        fetchApiKeys(),
        fetchMcpStatus(),
        fetchUsage(),
        fetchSystemHealth(),
        fetchEvidenceList(),
      ]);
      if (!active) return;

      setProfile({
        loading: false,
        data: profRes.ok ? profRes.data : null,
        error: profRes.ok ? null : { status: profRes.status, message: profRes.message },
      });
      setKeys({
        loading: false,
        data: keysRes.ok ? keysRes.data : null,
        error: keysRes.ok ? null : { status: keysRes.status, message: keysRes.message },
      });
      setMcpStatus({
        loading: false,
        data: mcpRes.ok ? mcpRes.data : null,
        error: mcpRes.ok ? null : { status: mcpRes.status, message: mcpRes.message },
      });
      setUsage({
        loading: false,
        data: usageRes.ok ? usageRes.data : null,
        error: usageRes.ok ? null : { status: usageRes.status, message: usageRes.message },
      });
      setHealth({
        loading: false,
        data: healthRes.ok ? healthRes.data : null,
        error: healthRes.ok ? null : { status: healthRes.status, message: healthRes.message },
      });
      setEvidence({
        loading: false,
        data: evRes.ok ? evRes.data.records : null,
        error: evRes.ok ? null : { status: evRes.status, message: evRes.message },
      });
    })();
    return () => {
      active = false;
    };
  }, []);

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
    if (profile.error) out.push({ label: `Account (${profile.error.status})`, status: profile.error.status });
    if (keys.error) out.push({ label: `API keys (${keys.error.status})`, status: keys.error.status });
    if (mcpStatus.error) out.push({ label: `MCP status (${mcpStatus.error.status})`, status: mcpStatus.error.status });
    if (usage.error) out.push({ label: `Usage telemetry (${usage.error.status})`, status: usage.error.status });
    if (health.error) out.push({ label: `Engine health (${health.error.status})`, status: health.error.status });
    if (evidence.error) out.push({ label: `Evidence (${evidence.error.status})`, status: evidence.error.status });
    return out;
  }, [profile.error, keys.error, mcpStatus.error, usage.error, health.error, evidence.error]);

  const allStandby =
    failedEndpoints.length > 0 && failedEndpoints.every((item) => isStandbyStatus(item.status));

  const verifiedCount = onboardingSteps.filter((s) => s.status === "verified").length;
  const configuredCount = onboardingSteps.filter((s) => s.status === "configured").length;
  const primaryAction = derivePrimaryNextAction(onboardingSteps);
  const greetingName = profile.data?.display_name?.trim() || profile.data?.email || null;
  const recentEvidence = useMemo(() => (evidence.data ?? []).slice(0, 5), [evidence.data]);

  return (
    <div className="space-y-8">
      {/* A. Welcome & Workspace Context */}
      <PageHeader
        title={
          greetingName
            ? locale === "id"
              ? `Selamat datang, ${greetingName}`
              : `Welcome, ${greetingName}`
            : "CoinTrac Workspace"
        }
        description={
          locale === "id"
            ? "Pantau status API, kelola API key, hubungkan klien AI, dan jalankan analisis pasar."
            : "Monitor API health, manage keys, connect AI clients, and run market analysis."
        }
        actions={
          <>
            <SnapshotFreshness onSnapshot={() => void loadAll(false)} />
            <Button
              variant="secondary"
              size="md"
              loading={refreshing}
              onClick={() => void loadAll(true)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>{locale === "id" ? "Muat ulang" : "Refresh"}</span>
            </Button>
            <Link
              href={primaryAction.href}
              className="tg-btn tg-btn-primary ct-btn-glow inline-flex"
            >
              <span>{primaryAction.label}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {/* Graceful Degradation / Service Unavailable Disclosure */}
      {failedEndpoints.length > 0 ? (
        <ErrorNotice
          status={allStandby ? 503 : failedEndpoints[0]?.status}
          title={
            allStandby
              ? locale === "id"
                ? "Layanan API belum terhubung"
                : "API currently unreachable"
              : locale === "id"
                ? "Sebagian data belum termuat"
                : "Some metrics could not load"
          }
          message={
            allStandby
              ? locale === "id"
                ? "Metrik langsung sedang dijeda karena backend API belum merespons. Kontrol navigasi tetap dapat digunakan."
                : "Live metrics are paused while the backend API is unreachable. Workspace navigation remains available."
              : locale === "id"
                ? "Beberapa metrik gagal dimuat. Klik coba lagi untuk memuat ulang."
                : "Some workspace metrics failed to load. Click retry to refresh."
          }
          onRetry={() => void loadAll(true)}
        />
      ) : null}

      {/* B. System & Account Status */}
      <section aria-labelledby="readiness-heading" className="space-y-4">
        <SectionHeader
          id="readiness-heading"
          title={locale === "id" ? "Status sistem & akun" : "System & account status"}
          description={
            locale === "id"
              ? "Ringkasan koneksi API, kredensial akun, dan aktivitas MCP/REST Anda."
              : "Overview of API health, account credentials, and MCP/REST activity."
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Card 1: API Health & Quota */}
          <Card className="ct-surface-card flex min-w-0 flex-col justify-between gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Cpu className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">
                  {locale === "id" ? "Status API" : "API Health"}
                </span>
                <InfoTip
                  align="right"
                  label="About API health"
                  text="Checks connectivity to the CoinTrac backend API. Missing market fields always stay null."
                />
              </span>
              {health.loading ? (
                <StatusIndicator state="CONNECTING" label="Checking..." />
              ) : health.error ? (
                isStandbyStatus(health.error.status) ? (
                  <StatusIndicator state="STANDBY" label="UNAVAILABLE" />
                ) : (
                  <StatusIndicator state="ERROR" />
                )
              ) : health.data?.status === "ok" ? (
                <StatusIndicator state="CONNECTED" label="ONLINE" />
              ) : (
                <StatusIndicator state="UNVERIFIED" />
              )}
            </div>

            {health.loading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="space-y-2.5">
                <p className="truncate font-mono text-base font-semibold text-foreground">
                  {health.data?.engine_version ??
                    (health.error
                      ? locale === "id"
                        ? "Tidak terhubung"
                        : "Unavailable"
                      : "—")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <QuotaProfileBadge profile={usage.data?.server_mode?.effective_profile} />
                  <BudgetStateBadge state={usage.data?.server_mode?.budget_state} />
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {usage.data
                    ? `${usage.data.tool_quota.calls_last_24h} calls (24h) · ${usage.data.cmc_credits.credits_this_month} CMC credits (mo)`
                    : health.error
                      ? locale === "id"
                        ? "Menunggu koneksi backend..."
                        : "Waiting for backend connection..."
                      : locale === "id"
                        ? "Memeriksa penggunaan..."
                        : "Checking usage..."}
                </p>
              </div>
            )}
          </Card>

          {/* Card 2: Account & API Keys */}
          <Card className="ct-surface-card flex min-w-0 flex-col justify-between gap-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">
                  {locale === "id" ? "Akun & API Key" : "Account & API Keys"}
                </span>
              </span>
              {profile.loading || keys.loading ? (
                <StatusIndicator state="LOADING" />
              ) : derivedMetrics.verifiedKeyCount > 0 ? (
                <StatusIndicator state="CONNECTED" label="VERIFIED" />
              ) : (keys.data?.active_count ?? 0) > 0 ? (
                <StatusIndicator state="CONFIGURED" />
              ) : profile.data?.email_verified ? (
                <StatusIndicator state="NOT_CONFIGURED" label="KEY NEEDED" />
              ) : isStandbyStatus(profile.error?.status) ? (
                <StatusIndicator state="STANDBY" label="UNAVAILABLE" />
              ) : (
                <StatusIndicator state="UNVERIFIED" />
              )}
            </div>

            {profile.loading || keys.loading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-base font-semibold tabular-nums text-foreground">
                    {keys.data
                      ? `${keys.data.active_count} / ${keys.data.max_active_keys} active keys`
                      : "—"}
                  </p>
                  <Badge tone="brand">
                    {profile.data?.base_plan_code
                      ? `${profile.data.base_plan_code.toUpperCase()} PLAN`
                      : "SESSION"}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {derivedMetrics.verifiedKeyCount > 0
                    ? locale === "id"
                      ? `${derivedMetrics.verifiedKeyCount} API key sudah dipakai dan terverifikasi.`
                      : `${derivedMetrics.verifiedKeyCount} personal key verified via API requests.`
                    : (keys.data?.active_count ?? 0) > 0
                      ? locale === "id"
                        ? "API key sudah dibuat; akan terverifikasi saat panggilan pertama."
                        : "Key created; verifies automatically on first request."
                      : locale === "id"
                        ? "Buat API key ct_live_* di menu API Keys untuk mulai."
                        : "Create an API key in API Keys to get started."}
                </p>
              </div>
            )}
          </Card>

          {/* Card 3: MCP & REST Surfaces */}
          <Card className="ct-surface-card flex min-w-0 flex-col justify-between gap-4 p-5 md:col-span-2 lg:col-span-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Plug className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">
                  {locale === "id" ? "Koneksi MCP & REST" : "MCP & REST"}
                </span>
              </span>
              {mcpStatus.loading ? (
                <StatusIndicator state="LOADING" />
              ) : mcpStatus.error ? (
                isStandbyStatus(mcpStatus.error.status) ? (
                  <StatusIndicator state="STANDBY" label="UNAVAILABLE" />
                ) : (
                  <StatusIndicator state="ERROR" />
                )
              ) : mcpStatus.data?.remote_deployed ? (
                <StatusIndicator state="CONNECTED" label="HTTPS READY" />
              ) : (
                <StatusIndicator state="CONFIGURED" label="READY" />
              )}
            </div>

            {mcpStatus.loading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="space-y-2">
                <p className="text-base font-semibold text-foreground">
                  Streamable HTTP MCP
                </p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {usage.data
                    ? `MCP ${usage.data.tool_quota.calls_by_surface.mcp} · REST ${usage.data.tool_quota.calls_by_surface.rest} · UI ${usage.data.tool_quota.calls_by_surface.playground}`
                    : mcpStatus.data?.remote_url ?? "https://mcp.cointrac.xyz/mcp"}
                </p>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* C. Three-Step Quickstart */}
      <section aria-labelledby="quickstart-heading" className="space-y-4">
        <SectionHeader
          id="quickstart-heading"
          title={locale === "id" ? "Langkah mulai cepat" : "Quickstart"}
          description={
            locale === "id"
              ? "Tiga langkah dari membuat API key hingga menjalankan analisis pertama."
              : "Three steps from creating an API key to running your first market query."
          }
          action={
            <Button variant="ghost" size="sm" onClick={toggleQuickstart}>
              {hideQuickstart
                ? locale === "id"
                  ? "Tampilkan panduan"
                  : "Show guide"
                : locale === "id"
                  ? "Sembunyikan"
                  : "Hide guide"}
            </Button>
          }
        />

        {!hideQuickstart ? (
          <Card className="ct-surface-featured space-y-5 p-5">
            <ProgressIndicator
              completed={verifiedCount}
              total={onboardingSteps.length}
              label={
                configuredCount > 0
                  ? locale === "id"
                    ? `Progres akun (${configuredCount} sudah dikonfigurasi)`
                    : `Account progress (${configuredCount} configured)`
                  : locale === "id"
                    ? "Progres berdasarkan aktivitas akun"
                    : "Progress based on account activity"
              }
            />

            <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {onboardingSteps.map((step) => {
                const copy = STEP_COPY[locale][step.id];
                const isVerified = step.status === "verified";
                const isConfigured = step.status === "configured";
                const isAction = step.status === "action_required";
                const isLoading = step.status === "loading";
                const badgeTone = isVerified
                  ? "positive"
                  : isConfigured
                    ? "info"
                    : isAction
                      ? "brand"
                      : "neutral";
                return (
                  <li
                    key={step.id}
                    className="flex flex-col justify-between gap-4 rounded-[12px] border border-border bg-background/60 p-4"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-subtle-foreground">
                          {isLoading ? (
                            <Loader2
                              className="h-4 w-4 animate-spin text-subtle-foreground"
                              aria-hidden="true"
                            />
                          ) : isVerified ? (
                            <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />
                          ) : isConfigured ? (
                            <CheckCircle2 className="h-4 w-4 text-info" aria-hidden="true" />
                          ) : isAction ? (
                            <Circle className="h-4 w-4 text-link" aria-hidden="true" />
                          ) : (
                            <HelpCircle
                              className="h-4 w-4 text-subtle-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span>STEP 0{step.stepNumber}</span>
                        </span>
                        <Badge tone={badgeTone}>{step.badgeLabel}</Badge>
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{copy.title}</h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {copy.summary}
                      </p>
                    </div>

                    <div className="space-y-2.5 border-t border-border pt-3">
                      <p className="text-xs text-subtle-foreground">{step.statusNote}</p>
                      <Link
                        href={step.href}
                        className={`inline-flex min-h-11 sm:min-h-9 w-full items-center justify-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition-colors ${
                          isAction
                            ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                            : "border border-border-strong bg-card text-foreground hover:bg-muted"
                        }`}
                      >
                        <span>{step.ctaLabel}</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>
        ) : null}
      </section>

      {/* D. Analysis Desks Bento Grid */}
      <section aria-labelledby="desks-heading" className="space-y-4">
        <SectionHeader
          id="desks-heading"
          title={locale === "id" ? "Alat Intelijen Pasar" : "Market Intelligence desks"}
          description={
            locale === "id"
              ? "Jalankan analisis pasar, aset, movers, sektor, derivatif, dan histori."
              : "Run live market, asset, mover, sector, derivatives, and history tools."
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ANALYSIS_DESKS.map((desk) => {
            const Icon = desk.icon;
            return (
              <Link
                key={desk.href}
                href={desk.href}
                className="ct-surface-card group flex flex-col justify-between gap-4 rounded-[16px] p-5 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-card-elevated"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-border bg-background text-link">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <ArrowRight
                      className="h-4 w-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-link"
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">{desk.title[locale]}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {desk.description[locale]}
                  </p>
                </div>
                <p className="border-t border-border/80 pt-3 font-mono text-[11px] font-medium text-link">
                  {locale === "id" ? "Buka alat" : "Open desk"} →
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* E. Control Plane Actions + Recent Evidence */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-labelledby="quick-actions-heading" className="space-y-4 lg:col-span-5">
          <SectionHeader
            id="quick-actions-heading"
            title={locale === "id" ? "Kelola akun & akses" : "Manage access & usage"}
            description={
              locale === "id"
                ? "API key, koneksi MCP, kuota, dan data historis."
                : "API keys, MCP connections, quotas, and historical closes."
            }
          />
          <div className="grid gap-3">
            {QUICK_ACTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="ct-surface-card group flex min-h-16 items-center justify-between gap-3 rounded-[14px] p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-card-elevated"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-link">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.title[locale]}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.description[locale]}
                      </p>
                    </div>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-subtle-foreground transition-colors group-hover:text-link"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="recent-activity-heading" className="space-y-4 lg:col-span-7">
          <SectionHeader
            id="recent-activity-heading"
            title={locale === "id" ? "Riwayat bukti terbaru" : "Recent evidence activity"}
            description={
              locale === "id"
                ? "Respons terbaru yang tersimpan di akun Anda."
                : "Latest responses saved to your account."
            }
            action={
              <Link
                href="/app/evidence"
                className="inline-flex min-h-11 sm:min-h-8 items-center gap-1 rounded-[8px] px-2 text-xs font-semibold text-link hover:bg-muted/60 hover:underline"
              >
                <span>{locale === "id" ? "Lihat semua" : "View all evidence"}</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            }
          />

          {evidence.loading ? (
            <Card className="space-y-3 p-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </Card>
          ) : evidence.error ? (
            allStandby ? (
              <EmptyState
                icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />}
                title={locale === "id" ? "Menunggu koneksi API" : "Waiting for API connection"}
                description={
                  locale === "id"
                    ? "Riwayat bukti tersimpan akan muncul di sini setelah backend API terhubung."
                    : "Saved evidence records will appear here once the backend API is connected."
                }
              />
            ) : (
              <ErrorNotice
                status={evidence.error.status}
                message={evidence.error.message}
                onRetry={() => void loadAll(true)}
              />
            )
          ) : recentEvidence.length === 0 ? (
            <EmptyState
              icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />}
              title="No evidence records yet"
              description="Run any Market Intelligence tool or call CoinTrac over MCP to generate a timestamped evidence record owned exclusively by your account."
              action={
                <Link href="/app/market" className="tg-btn tg-btn-primary inline-flex">
                  <span>Open Market Intelligence</span>
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
                      className="flex min-h-14 flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-link">
                            {row.evidence_id}
                          </span>
                          <span className="truncate font-mono text-xs text-foreground">
                            {row.tool_name}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-subtle-foreground">
                          {formatUtc(row.created_at)} · {row.credit_cost} CMC credit
                          {row.credit_cost === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
    </div>
  );
}
