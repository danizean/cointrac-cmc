"use client";

import {
  Activity,
  AlertCircle,
  Bell,
  ChevronDown,
  ChevronUp,
  Gem,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Square,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import {
  Badge,
  Button,
  Card,
  DeskSkeleton,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { formatCompactUsd, formatPct, formatUsd, formatUtc, pctToneClass } from "@/lib/format";
import {
  addToHiddenGemWatchlist,
  cancelHiddenGemScan,
  createHiddenGemConfig,
  createHiddenGemScan,
  fetchHiddenGemAlerts,
  fetchHiddenGemCandidateDetail,
  fetchHiddenGemCandidates,
  fetchHiddenGemConfigs,
  fetchHiddenGemQualityStats,
  fetchHiddenGemScanDetail,
  fetchHiddenGemScans,
  fetchHiddenGemWatchlist,
  removeFromHiddenGemWatchlist,
} from "@/lib/hidden-gems-api";
import {
  confidenceBadgeTone,
  eligibilityBadgeTone,
  formatScore,
  formatWeightCoverage,
  scanStatusTone,
  type AlertEventItem,
  type CandidateDetail,
  type CandidateSummary,
  type DiscoveryTrack,
  type QualityStatsRow,
  type RejectionSummary,
  type ScanConfigItem,
  type ScanHorizonInput,
  type ScanRunSummary,
  type ScanTrackInput,
  type TradingHorizon,
  type WatchlistItem,
} from "@/lib/hidden-gems-types";
import { HiddenGemDetailModal } from "./hidden-gem-detail-modal";

type DeskTab = "feed" | "watchlist" | "rejections" | "alerts";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

function optionalFloat(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const val = Number(trimmed);
  return Number.isFinite(val) ? val : null;
}

export function HiddenGemsDesk() {
  const { locale } = useAppPreferences();
  const [activeTab, setActiveTab] = useState<DeskTab>("feed");
  const [showBuilder, setShowBuilder] = useState(false);

  // Scan configuration state
  const [scanTrack, setScanTrack] = useState<ScanTrackInput>("BOTH");
  const [scanHorizon, setScanHorizon] = useState<ScanHorizonInput>("BOTH");
  const [universeLimit, setUniverseLimit] = useState("400");
  const [minCap, setMinCap] = useState("10000000");
  const [maxCap, setMaxCap] = useState("1000000000");
  const [minVol, setMinVol] = useState("1000000");
  const [minVolRatio, setMinVolRatio] = useState("0.02");
  const [minListingDays, setMinListingDays] = useState("30");
  const [maxEarly24h, setMaxEarly24h] = useState("25");
  const [maxEarly7d, setMaxEarly7d] = useState("60");
  const [selectedConfigId, setSelectedConfigId] = useState("");
  const [presetName, setPresetName] = useState("");
  const [scheduleMinutes, setScheduleMinutes] = useState("0");

  // Candidate feed filters
  const [filterTrack, setFilterTrack] = useState<DiscoveryTrack | "">("");
  const [filterHorizon, setFilterHorizon] = useState<TradingHorizon | "">("");
  const [filterMinScore, setFilterMinScore] = useState("");
  const [filterConfidence, setFilterConfidence] = useState<"HIGH" | "MEDIUM" | "LOW" | "">("");
  const [filterEligibility, setFilterEligibility] = useState("");

  // Server state
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingScan, setSubmittingScan] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [notice, setNotice] = useState<{ status: number; message: string } | null>(null);

  const [scans, setScans] = useState<ScanRunSummary[]>([]);
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [rejections, setRejections] = useState<RejectionSummary[]>([]);
  const [configs, setConfigs] = useState<ScanConfigItem[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<AlertEventItem[]>([]);
  const [qualityStats, setQualityStats] = useState<QualityStatsRow[]>([]);

  // Detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestScan = scans[0] ?? null;
  const activeScan = scans.find((s) => s.status === "QUEUED" || s.status === "RUNNING") ?? null;

  const watchlistByAsset = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const item of watchlist) {
      map.set(item.asset_id, item);
    }
    return map;
  }, [watchlist]);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const minScoreVal = optionalFloat(filterMinScore);
      const [
        scansRes,
        candidatesRes,
        configsRes,
        watchlistRes,
        alertsRes,
        qualityRes,
      ] = await Promise.all([
        fetchHiddenGemScans(15),
        fetchHiddenGemCandidates({
          track: filterTrack,
          horizon: filterHorizon,
          min_score: minScoreVal,
          confidence: filterConfidence,
          eligibility: filterEligibility || undefined,
          limit: 80,
        }),
        fetchHiddenGemConfigs(),
        fetchHiddenGemWatchlist(),
        fetchHiddenGemAlerts(40),
        fetchHiddenGemQualityStats(),
      ]);

      if (!scansRes.ok) {
        setNotice({ status: scansRes.status, message: scansRes.message });
        return;
      }
      setNotice(null);
      setScans(scansRes.data);
      if (candidatesRes.ok) setCandidates(candidatesRes.data);
      if (configsRes.ok) setConfigs(configsRes.data);
      if (watchlistRes.ok) setWatchlist(watchlistRes.data);
      if (alertsRes.ok) setAlerts(alertsRes.data);
      if (qualityRes.ok) setQualityStats(qualityRes.data);

      const newest = scansRes.data[0];
      if (newest) {
        const detailRes = await fetchHiddenGemScanDetail(newest.id);
        if (detailRes.ok) {
          setRejections(detailRes.data.rejections);
        }
      } else {
        setRejections([]);
      }
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [filterConfidence, filterEligibility, filterHorizon, filterMinScore, filterTrack]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    if (!activeScan) return;
    pollTimer.current = setTimeout(() => {
      void loadWorkspaceData();
    }, 3500);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [activeScan, loadWorkspaceData]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await loadWorkspaceData();
  }

  async function handleRunScan() {
    setSubmittingScan(true);
    setNotice(null);
    const idemp =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `hg-${Date.now()}`;
    const res = await createHiddenGemScan(
      {
        track: scanTrack,
        horizon: scanHorizon,
        config_id: selectedConfigId || null,
        universe_limit: optionalFloat(universeLimit) ?? 400,
        filters: {
          min_market_cap_usd: optionalFloat(minCap),
          max_market_cap_usd: optionalFloat(maxCap),
          min_volume_24h_usd: optionalFloat(minVol),
          min_vol_to_mcap: optionalFloat(minVolRatio),
          min_listing_age_days: optionalFloat(minListingDays),
          max_early_return_24h_pct: optionalFloat(maxEarly24h),
          max_early_return_7d_pct: optionalFloat(maxEarly7d),
        },
      },
      idemp,
    );
    setSubmittingScan(false);
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    await loadWorkspaceData();
  }

  async function handleCancelScan(scanId: string) {
    setCancellingId(scanId);
    const res = await cancelHiddenGemScan(scanId);
    setCancellingId(null);
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    await loadWorkspaceData();
  }

  async function handleSavePreset() {
    const trimmed = presetName.trim();
    if (!trimmed) return;
    setSavingPreset(true);
    const res = await createHiddenGemConfig({
      name: trimmed,
      discovery_track: scanTrack,
      trading_horizon: scanHorizon,
      universe_config: { limit: optionalFloat(universeLimit) ?? 400 },
      filter_config: {
        min_market_cap_usd: optionalFloat(minCap),
        max_market_cap_usd: optionalFloat(maxCap),
        min_volume_24h_usd: optionalFloat(minVol),
        min_vol_to_mcap: optionalFloat(minVolRatio),
        min_listing_age_days: optionalFloat(minListingDays),
        max_early_return_24h_pct: optionalFloat(maxEarly24h),
        max_early_return_7d_pct: optionalFloat(maxEarly7d),
      },
      schedule_config:
        Number(scheduleMinutes) >= 60
          ? { enabled: true, interval_minutes: Number(scheduleMinutes) }
          : { enabled: false },
    });
    setSavingPreset(false);
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    setPresetName("");
    setSelectedConfigId(res.data.id);
    await loadWorkspaceData();
  }

  function applyConfigPreset(configId: string) {
    setSelectedConfigId(configId);
    const found = configs.find((c) => c.id === configId);
    if (!found) return;
    if (found.discovery_track === "EARLY" || found.discovery_track === "CONFIRMED" || found.discovery_track === "BOTH") {
      setScanTrack(found.discovery_track);
    }
    if (found.trading_horizon === "SHORT_TERM" || found.trading_horizon === "SWING" || found.trading_horizon === "BOTH") {
      setScanHorizon(found.trading_horizon);
    }
    const uLimit = found.universe_config?.limit;
    if (typeof uLimit === "number") setUniverseLimit(String(uLimit));
    const f = found.filter_config ?? {};
    if (typeof f.min_market_cap_usd === "number") setMinCap(String(f.min_market_cap_usd));
    if (typeof f.max_market_cap_usd === "number") setMaxCap(String(f.max_market_cap_usd));
    if (typeof f.min_volume_24h_usd === "number") setMinVol(String(f.min_volume_24h_usd));
    if (typeof f.min_vol_to_mcap === "number") setMinVolRatio(String(f.min_vol_to_mcap));
    if (typeof f.min_listing_age_days === "number") setMinListingDays(String(f.min_listing_age_days));
    if (typeof f.max_early_return_24h_pct === "number") setMaxEarly24h(String(f.max_early_return_24h_pct));
    if (typeof f.max_early_return_7d_pct === "number") setMaxEarly7d(String(f.max_early_return_7d_pct));
  }

  async function handleInspectCandidate(candidateId: string) {
    setModalOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    const res = await fetchHiddenGemCandidateDetail(candidateId);
    setDetailLoading(false);
    if (!res.ok) {
      setDetailError(res.message);
      return;
    }
    setDetail(res.data);
  }

  async function handleToggleWatchlist(candidate: CandidateSummary) {
    const existing = watchlistByAsset.get(candidate.asset_id);
    if (existing) {
      const res = await removeFromHiddenGemWatchlist(existing.id);
      if (!res.ok) {
        setNotice({ status: res.status, message: res.message });
        return;
      }
      setWatchlist((prev) => prev.filter((item) => item.id !== existing.id));
      return;
    }
    const res = await addToHiddenGemWatchlist({
      asset_id: candidate.asset_id,
      candidate_result_id: candidate.id,
    });
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    setWatchlist((prev) => [res.data, ...prev.filter((w) => w.asset_id !== res.data.asset_id)]);
  }

  async function handleRemoveWatchlistItem(itemId: string) {
    const res = await removeFromHiddenGemWatchlist(itemId);
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    setWatchlist((prev) => prev.filter((item) => item.id !== itemId));
  }

  const latestLimitations = useMemo(() => {
    const raw = latestScan?.source_metadata?.limitations;
    return Array.isArray(raw) ? raw.map(String) : [];
  }, [latestScan]);

  if (initialLoading) {
    return <DeskSkeleton />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hidden Gem Discovery"
        description={
          locale === "id"
            ? "Penemuan altcoin asimetris deterministik untuk jalur Early Asymmetric & Confirmed Momentum dengan bukti teraudit."
            : "Deterministic Early Asymmetric & Confirmed Momentum altcoin discovery with confidence separation and audited evidence."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowBuilder((prev) => !prev)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === "id" ? "Konfigurasi Scan" : "Scan Builder"}
              {showBuilder ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={refreshing}
              onClick={() => void handleManualRefresh()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === "id" ? "Muat Ulang" : "Refresh"}
            </Button>
            {activeScan ? (
              <Button
                size="sm"
                variant="danger"
                loading={cancellingId === activeScan.id}
                onClick={() => void handleCancelScan(activeScan.id)}
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                {locale === "id" ? "Batalkan Scan" : "Cancel Scan"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                loading={submittingScan}
                onClick={() => void handleRunScan()}
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {locale === "id" ? "Jalankan Discovery Scan" : "Run Discovery Scan"}
              </Button>
            )}
          </div>
        }
      />

      {notice ? (
        <ApiNotice
          status={notice.status}
          message={notice.message}
          onRetry={() => void handleManualRefresh()}
        />
      ) : null}

      {/* Telemetry & Engine Status Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Status Scan Terbaru" : "Latest Scan Status"}
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            {latestScan ? (
              <Badge tone={scanStatusTone(latestScan.status)}>{latestScan.status}</Badge>
            ) : (
              <Badge tone="neutral">IDLE</Badge>
            )}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {latestScan ? `${latestScan.universe_scanned} scanned` : "No runs yet"}
            </span>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Profil Kapabilitas & Rezim" : "Capability & Macro Regime"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{latestScan?.effective_tier ?? "BASIC"}</Badge>
            <Badge tone="neutral">{latestScan?.market_regime ?? "UNKNOWN"}</Badge>
          </div>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Kandidat Lolos / Ditemukan" : "Eligible / Discovered"}
          </p>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-foreground">
            {latestScan?.candidates_eligible ?? 0}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              / {latestScan?.candidates_discovered ?? 0} total ({latestScan?.candidates_rejected ?? 0} rejected)
            </span>
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Kredit CMC & Watchlist" : "CMC Credits & Watchlist"}
          </p>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-foreground">
            {latestScan?.cmc_credits_consumed ?? 0} cr
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · {watchlist.length} watchlist · {alerts.length} alerts
            </span>
          </p>
        </Card>
      </div>

      {/* Collapsible Scan Builder */}
      {showBuilder ? (
        <Card elevated className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {locale === "id" ? "Parameter Discovery Scan" : "Discovery Scan Builder"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {locale === "id"
                  ? "Atur jalur riset, horizon perdagangan, dan batas penyaring likuiditas/anti-chase."
                  : "Configure discovery track, trading horizon, universe cap, and hard-gate overrides."}
              </p>
            </div>
            {configs.length > 0 ? (
              <div className="w-full sm:w-56">
                <label htmlFor="hg-preset-select" className="text-[11px] text-muted-foreground">
                  {locale === "id" ? "Preset Tersimpan" : "Load Saved Preset"}
                </label>
                <select
                  id="hg-preset-select"
                  value={selectedConfigId}
                  onChange={(e) => applyConfigPreset(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Custom settings</option>
                  {configs.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="hg-track" className="text-[11px] text-muted-foreground">
                Track
              </label>
              <select
                id="hg-track"
                value={scanTrack}
                onChange={(e) => setScanTrack(e.target.value as ScanTrackInput)}
                className={INPUT_CLASS}
              >
                <option value="BOTH">BOTH (Early + Confirmed)</option>
                <option value="EARLY">EARLY Asymmetric</option>
                <option value="CONFIRMED">CONFIRMED Momentum</option>
              </select>
            </div>
            <div>
              <label htmlFor="hg-horizon" className="text-[11px] text-muted-foreground">
                Horizon
              </label>
              <select
                id="hg-horizon"
                value={scanHorizon}
                onChange={(e) => setScanHorizon(e.target.value as ScanHorizonInput)}
                className={INPUT_CLASS}
              >
                <option value="BOTH">BOTH (Short + Swing)</option>
                <option value="SHORT_TERM">SHORT_TERM (1–7d)</option>
                <option value="SWING">SWING (2–8w)</option>
              </select>
            </div>
            <div>
              <label htmlFor="hg-universe" className="text-[11px] text-muted-foreground">
                Universe Limit (50–1000)
              </label>
              <input
                id="hg-universe"
                type="number"
                min={50}
                max={1000}
                value={universeLimit}
                onChange={(e) => setUniverseLimit(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-min-age" className="text-[11px] text-muted-foreground">
                Min Listing Age (days)
              </label>
              <input
                id="hg-min-age"
                type="number"
                min={0}
                value={minListingDays}
                onChange={(e) => setMinListingDays(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-min-cap" className="text-[11px] text-muted-foreground">
                Min Market Cap (USD)
              </label>
              <input
                id="hg-min-cap"
                type="number"
                value={minCap}
                onChange={(e) => setMinCap(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-max-cap" className="text-[11px] text-muted-foreground">
                Max Market Cap (USD)
              </label>
              <input
                id="hg-max-cap"
                type="number"
                value={maxCap}
                onChange={(e) => setMaxCap(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-min-vol" className="text-[11px] text-muted-foreground">
                Min 24h Volume (USD)
              </label>
              <input
                id="hg-min-vol"
                type="number"
                value={minVol}
                onChange={(e) => setMinVol(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-min-ratio" className="text-[11px] text-muted-foreground">
                Min Vol / MCap
              </label>
              <input
                id="hg-min-ratio"
                type="number"
                step="0.01"
                value={minVolRatio}
                onChange={(e) => setMinVolRatio(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-max-24h" className="text-[11px] text-muted-foreground">
                Early Anti-Chase 24h (%)
              </label>
              <input
                id="hg-max-24h"
                type="number"
                value={maxEarly24h}
                onChange={(e) => setMaxEarly24h(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-max-7d" className="text-[11px] text-muted-foreground">
                Early Anti-Chase 7d (%)
              </label>
              <input
                id="hg-max-7d"
                type="number"
                value={maxEarly7d}
                onChange={(e) => setMaxEarly7d(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="hg-sched-freq" className="text-[11px] text-muted-foreground">
                {locale === "id" ? "Jadwal Auto-Rescan" : "Auto-Rescan Schedule"}
              </label>
              <select
                id="hg-sched-freq"
                value={scheduleMinutes}
                onChange={(e) => setScheduleMinutes(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="0">{locale === "id" ? "Manual Saja" : "Manual Only"}</option>
                <option value="360">Every 6 hours</option>
                <option value="720">Every 12 hours</option>
                <option value="1440">Daily (24h)</option>
              </select>
            </div>
            <div className="sm:col-span-2 flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="hg-preset-name" className="text-[11px] text-muted-foreground">
                  {locale === "id" ? "Simpan sebagai Preset Baru" : "Save as Preset"}
                </label>
                <input
                  id="hg-preset-name"
                  type="text"
                  placeholder="e.g. Early Mid-Cap Swing"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <Button
                size="md"
                variant="secondary"
                loading={savingPreset}
                disabled={!presetName.trim()}
                onClick={() => void handleSavePreset()}
              >
                {locale === "id" ? "Simpan" : "Save"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Hidden Gems workspace sections"
        className="flex flex-wrap gap-2 border-b border-border pb-3"
      >
        {(
          [
            {
              id: "feed",
              label: locale === "id" ? `Kandidat (${candidates.length})` : `Discovery Feed (${candidates.length})`,
              icon: Gem,
            },
            {
              id: "watchlist",
              label: locale === "id" ? `Watchlist (${watchlist.length})` : `Watchlist (${watchlist.length})`,
              icon: Star,
            },
            {
              id: "rejections",
              label:
                locale === "id"
                  ? `Penolakan & Log (${rejections.length})`
                  : `Rejections & Runs (${rejections.length})`,
              icon: AlertCircle,
            },
            {
              id: "alerts",
              label:
                locale === "id"
                  ? `Alert & Track Record (${alerts.length})`
                  : `Alerts & Track Record (${alerts.length})`,
              icon: Bell,
            },
          ] as const
        ).map((tab) => {
          const selected = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-3.5 py-2 text-xs font-semibold transition-colors ${
                selected
                  ? "border-primary/45 bg-primary/12 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: DISCOVERY FEED */}
      {activeTab === "feed" ? (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label htmlFor="f-track" className="text-[11px] text-muted-foreground">
                  Track
                </label>
                <select
                  id="f-track"
                  value={filterTrack}
                  onChange={(e) => setFilterTrack(e.target.value as DiscoveryTrack | "")}
                  className={INPUT_CLASS}
                >
                  <option value="">All Tracks</option>
                  <option value="EARLY">EARLY</option>
                  <option value="CONFIRMED">CONFIRMED</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-horizon" className="text-[11px] text-muted-foreground">
                  Horizon
                </label>
                <select
                  id="f-horizon"
                  value={filterHorizon}
                  onChange={(e) => setFilterHorizon(e.target.value as TradingHorizon | "")}
                  className={INPUT_CLASS}
                >
                  <option value="">All Horizons</option>
                  <option value="SHORT_TERM">SHORT_TERM</option>
                  <option value="SWING">SWING</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-conf" className="text-[11px] text-muted-foreground">
                  Confidence
                </label>
                <select
                  id="f-conf"
                  value={filterConfidence}
                  onChange={(e) =>
                    setFilterConfidence(e.target.value as "HIGH" | "MEDIUM" | "LOW" | "")
                  }
                  className={INPUT_CLASS}
                >
                  <option value="">All Levels</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-elig" className="text-[11px] text-muted-foreground">
                  Eligibility
                </label>
                <select
                  id="f-elig"
                  value={filterEligibility}
                  onChange={(e) => setFilterEligibility(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">All Statuses</option>
                  <option value="ELIGIBLE">ELIGIBLE</option>
                  <option value="WATCH">WATCH</option>
                  <option value="INSUFFICIENT_DATA">INSUFFICIENT_DATA</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-min" className="text-[11px] text-muted-foreground">
                  Min Adjusted Score
                </label>
                <input
                  id="f-min"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="e.g. 60"
                  value={filterMinScore}
                  onChange={(e) => setFilterMinScore(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </Card>

          {candidates.length === 0 ? (
            <EmptyState
              icon={<Gem className="h-5 w-5" aria-hidden="true" />}
              title={
                locale === "id" ? "Belum Ada Kandidat Hidden Gem" : "No Hidden Gem Candidates Yet"
              }
              description={
                locale === "id"
                  ? "Jalankan Discovery Scan untuk memindai pasar dan menghitung skor deterministik Early & Confirmed."
                  : "Run a Discovery Scan to ingest snapshots, apply hard gates, and score Early & Confirmed candidates."
              }
              action={
                <Button size="md" onClick={() => void handleRunScan()} loading={submittingScan}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                  {locale === "id" ? "Jalankan Scan Pertama" : "Run First Scan"}
                </Button>
              }
            />
          ) : (
            <>
              {/* Desktop Table */}
              <Card className="hidden overflow-hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border bg-card-elevated font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3">Asset</th>
                        <th className="px-3 py-3">Track / Horizon</th>
                        <th className="px-3 py-3 text-right">Score</th>
                        <th className="px-3 py-3">Confidence</th>
                        <th className="px-3 py-3">Status</th>
                        <th className="px-3 py-3 text-right">Price / MCap</th>
                        <th className="px-3 py-3 text-right">24h / 7d</th>
                        <th className="px-3 py-3 text-right">RS BTC 7d</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {candidates.map((cand) => {
                        const isWatched = watchlistByAsset.has(cand.asset_id);
                        return (
                          <tr
                            key={cand.id}
                            className="transition-colors hover:bg-muted/45"
                          >
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => void handleInspectCandidate(cand.id)}
                                className="cursor-pointer text-left font-semibold text-foreground hover:text-link"
                              >
                                {cand.symbol}
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                  {cand.name}
                                </span>
                              </button>
                              <p className="font-mono text-[10px] text-subtle-foreground">
                                CMC #{cand.canonical_provider_id}
                              </p>
                            </td>
                            <td className="px-3 py-3 font-mono text-[11px] text-foreground">
                              <span className="block font-semibold">{cand.discovery_track}</span>
                              <span className="text-muted-foreground">{cand.trading_horizon}</span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">
                              <span className="text-sm font-semibold text-foreground">
                                {formatScore(cand.adjusted_score)}
                              </span>
                              <span className="block text-[10px] text-muted-foreground">
                                Raw {formatScore(cand.raw_score)} · {formatWeightCoverage(cand.valid_weight_coverage)}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={confidenceBadgeTone(cand.confidence_level)}>
                                {cand.confidence_level}
                              </Badge>
                            </td>
                            <td className="px-3 py-3">
                              <Badge tone={eligibilityBadgeTone(cand.eligibility_status)}>
                                {cand.eligibility_status}
                              </Badge>
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums text-foreground">
                              <span className="block">{formatUsd(cand.price)}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatCompactUsd(cand.market_cap)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">
                              <span className={`block ${pctToneClass(cand.return_24h)}`}>
                                {formatPct(cand.return_24h, { signed: true })}
                              </span>
                              <span className={`text-[10px] ${pctToneClass(cand.return_7d)}`}>
                                {formatPct(cand.return_7d, { signed: true })}
                              </span>
                            </td>
                            <td className={`px-3 py-3 text-right font-mono tabular-nums ${pctToneClass(cand.rs_btc_7d)}`}>
                              {formatPct(cand.rs_btc_7d, { signed: true })}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label={isWatched ? `Remove ${cand.symbol} from watchlist` : `Watch ${cand.symbol}`}
                                  onClick={() => void handleToggleWatchlist(cand)}
                                  className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[8px] border transition-colors ${
                                    isWatched
                                      ? "border-primary/45 bg-primary/15 text-link"
                                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                                  }`}
                                >
                                  <Star className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void handleInspectCandidate(cand.id)}
                                >
                                  Inspect
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* Mobile / Small-Tablet Cards */}
              <div className="space-y-3 md:hidden">
                {candidates.map((cand) => {
                  const isWatched = watchlistByAsset.has(cand.asset_id);
                  return (
                    <Card key={cand.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {cand.symbol}{" "}
                            <span className="font-normal text-muted-foreground">{cand.name}</span>
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {cand.discovery_track} · {cand.trading_horizon}
                          </p>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-base font-semibold tabular-nums text-foreground">
                            {formatScore(cand.adjusted_score)}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {formatWeightCoverage(cand.valid_weight_coverage)} cov
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={eligibilityBadgeTone(cand.eligibility_status)}>
                          {cand.eligibility_status}
                        </Badge>
                        <Badge tone={confidenceBadgeTone(cand.confidence_level)}>
                          {cand.confidence_level}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
                        <div>
                          <span className="text-subtle-foreground block">MCap</span>
                          <span className="text-foreground">{formatCompactUsd(cand.market_cap)}</span>
                        </div>
                        <div>
                          <span className="text-subtle-foreground block">7d Ret</span>
                          <span className={pctToneClass(cand.return_7d)}>
                            {formatPct(cand.return_7d, { signed: true })}
                          </span>
                        </div>
                        <div>
                          <span className="text-subtle-foreground block">RS BTC</span>
                          <span className={pctToneClass(cand.rs_btc_7d)}>
                            {formatPct(cand.rs_btc_7d, { signed: true })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant={isWatched ? "primary" : "secondary"}
                          onClick={() => void handleToggleWatchlist(cand)}
                        >
                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                          {isWatched ? "Watching" : "Watch"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleInspectCandidate(cand.id)}
                        >
                          Inspect
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* TAB 2: WATCHLIST */}
      {activeTab === "watchlist" ? (
        watchlist.length === 0 ? (
          <EmptyState
            icon={<Star className="h-5 w-5" aria-hidden="true" />}
            title={locale === "id" ? "Watchlist Masih Kosong" : "Your Watchlist Is Empty"}
            description={
              locale === "id"
                ? "Tandai kandidat dari Discovery Feed untuk memantau perubahan skor pada scan berikutnya."
                : "Star any candidate from the Discovery Feed to track score changes across rescans."
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {watchlist.map((item) => (
              <Card key={item.id} className="p-4 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {item.symbol ?? item.asset_id.slice(0, 8)}{" "}
                      <span className="font-normal text-muted-foreground">{item.name ?? ""}</span>
                    </p>
                    <Badge tone="brand">{item.watch_status}</Badge>
                  </div>
                  {item.user_note ? (
                    <p className="mt-1.5 text-xs text-muted-foreground">{item.user_note}</p>
                  ) : null}
                  <p className="mt-2 font-mono text-[10px] text-subtle-foreground">
                    Added: {formatUtc(item.added_at)}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  {item.candidate_result_id ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleInspectCandidate(item.candidate_result_id!)}
                    >
                      Inspect
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleRemoveWatchlistItem(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {/* TAB 3: REJECTIONS & SCAN HISTORY */}
      {activeTab === "rejections" ? (
        <div className="space-y-4">
          {latestLimitations.length > 0 ? (
            <Card className="border-warning/40 bg-warning-soft p-4 text-xs text-foreground">
              <p className="font-semibold">
                {locale === "id" ? "Batasan Data Scan Terbaru" : "Latest Scan Data Limitations"}
              </p>
              <ul className="mt-1.5 list-disc pl-5 space-y-1">
                {latestLimitations.map((lim) => (
                  <li key={lim}>{lim}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {locale === "id" ? "Riwayat Eksekusi Scan" : "Recent Scan Runs"}
            </h2>
            {scans.length === 0 ? (
              <p className="text-xs text-muted-foreground">No scans recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border font-mono text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Run ID</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Tier / Profile</th>
                      <th className="py-2 px-3">Regime</th>
                      <th className="py-2 px-3 text-right">Eligible / Rejected</th>
                      <th className="py-2 pl-3 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-[11px]">
                    {scans.map((run) => (
                      <tr key={run.id}>
                        <td className="py-2.5 pr-3 text-foreground">#{run.id.slice(0, 8)}</td>
                        <td className="py-2.5 px-3">
                          <Badge tone={scanStatusTone(run.status)}>{run.status}</Badge>
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">
                          {run.effective_tier} · {run.evaluation_profile}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground">{run.market_regime}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-foreground">
                          {run.candidates_eligible} / {run.candidates_rejected}
                        </td>
                        <td className="py-2.5 pl-3 text-right text-muted-foreground">
                          {formatUtc(run.completed_at ?? run.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {locale === "id" ? "Audit Log Penolakan Hard-Gate" : "Latest Hard-Gate Rejections"}
            </h2>
            {rejections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No rejections logged for the latest scan run.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-border">
                {rejections.slice(0, 60).map((rej) => (
                  <div key={rej.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-mono font-semibold text-foreground">
                        {rej.symbol ?? rej.asset_id?.slice(0, 8) ?? "ASSET"}
                      </span>{" "}
                      <span className="text-muted-foreground">— {rej.rejection_reason}</span>
                    </div>
                    <Badge tone="neutral">
                      {rej.rejection_stage}/{rej.rejection_code}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {/* TAB 4: ALERTS & TRACK RECORD */}
      {activeTab === "alerts" ? (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-link" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {locale === "id"
                  ? "Track Record Outcome (T+7d Evaluasi)"
                  : "Discovery Forward Quality Track Record"}
              </h2>
            </div>
            {qualityStats.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {locale === "id"
                  ? "Checkpoint hasil forward T+1/3/7/14/30 hari mulai terbentuk setelah kandidat ELIGIBLE pertama tersimpan."
                  : "Forward T+1/3/7/14/30d checkpoints populate once ELIGIBLE candidates are discovered."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border font-mono text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">Version</th>
                      <th className="py-2 px-3">Track</th>
                      <th className="py-2 px-3">Tier</th>
                      <th className="py-2 px-3 text-right">Tracked</th>
                      <th className="py-2 px-3 text-right">Evaluated 7d</th>
                      <th className="py-2 px-3 text-right">Hit Rate 7d</th>
                      <th className="py-2 pl-3 text-right">Avg Rel BTC 7d</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-[11px] tabular-nums">
                    {qualityStats.map((row) => (
                      <tr key={`${row.score_version}-${row.discovery_track}-${row.effective_tier}`}>
                        <td className="py-2.5 pr-3 text-foreground">{row.score_version}</td>
                        <td className="py-2.5 px-3 text-foreground">{row.discovery_track}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{row.effective_tier}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">{row.total_tracked}</td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">{row.evaluated_7d}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">
                          {row.positive_7d_rate !== null
                            ? `${(row.positive_7d_rate * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className={`py-2.5 pl-3 text-right ${pctToneClass(row.avg_rel_btc_7d)}`}>
                          {formatPct(row.avg_rel_btc_7d, { signed: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {locale === "id" ? "Alert Discovery Terakhir (Dedup 6 Jam)" : "In-App Discovery Alerts"}
            </h2>
            {alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No alerts emitted yet.</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((al) => (
                  <div
                    key={al.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-card-elevated px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          al.severity === "HIGH"
                            ? "destructive"
                            : al.severity === "MEDIUM"
                              ? "warning"
                              : "info"
                        }
                      >
                        {al.severity}
                      </Badge>
                      <span className="font-mono font-semibold text-foreground">
                        {al.event_type}
                      </span>
                      <span className="font-mono text-muted-foreground">
                        {String(al.payload?.symbol ?? "")}
                        {typeof al.payload?.adjusted_score === "number"
                          ? ` · Score ${al.payload.adjusted_score.toFixed(1)}`
                          : ""}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-subtle-foreground">
                      {formatUtc(al.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <HiddenGemDetailModal
        open={modalOpen}
        loading={detailLoading}
        error={detailError}
        detail={detail}
        locale={locale}
        watched={Boolean(detail && watchlistByAsset.has(detail.candidate.asset_id))}
        onToggleWatchlist={(c) => void handleToggleWatchlist(c)}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
