"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Cpu,
  FileCheck2,
  HelpCircle,
  KeyRound,
  LineChart,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DataModeBadge, FreshnessBadge, StatusIndicator } from "@/components/status-badges";
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

const STEP_COPY: Record<
  OnboardingStep["id"],
  { title: string; summary: string; whyItMatters: string }
> = {
  api_key: {
    title: "Create a personal CoinTrac API key",
    summary:
      "Mint a hashed personal key (ct_live_*) from API Keys. Secrets are displayed once and never stored in plaintext.",
    whyItMatters:
      "Required to authenticate REST API requests and AI agent MCP connections under your account.",
  },
  connect_mcp: {
    title: "Connect an AI client via MCP or REST",
    summary:
      "Copy a client configuration in MCP Connections using your CoinTrac API key (Authorization: Bearer).",
    whyItMatters:
      "Gives Antigravity, Cursor, Claude Code, or scripts direct access to 10 verified CoinTrac tools.",
  },
  first_query: {
    title: "Run your first Market Intelligence query",
    summary:
      "Open Market Intelligence to run a live market overview, regime classification, asset profile, or mover screener.",
    whyItMatters:
      "Produces a timestamped Evidence record (ev_*) logged exclusively to your account for auditability.",
  },
};

const QUICK_ACTIONS = [
  {
    href: "/app/keys",
    title: "Manage API Keys",
    description: "Create a ct_live_* key or revoke compromised credentials immediately.",
    icon: KeyRound,
  },
  {
    href: "/app/connections",
    title: "Configure MCP Client",
    description: "Inspect Local MCP setup and live Remote MCP deployment status.",
    icon: Plug,
  },
  {
    href: "/app/market",
    title: "Open Market Intelligence",
    description: "Analyze market regime, assets, movers, anomalies, sectors, and derivatives.",
    icon: LineChart,
  },
  {
    href: "/app/usage",
    title: "Review Usage & Quota",
    description: "Track CoinTrac tool calls separately from CoinMarketCap API credits.",
    icon: Activity,
  },
] as const;

const CAPABILITIES = [
  {
    title: "Market Intelligence",
    ctaLabel: "Open Market Intelligence",
    description:
      "Ten deterministic CoinMarketCap workflows covering macro overview, regime classification, asset comparison, anti-chase movers, anomalies, sector rotation, derivatives, and historical risk.",
    href: "/app/market",
    icon: LineChart,
  },
  {
    title: "AI Agent & MCP Connectivity",
    ctaLabel: "Open MCP Connections",
    description:
      "Single Streamable HTTP and local stdio MCP server exposing 10 tools, 3 static resources, 2 resource templates, and 3 guarded prompts.",
    href: "/app/connections",
    icon: Plug,
  },
  {
    title: "REST API Access",
    ctaLabel: "Open API Keys",
    description:
      "Personal SHA-256 hashed API keys (ct_live_*) sharing a predictable per-account rate window with immediate revocation.",
    href: "/app/keys",
    icon: Terminal,
  },
  {
    title: "Evidence & Data Provenance",
    ctaLabel: "Open Evidence",
    description:
      "Every intelligence call creates a tenant-scoped ev_* audit record disclosing source endpoints, UTC timestamps, data mode, freshness, and plan limitations.",
    href: "/app/evidence",
    icon: FileCheck2,
  },
  {
    title: "Usage & Credit Transparency",
    ctaLabel: "Open Usage",
    description:
      "Separates your CoinTrac tool call quota from upstream CoinMarketCap credits (cached responses consume 0 CMC credits).",
    href: "/app/usage",
    icon: Activity,
  },
] as const;

export function WorkspaceOverview() {
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
            `Refresh completed with ${failures} failed status check${failures === 1 ? "" : "s"}.`,
            "error",
          );
        } else {
          pushToast("Workspace status refreshed.", "success");
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
    const out: string[] = [];
    if (profile.error) out.push(`Account (${profile.error.status})`);
    if (keys.error) out.push(`API keys (${keys.error.status})`);
    if (mcpStatus.error) out.push(`MCP status (${mcpStatus.error.status})`);
    if (usage.error) out.push(`Usage telemetry (${usage.error.status})`);
    if (health.error) out.push(`Backend health (${health.error.status})`);
    if (evidence.error) out.push(`Evidence (${evidence.error.status})`);
    return out;
  }, [profile.error, keys.error, mcpStatus.error, usage.error, health.error, evidence.error]);

  const verifiedCount = onboardingSteps.filter((s) => s.status === "verified").length;
  const configuredCount = onboardingSteps.filter((s) => s.status === "configured").length;
  const primaryAction = derivePrimaryNextAction(onboardingSteps);
  const greetingName = profile.data?.display_name?.trim() || profile.data?.email || null;
  const recentEvidence = useMemo(() => (evidence.data ?? []).slice(0, 5), [evidence.data]);

  return (
    <div className="space-y-8">
      {/* A. Welcome & Workspace Context */}
      <PageHeader
        title={greetingName ? `Welcome, ${greetingName}` : "CoinTrac Workspace"}
        description="Operational status, setup readiness, and direct entry points for verified crypto market intelligence, API keys, and MCP connectivity."
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={refreshing}
              onClick={() => void loadAll(true)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Refresh</span>
            </Button>
            <Link href={primaryAction.href} className="tg-btn tg-btn-primary inline-flex">
              <span>{primaryAction.label}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      {/* Partial API Degradation Disclosure */}
      {failedEndpoints.length > 0 ? (
        <ErrorNotice
          title="Partial status check failure"
          message={`Some workspace signals could not be verified: ${failedEndpoints.join(", ")}. Affected cards remain marked ERROR or UNVERIFIED.`}
          onRetry={() => void loadAll(true)}
        />
      ) : null}

      {/* B. Workspace Readiness (Real Signals Only) */}
      <section aria-labelledby="readiness-heading" className="space-y-4">
        <SectionHeader
          id="readiness-heading"
          title="Workspace readiness"
          description="Live status checks against your authenticated account and the local CoinTrac backend."
        />

        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {/* 1. Account & Session */}
          <Card className="flex min-w-0 flex-col justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">Account &amp; session</span>
              </span>
              {profile.loading ? (
                <StatusIndicator state="LOADING" />
              ) : profile.error ? (
                <StatusIndicator state="ERROR" />
              ) : profile.data?.email_verified ? (
                <StatusIndicator state="CONNECTED" label="VERIFIED" />
              ) : (
                <StatusIndicator state="UNVERIFIED" />
              )}
            </div>
            {profile.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : profile.error ? (
              <p className="text-xs text-destructive">{profile.error.message}</p>
            ) : (
              <div>
                <p className="truncate font-mono text-sm font-semibold text-foreground">
                  {profile.data?.base_plan_code.toUpperCase() ?? "—"} plan
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Status:{" "}
                  <span className="font-mono text-foreground">
                    {profile.data?.account_status ?? "—"}
                  </span>
                </p>
              </div>
            )}
          </Card>

          {/* 2. API Keys */}
          <Card className="flex min-w-0 flex-col justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                <KeyRound className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">API keys</span>
              </span>
              {keys.loading ? (
                <StatusIndicator state="LOADING" />
              ) : keys.error ? (
                <StatusIndicator state="ERROR" />
              ) : derivedMetrics.verifiedKeyCount > 0 ? (
                <StatusIndicator state="CONNECTED" label="VERIFIED" />
              ) : (keys.data?.active_count ?? 0) > 0 ? (
                <StatusIndicator state="CONFIGURED" />
              ) : (
                <StatusIndicator state="NOT_CONFIGURED" />
              )}
            </div>
            {keys.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : keys.error ? (
              <p className="text-xs text-destructive">{keys.error.message}</p>
            ) : (
              <div>
                <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {keys.data?.active_count ?? 0} / {keys.data?.max_active_keys ?? 5} active
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {derivedMetrics.verifiedKeyCount > 0
                    ? `${derivedMetrics.verifiedKeyCount} active key verified via live auth.`
                    : (keys.data?.active_count ?? 0) > 0
                      ? "Key present; authentication unverified until first request."
                      : derivedMetrics.revokedKeyCount > 0
                        ? `${derivedMetrics.revokedKeyCount} revoked key(s) only; create an active key.`
                        : "Create a ct_live_* key to connect MCP or REST."}
                </p>
              </div>
            )}
          </Card>

          {/* 3. MCP Connectivity */}
          <Card className="flex min-w-0 flex-col justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Plug className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">MCP transport</span>
              </span>
              {mcpStatus.loading ? (
                <StatusIndicator state="LOADING" />
              ) : mcpStatus.error ? (
                <StatusIndicator state="ERROR" />
              ) : mcpStatus.data?.remote_deployed ? (
                <StatusIndicator state="CONNECTED" label="REMOTE DEPLOYED" />
              ) : (
                <StatusIndicator state="NOT_DEPLOYED" />
              )}
            </div>
            {mcpStatus.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : mcpStatus.error ? (
              <p className="text-xs text-destructive">{mcpStatus.error.message}</p>
            ) : (
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Local {mcpStatus.data?.stateless_http ? "Stateless" : "Stateful"} HTTP ready
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mcpStatus.data?.remote_deployed
                    ? "Public HTTPS Remote MCP configured."
                    : "Remote HTTPS host Not deployed."}
                  {usage.data
                    ? ` · ${usage.data.tool_quota.calls_by_surface.mcp} MCP call${usage.data.tool_quota.calls_by_surface.mcp === 1 ? "" : "s"} observed.`
                    : ""}
                </p>
              </div>
            )}
          </Card>

          {/* 4. Intelligence Service Availability */}
          <Card className="flex min-w-0 flex-col justify-between gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Cpu className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
                <span className="truncate">Intelligence API</span>
                <InfoTip
                  align="right"
                  label="About Intelligence API health"
                  text="Backend /health confirms the local CoinTrac server responds. Upstream CoinMarketCap endpoints still depend on your active CMC plan tier (for example, OHLCV returns TIER_RESTRICTED on Basic)."
                />
              </span>
              {health.loading ? (
                <StatusIndicator state="LOADING" />
              ) : health.error ? (
                <StatusIndicator state="ERROR" />
              ) : health.data?.status === "ok" ? (
                <StatusIndicator state="CONNECTED" label="REACHABLE" />
              ) : (
                <StatusIndicator state="UNVERIFIED" />
              )}
            </div>
            {health.loading ? (
              <Skeleton className="h-10 w-full" />
            ) : health.error ? (
              <p className="text-xs text-destructive">{health.error.message}</p>
            ) : (
              <div>
                <p className="truncate font-mono text-sm font-semibold text-foreground">
                  {health.data?.engine_version ?? "—"}
                </p>
                {usage.error ? (
                  <p className="mt-0.5 text-xs text-destructive">
                    Usage telemetry failed (HTTP {usage.error.status}).
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {usage.data
                      ? `${usage.data.tool_quota.calls_last_24h} calls (24h) · ${usage.data.cmc_credits.credits_this_month} CMC credits (mo)`
                      : "Checking account telemetry..."}
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* C. Three-Step Quickstart Onboarding (Dismissible & Reopenable) */}
      <section aria-labelledby="quickstart-heading" className="space-y-4">
        <SectionHeader
          id="quickstart-heading"
          title="Quickstart guide"
          description="Three practical steps to go from verified account to auditable crypto intelligence."
          action={
            <Button variant="ghost" size="sm" onClick={toggleQuickstart}>
              {hideQuickstart ? "Show quickstart guide" : "Hide guide"}
            </Button>
          }
        />

        {!hideQuickstart ? (
          <Card className="space-y-5 p-5">
            <ProgressIndicator
              completed={verifiedCount}
              total={onboardingSteps.length}
              label={
                configuredCount > 0
                  ? `Verified milestones (${configuredCount} configured, awaiting live request verification)`
                  : "Verified milestones based on live account telemetry"
              }
            />

            <ol className="grid gap-4 lg:grid-cols-3">
              {onboardingSteps.map((step) => {
                const copy = STEP_COPY[step.id];
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
                      <p className="text-xs leading-relaxed text-subtle-foreground">
                        <strong className="font-medium text-muted-foreground">Why:</strong>{" "}
                        {copy.whyItMatters}
                      </p>
                    </div>

                    <div className="space-y-2.5 border-t border-border pt-3">
                      <p className="text-xs text-muted-foreground">{step.statusNote}</p>
                      <Link
                        href={step.href}
                        className={`inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-[8px] px-3 text-xs font-semibold transition-colors ${
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

      {/* D. Quick Actions + E. Recent Verified Activity */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section aria-labelledby="quick-actions-heading" className="space-y-4 lg:col-span-5">
          <SectionHeader
            id="quick-actions-heading"
            title="Quick actions"
            description="Jump directly to core workspace workflows."
          />
          <div className="grid gap-3">
            {QUICK_ACTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-card-elevated"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-link">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
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
            title="Recent evidence activity"
            description="Latest tenant-scoped audit records generated by your workspace, REST, or MCP tool calls."
            action={
              <Link
                href="/app/evidence"
                className="inline-flex min-h-8 items-center gap-1 rounded-[8px] px-2 text-xs font-semibold text-link hover:bg-muted/60 hover:underline"
              >
                <span>View all evidence</span>
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
            <ErrorNotice
              status={evidence.error.status}
              message={evidence.error.message}
              onRetry={() => void loadAll(true)}
            />
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
                      className="flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
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
                      <div className="flex shrink-0 items-center gap-2">
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

      {/* F. Product Capabilities Context */}
      <section aria-labelledby="capabilities-context-heading" className="space-y-4">
        <SectionHeader
          id="capabilities-context-heading"
          title="What you can do in CoinTrac"
          description="Every workspace page connects to the same deterministic intelligence engine and strict per-account isolation."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <Card key={cap.title} className="flex flex-col justify-between gap-3 p-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-link" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-foreground">{cap.title}</h3>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">{cap.description}</p>
                </div>
                <div>
                  <Link
                    href={cap.href}
                    className="inline-flex min-h-8 items-center gap-1 rounded-[8px] px-1 text-xs font-semibold text-link hover:bg-muted/60 hover:underline"
                  >
                    <span>{cap.ctaLabel}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
