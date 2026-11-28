"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Cpu,
  Database,
  Gauge,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  fetchHealth,
  fetchMarketOverview,
  fetchMarketRegime,
  fetchSectorRotation,
  fetchTelemetrySummary,
} from "@/lib/api";
import {
  formatCompactQuoteCurrency,
  formatDurationMs,
  formatInteger,
  formatPct,
  formatQuoteCurrency,
  formatUtc,
  pctToneClass,
} from "@/lib/format";
import type {
  ApiResult,
  EvidenceEnvelope,
  HealthResponse,
  MarketOverviewData,
  MarketRegimeData,
  SectorRotationData,
  TelemetrySummary,
} from "@/lib/types";
import { ApiNotice } from "./api-notice";
import { useAppPreferences } from "./app-preferences";
import { CoinLogo } from "./coin-logo";
import { FearGreedGauge } from "./fear-greed-gauge";
import { SectorRotationChart } from "./sector-rotation-chart";
import {
  DataModeBadge,
  FreshnessBadge,
  RegimeBadge,
  RotationBadge,
  StatusBadge,
} from "./status-badges";

const AUTO_REFRESH_INTERVAL_MS = 120_000;

export interface OverviewViewProps {
  healthRes: ApiResult<HealthResponse>;
  regimeRes: ApiResult<EvidenceEnvelope<MarketRegimeData>>;
  overviewRes: ApiResult<EvidenceEnvelope<MarketOverviewData>>;
  sectorRes: ApiResult<EvidenceEnvelope<SectorRotationData>>;
  telemetryRes: ApiResult<TelemetrySummary>;
}

export function OverviewView({
  healthRes: initialHealthRes,
  regimeRes: initialRegimeRes,
  overviewRes: initialOverviewRes,
  sectorRes: initialSectorRes,
  telemetryRes: initialTelemetryRes,
}: OverviewViewProps) {
  const { t } = useAppPreferences();

  const [healthRes, setHealthRes] = useState(initialHealthRes);
  const [regimeRes, setRegimeRes] = useState(initialRegimeRes);
  const [overviewRes, setOverviewRes] = useState(initialOverviewRes);
  const [sectorRes, setSectorRes] = useState(initialSectorRes);
  const [telemetryRes, setTelemetryRes] = useState(initialTelemetryRes);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const inFlightRef = useRef(false);
  const lastSyncMsRef = useRef<number | null>(null);

  const refreshAll = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      const [nextHealth, nextRegime, nextOverview, nextSector, nextTelemetry] =
        await Promise.all([
          fetchHealth(),
          fetchMarketRegime(),
          fetchMarketOverview(),
          fetchSectorRotation(),
          fetchTelemetrySummary(),
        ]);
      setHealthRes(nextHealth);
      setRegimeRes(nextRegime);
      setOverviewRes(nextOverview);
      setSectorRes(nextSector);
      setTelemetryRes(nextTelemetry);
      lastSyncMsRef.current = Date.now();
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (lastSyncMsRef.current === null) {
      lastSyncMsRef.current = Date.now();
    }
    if (!autoRefresh) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    }, AUTO_REFRESH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastSyncMsRef.current ?? 0;
      if (Date.now() - last >= AUTO_REFRESH_INTERVAL_MS) {
        void refreshAll();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [autoRefresh, refreshAll]);

  const regimeEnvelope = regimeRes.ok ? regimeRes.data : null;
  const overviewEnvelope = overviewRes.ok ? overviewRes.data : null;
  const sectorEnvelope = sectorRes.ok ? sectorRes.data : null;
  const telemetry = telemetryRes.ok ? telemetryRes.data : null;

  const regime = regimeEnvelope?.data ?? null;
  const overview = overviewEnvelope?.data ?? null;
  const sectors = sectorEnvelope?.data.sectors ?? [];

  const activeDataMode =
    telemetry?.active_data_mode ??
    regimeEnvelope?.evidence.data_mode ??
    overviewEnvelope?.evidence.data_mode ??
    sectorEnvelope?.evidence.data_mode ??
    null;

  const totalCalls = telemetry
    ? telemetry.calls_by_surface.mcp +
      telemetry.calls_by_surface.rest +
      telemetry.calls_by_surface.playground
    : null;

  const fearGreed =
    regime?.fear_greed_value ?? overview?.fear_greed_value ?? null;

  const breadthPct =
    regime?.top50_breadth_positive_pct ??
    overview?.top50_breadth_positive_pct ??
    null;

  const btcDom = overview?.btc_dominance ?? null;
  const ethDom = overview?.eth_dominance ?? null;

  const mcapDelta =
    regime?.total_mcap_change_24h_pct ??
    overview?.total_market_cap_change_24h_pct ??
    null;

  const primaryError = !regimeRes.ok
    ? regimeRes
    : !overviewRes.ok
      ? overviewRes
      : !sectorRes.ok
        ? sectorRes
        : null;

  const regimeAccentBar =
    regime?.regime === "RISK_ON_ALTSEASON"
      ? "from-positive/85 via-positive/25 to-transparent"
      : regime?.regime === "BTC_LED_EXPANSION"
        ? "from-primary/85 via-primary/25 to-transparent"
        : regime?.regime === "RISK_OFF_STRESS"
          ? "from-destructive/85 via-destructive/25 to-transparent"
          : "from-accent/85 via-accent/25 to-transparent";

  const lastUpdatedUtc =
    overviewEnvelope?.evidence.retrieved_at_utc ??
    regimeEnvelope?.evidence.retrieved_at_utc ??
    sectorEnvelope?.evidence.retrieved_at_utc ??
    null;

  return (
    <div className="space-y-6">
      {/* Visibility-Aware Live Feed Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/85 px-4 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold text-foreground">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                autoRefresh
                  ? "bg-positive motion-safe:animate-pulse"
                  : "bg-muted-foreground/50"
              }`}
            />
            {t.overview.lastSynced}:{" "}
            <span className="tabular-nums text-muted-foreground">
              {formatUtc(lastUpdatedUtc)}
            </span>
          </span>
          <span className="hidden text-border sm:inline" aria-hidden="true">
            |
          </span>
          <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">
            {t.overview.smartCacheHint}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            aria-pressed={autoRefresh}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-semibold transition-colors duration-200 ${
              autoRefresh
                ? "border-positive/35 bg-positive/10 text-positive hover:bg-positive/15"
                : "border-border bg-card-elevated text-muted-foreground hover:text-foreground"
            }`}
          >
            {autoRefresh ? (
              <Pause className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Play className="h-3 w-3" aria-hidden="true" />
            )}
            <span>
              {autoRefresh
                ? t.overview.autoRefreshOn
                : t.overview.autoRefreshPaused}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isRefreshing}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card-elevated px-3 py-1.5 font-mono text-[11px] font-semibold text-foreground transition-colors duration-200 hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{isRefreshing ? t.overview.refreshing : t.common.refresh}</span>
          </button>
        </div>
      </div>

      {primaryError && (
        <ApiNotice
          status={primaryError.status}
          message={primaryError.message}
          retryAfterSeconds={primaryError.retryAfterSeconds}
          title={t.overview.feedUnavailable}
        />
      )}

      {/* Top 4 KPI Bento Cards */}
      <section
        aria-label="Global market and telemetry summary"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div className="tg-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {t.overview.totalMarketCap}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                mcapDelta !== null && mcapDelta > 0
                  ? "border-positive/30 bg-positive/12 text-positive"
                  : mcapDelta !== null && mcapDelta < 0
                    ? "border-destructive/30 bg-destructive/12 text-destructive"
                    : "border-border bg-muted/60 text-muted-foreground"
              }`}
            >
              {formatPct(mcapDelta, { signed: true })}
            </span>
          </div>
          <p className="mt-3 font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">
            {formatCompactQuoteCurrency(overview?.total_market_cap, overview?.quote_currency ?? "USD")}
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            {t.overview.vol24h}:{" "}
            {formatCompactQuoteCurrency(overview?.total_volume_24h, overview?.quote_currency ?? "USD")}
          </p>
        </div>

        <div className="tg-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {t.overview.btcEthDom}
            </span>
            <span
              className={`font-mono text-[11px] font-semibold tabular-nums ${pctToneClass(
                regime?.btc_dominance_change_24h ??
                  overview?.btc_dominance_change_24h,
              )}`}
            >
              {formatPct(
                regime?.btc_dominance_change_24h ??
                  overview?.btc_dominance_change_24h,
                { signed: true },
              )}{" "}
              24h
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-foreground">
              {formatPct(btcDom, { decimals: 1 })}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              / {formatPct(ethDom, { decimals: 1 })}
            </span>
          </div>
          <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            {btcDom !== null && (
              <div
                className="h-full bg-accent"
                style={{ width: `${Math.min(100, Math.max(0, btcDom))}%` }}
              />
            )}
            {ethDom !== null && (
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, ethDom))}%` }}
              />
            )}
          </div>
        </div>

        <div className="tg-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {t.overview.dataPipeline}
            </span>
            <DataModeBadge mode={activeDataMode} />
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
              {formatPct(telemetry?.cache_hit_rate_pct, { decimals: 1 })}
            </p>
            {overviewEnvelope && (
              <FreshnessBadge freshness={overviewEnvelope.evidence.freshness} />
            )}
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            {t.overview.cacheHit} · {t.overview.avgLatency}{" "}
            {formatDurationMs(telemetry?.average_latency_ms)}
          </p>
        </div>

        <div className="tg-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Cpu className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {t.overview.telemetryCredits}
            </span>
            <span className="font-mono text-[10px] font-bold uppercase text-positive">
              {healthRes.ok ? t.common.apiOk : t.common.offline}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-foreground">
              {formatInteger(totalCalls)}
            </span>
            <span className="text-xs text-muted-foreground">{t.common.calls}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-lg font-bold text-accent">
              {formatInteger(telemetry?.total_cmc_credits)}
            </span>
            <span className="text-xs text-muted-foreground">
              {t.common.credits}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            {telemetry
              ? `MCP ${telemetry.calls_by_surface.mcp} · REST ${telemetry.calls_by_surface.rest} · UI ${telemetry.calls_by_surface.playground}`
              : healthRes.ok
                ? healthRes.data.engine_version
                : t.common.offline}
          </p>
        </div>
      </section>

      {/* Main 12-Col Market Regime + Sentiment Gauge Bento */}
      <section
        aria-labelledby="regime-heading"
        className="grid gap-4 lg:grid-cols-12"
      >
        <div className="tg-panel relative overflow-hidden rounded-2xl p-6 lg:col-span-8">
          <div
            aria-hidden="true"
            className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${regimeAccentBar}`}
          />

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  {t.overview.regimeLabel}
                </span>
                {regimeEnvelope && <StatusBadge status={regimeEnvelope.status} />}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <h2
                  id="regime-heading"
                  className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
                >
                  {regime?.regime
                    ? regime.regime.replaceAll("_", " ")
                    : t.overview.regimePending}
                </h2>
                <RegimeBadge regime={regime?.regime ?? null} />
                {regime?.signal_conflict && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-tight text-accent">
                    SIGNAL CONFLICT
                  </span>
                )}
                {regime?.confidence && (
                  <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-border bg-muted/60 px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-tight text-muted-foreground">
                    CONFIDENCE {regime.confidence}
                  </span>
                )}
              </div>
            </div>

            {regimeEnvelope && (
              <Link
                href={`/evidence?id=${encodeURIComponent(regimeEnvelope.evidence.evidence_id)}`}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3 py-1.5 font-mono text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary hover:text-primary"
              >
                <ShieldCheck
                  className="h-3.5 w-3.5 text-positive"
                  aria-hidden="true"
                />
                <span>{regimeEnvelope.evidence.evidence_id}</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {regimeEnvelope?.summary ?? t.overview.regimeFallbackDesc}
          </p>

          {regime && regime.rationale.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {regime.rationale.map((line) => (
                <span
                  key={line}
                  className="rounded-lg border border-border bg-card-elevated px-2.5 py-1 font-mono text-[11px] font-medium text-foreground"
                >
                  {line}
                </span>
              ))}
            </div>
          )}

          {overview && (overview.btc || overview.eth || overview.sol) && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[overview.btc, overview.eth, overview.sol]
                .filter((coin): coin is NonNullable<typeof coin> => coin !== null)
                .map((coin) => (
                  <div
                    key={coin.symbol}
                    className="rounded-xl border border-border bg-card-elevated/80 p-4 transition-colors duration-200 hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoinLogo
                          cmcId={coin.cmc_id}
                          symbol={coin.symbol}
                          name={coin.name}
                          size="lg"
                        />
                        <div className="min-w-0 leading-tight">
                          <span className="block font-mono text-xs font-bold text-foreground">
                            {coin.symbol}
                          </span>
                          <span className="block truncate text-[11px] font-medium text-muted-foreground">
                            {coin.name ?? coin.symbol}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${pctToneClass(
                          coin.percent_change_24h,
                        )}`}
                      >
                        {formatPct(coin.percent_change_24h, { signed: true })}
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-xl font-bold tabular-nums text-foreground">
                      {formatQuoteCurrency(coin.price, overview?.quote_currency ?? "USD")}
                    </p>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {t.overview.vol24h}{" "}
                      {formatCompactQuoteCurrency(coin.volume_24h, overview?.quote_currency ?? "USD")}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Sentiment Gauge + Breadth Card (4 cols) */}
        <div className="tg-panel flex flex-col justify-between rounded-2xl p-6 lg:col-span-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.overview.sentimentBreadth}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {overviewEnvelope
                ? formatUtc(overviewEnvelope.evidence.retrieved_at_utc).slice(
                    11,
                    20,
                  )
                : "UTC"}
            </span>
          </div>

          <div className="my-4 flex justify-center">
            <FearGreedGauge
              value={fearGreed}
              classification={overview?.fear_greed_classification ?? null}
            />
          </div>

          <div className="space-y-2.5 rounded-xl border border-border bg-card-elevated/80 p-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground">
                {t.overview.top50Breadth}
              </span>
              <span className="font-mono font-bold tabular-nums text-foreground">
                {formatPct(breadthPct, { decimals: 1 })}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={t.overview.top50Breadth}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={breadthPct ?? undefined}
            >
              {breadthPct !== null && (
                <div
                  className={`h-full rounded-full ${
                    breadthPct >= 60
                      ? "bg-positive"
                      : breadthPct <= 30
                        ? "bg-destructive"
                        : "bg-accent"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, breadthPct))}%`,
                  }}
                />
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              {regime?.btc_outperforming_median_alt === null ||
              regime?.btc_outperforming_median_alt === undefined
                ? t.overview.btcVsMedianMissing
                : regime.btc_outperforming_median_alt
                  ? t.overview.btcOutperforming
                  : t.overview.altsOutperforming}
            </p>
          </div>
        </div>
      </section>

      {/* Top-50 Movers Split Bento */}
      {overview &&
        (overview.top_gainers.length > 0 || overview.top_losers.length > 0) && (
          <section
            aria-label="Top 50 market gainers and losers"
            className="grid gap-4 lg:grid-cols-2"
          >
            <div className="tg-panel overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-border bg-card-elevated/60 px-5 py-3.5">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
                  <TrendingUp
                    className="h-4 w-4 text-positive"
                    aria-hidden="true"
                  />
                  {t.overview.topGainers}
                </h3>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t.overview.spotUsd}
                </span>
              </div>
              <div className="divide-y divide-border">
                {overview.top_gainers.slice(0, 5).map((coin, index) => (
                  <div
                    key={coin.symbol}
                    className="flex items-center justify-between px-5 py-3 font-mono text-xs tabular-nums transition-colors duration-150 hover:bg-card-elevated/70"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-[11px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <CoinLogo
                        cmcId={coin.cmc_id}
                        symbol={coin.symbol}
                        name={coin.name}
                        size="sm"
                      />
                      <span className="font-bold text-foreground">
                        {coin.symbol}
                      </span>
                      <span className="hidden font-sans text-xs text-muted-foreground sm:inline">
                        {coin.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">
                        {formatQuoteCurrency(coin.price, overview?.quote_currency ?? "USD")}
                      </span>
                      <span className="w-20 rounded-md bg-positive/12 px-2 py-0.5 text-right font-semibold text-positive">
                        {formatPct(coin.percent_change_24h, { signed: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="tg-panel overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between border-b border-border bg-card-elevated/60 px-5 py-3.5">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-foreground">
                  <TrendingDown
                    className="h-4 w-4 text-destructive"
                    aria-hidden="true"
                  />
                  {t.overview.topLosers}
                </h3>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {t.overview.spotUsd}
                </span>
              </div>
              <div className="divide-y divide-border">
                {overview.top_losers.slice(0, 5).map((coin, index) => (
                  <div
                    key={coin.symbol}
                    className="flex items-center justify-between px-5 py-3 font-mono text-xs tabular-nums transition-colors duration-150 hover:bg-card-elevated/70"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 text-[11px] text-muted-foreground">
                        {index + 1}
                      </span>
                      <CoinLogo
                        cmcId={coin.cmc_id}
                        symbol={coin.symbol}
                        name={coin.name}
                        size="sm"
                      />
                      <span className="font-bold text-foreground">
                        {coin.symbol}
                      </span>
                      <span className="hidden font-sans text-xs text-muted-foreground sm:inline">
                        {coin.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">
                        {formatQuoteCurrency(coin.price, overview?.quote_currency ?? "USD")}
                      </span>
                      <span className="w-20 rounded-md bg-destructive/12 px-2 py-0.5 text-right font-semibold text-destructive">
                        {formatPct(coin.percent_change_24h, { signed: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      {/* Sector Rotation & RWA Intelligence Bento */}
      <section
        aria-labelledby="sector-heading"
        className="tg-panel rounded-2xl p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 pb-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="sector-heading"
                className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground"
              >
                <Layers className="h-4 w-4 text-accent" aria-hidden="true" />
                {t.overview.sectorHeading}
              </h2>
              {sectorEnvelope && <StatusBadge status={sectorEnvelope.status} />}
            </div>
            <p className="text-sm text-muted-foreground">
              {t.overview.sectorDesc}
            </p>
          </div>

          {sectorEnvelope && (
            <Link
              href={`/evidence?id=${encodeURIComponent(sectorEnvelope.evidence.evidence_id)}`}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card-elevated px-3 py-1.5 font-mono text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary hover:text-primary"
            >
              <Database className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>{sectorEnvelope.evidence.evidence_id}</span>
            </Link>
          )}
        </div>

        <SectorRotationChart sectors={sectors} />

        {sectors.length > 0 && (
          <div className="mt-5 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/80 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t.overview.colSector}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colAssets}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colMedian24h}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colMedian7d}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colCapWtd7d}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colBreadth}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t.overview.colVolShare}
                  </th>
                  <th className="px-4 py-3 font-medium">{t.overview.colSignal}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono tabular-nums">
                {sectors.map((sector) => {
                  const isRwa = sector.sector_slug === "rwa";
                  return (
                    <tr
                      key={sector.sector_slug}
                      className={
                        isRwa
                          ? "bg-accent/10 hover:bg-accent/14"
                          : "hover:bg-card-elevated/60"
                      }
                    >
                      <td className="px-4 py-3 font-sans text-sm font-semibold text-foreground">
                        <span>{sector.display_name}</span>
                        {isRwa && (
                          <span className="ml-2 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-bold text-accent-foreground">
                            RWA
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {sector.constituent_count}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${pctToneClass(
                          sector.median_change_24h_pct,
                        )}`}
                      >
                        {formatPct(sector.median_change_24h_pct, { signed: true })}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${pctToneClass(
                          sector.median_change_7d_pct,
                        )}`}
                      >
                        {formatPct(sector.median_change_7d_pct, { signed: true })}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${pctToneClass(
                          sector.cap_weighted_change_7d_pct,
                        )}`}
                      >
                        {formatPct(sector.cap_weighted_change_7d_pct, {
                          signed: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {formatPct(sector.breadth_positive_24h_pct, {
                          decimals: 1,
                        })}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatPct(sector.sector_volume_share_pct, {
                          decimals: 1,
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <RotationBadge signal={sector.rotation_signal} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bottom Action Bento */}
      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href="/playground"
          className="tg-panel-interactive group flex cursor-pointer items-start justify-between gap-4 rounded-2xl p-5"
        >
          <div className="space-y-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Terminal className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-bold text-foreground">
              {t.overview.actionPlaygroundTitle}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t.overview.actionPlaygroundDesc}
            </p>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        </Link>

        <Link
          href="/evidence"
          className="tg-panel-interactive group flex cursor-pointer items-start justify-between gap-4 rounded-2xl p-5"
        >
          <div className="space-y-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-positive/15 text-positive">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-bold text-foreground">
              {t.overview.actionEvidenceTitle}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t.overview.actionEvidenceDesc}
            </p>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-positive"
            aria-hidden="true"
          />
        </Link>

        <Link
          href="/connect"
          className="tg-panel-interactive group flex cursor-pointer items-start justify-between gap-4 rounded-2xl p-5"
        >
          <div className="space-y-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm font-bold text-foreground">
              {t.overview.actionConnectTitle}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t.overview.actionConnectDesc}
            </p>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
            aria-hidden="true"
          />
        </Link>
      </section>
    </div>
  );
}
