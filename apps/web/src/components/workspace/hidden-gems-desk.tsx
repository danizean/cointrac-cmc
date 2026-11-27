"use client";

import {
  Activity,
  AlertCircle,
  ArrowUpDown,
  Bell,
  ChevronDown,
  ChevronUp,
  Gem,
  Layers,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  Trash2,
  X,
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
import { useDeskCache, writeDeskCache } from "@/lib/desk-cache";
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
  dedupeCandidatesByAsset,
  eligibilityBadgeTone,
  formatScore,
  formatWeightCoverage,
  pickDefaultScanRunId,
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
import { HiddenGemScanProgress } from "./hidden-gem-scan-progress";

type DeskTab = "feed" | "watchlist" | "rejections" | "alerts";
type SortMetric = "score" | "return_24h" | "return_7d" | "rs_btc_7d" | "market_cap";
type ConfidenceFilter = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT" | "";

const INPUT_CLASS =
  "mt-1 min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

const COMPACT_SELECT_CLASS =
  "min-h-9 rounded-[8px] border border-border bg-input-bg px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none";

function optionalFloat(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const val = Number(trimmed);
  return Number.isFinite(val) ? val : null;
}

function scoreBarColor(score: number | null): string {
  if (score === null) return "bg-muted-foreground/40";
  if (score >= 80) return "bg-positive";
  if (score >= 65) return "bg-primary";
  return "bg-warning";
}

function sortMetricValue(cand: CandidateSummary, sortBy: SortMetric): number {
  if (sortBy === "return_24h") return cand.return_24h ?? Number.NEGATIVE_INFINITY;
  if (sortBy === "return_7d") return cand.return_7d ?? Number.NEGATIVE_INFINITY;
  if (sortBy === "rs_btc_7d") return cand.rs_btc_7d ?? Number.NEGATIVE_INFINITY;
  if (sortBy === "market_cap") return cand.market_cap ?? Number.POSITIVE_INFINITY;
  return cand.adjusted_score ?? -1;
}

interface HiddenGemsWorkspaceCache {
  scans: ScanRunSummary[];
  configs: ScanConfigItem[];
  watchlist: WatchlistItem[];
  alerts: AlertEventItem[];
  qualityStats: QualityStatsRow[];
  candidates: CandidateSummary[];
  rejections: RejectionSummary[];
}

const EMPTY_SCANS: ScanRunSummary[] = [];
const EMPTY_CANDIDATES: CandidateSummary[] = [];
const EMPTY_REJECTIONS: RejectionSummary[] = [];
const EMPTY_CONFIGS: ScanConfigItem[] = [];
const EMPTY_WATCHLIST: WatchlistItem[] = [];
const EMPTY_ALERTS: AlertEventItem[] = [];
const EMPTY_QUALITY: QualityStatsRow[] = [];

export function HiddenGemsDesk() {
  const { locale } = useAppPreferences();
  const cachedWorkspace = useDeskCache<HiddenGemsWorkspaceCache>("hidden-gems:workspace");
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

  // Feed scope, grouping, search & quant filters
  const [runScope, setRunScope] = useState<string>("latest_completed");
  const [groupByAsset, setGroupByAsset] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortMetric>("score");
  const [filterTrack, setFilterTrack] = useState<DiscoveryTrack | "">("");
  const [filterHorizon, setFilterHorizon] = useState<TradingHorizon | "">("");
  const [filterMinScore, setFilterMinScore] = useState("");
  const [filterConfidence, setFilterConfidence] = useState<ConfidenceFilter>("");
  const [filterEligibility, setFilterEligibility] = useState("");

  // Server state
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submittingScan, setSubmittingScan] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [notice, setNotice] = useState<{ status: number; message: string } | null>(null);

  const [liveScans, setScans] = useState<ScanRunSummary[] | null>(null);
  const [liveCandidates, setCandidates] = useState<CandidateSummary[] | null>(null);
  const [liveRejections, setRejections] = useState<RejectionSummary[] | null>(null);
  const [liveConfigs, setConfigs] = useState<ScanConfigItem[] | null>(null);
  const [liveWatchlist, setWatchlist] = useState<WatchlistItem[] | null>(null);
  const [liveAlerts, setAlerts] = useState<AlertEventItem[] | null>(null);
  const [liveQualityStats, setQualityStats] = useState<QualityStatsRow[] | null>(null);

  const scans = liveScans ?? cachedWorkspace?.value.scans ?? EMPTY_SCANS;
  const candidates = liveCandidates ?? cachedWorkspace?.value.candidates ?? EMPTY_CANDIDATES;
  const rejections = liveRejections ?? cachedWorkspace?.value.rejections ?? EMPTY_REJECTIONS;
  const configs = liveConfigs ?? cachedWorkspace?.value.configs ?? EMPTY_CONFIGS;
  const watchlist = liveWatchlist ?? cachedWorkspace?.value.watchlist ?? EMPTY_WATCHLIST;
  const alerts = liveAlerts ?? cachedWorkspace?.value.alerts ?? EMPTY_ALERTS;
  const qualityStats = liveQualityStats ?? cachedWorkspace?.value.qualityStats ?? EMPTY_QUALITY;

  // Detail modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  const [modalVariants, setModalVariants] = useState<CandidateSummary[]>([]);

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapDone = useRef(false);
  const filterStateRef = useRef({
    runScope,
    filterTrack,
    filterHorizon,
    filterMinScore,
    filterConfidence,
    filterEligibility,
  });

  useEffect(() => {
    filterStateRef.current = {
      runScope,
      filterTrack,
      filterHorizon,
      filterMinScore,
      filterConfidence,
      filterEligibility,
    };
  }, [
    runScope,
    filterTrack,
    filterHorizon,
    filterMinScore,
    filterConfidence,
    filterEligibility,
  ]);

  const latestScan = scans[0] ?? null;
  const activeScan = scans.find((s) => s.status === "QUEUED" || s.status === "RUNNING") ?? null;

  const resolvedRunId = useMemo(() => {
    if (runScope === "all") return undefined;
    if (runScope === "latest_completed") {
      return pickDefaultScanRunId(scans) ?? undefined;
    }
    return runScope;
  }, [runScope, scans]);

  const inspectedScan = useMemo(() => {
    if (resolvedRunId) {
      return scans.find((s) => s.id === resolvedRunId) ?? latestScan;
    }
    return latestScan;
  }, [latestScan, resolvedRunId, scans]);

  const watchlistByAsset = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const item of watchlist) {
      map.set(item.asset_id, item);
    }
    return map;
  }, [watchlist]);

  const fetchFilteredCandidatesOnly = useCallback(
    async (scansSource: ScanRunSummary[]) => {
      const targetRunId =
        runScope === "all"
          ? undefined
          : runScope === "latest_completed"
            ? (pickDefaultScanRunId(scansSource) ?? undefined)
            : runScope;
      const detailRunId = targetRunId ?? scansSource[0]?.id;
      const [candidatesRes, scanDetailRes] = await Promise.all([
        fetchHiddenGemCandidates({
          track: filterTrack,
          horizon: filterHorizon,
          min_score: optionalFloat(filterMinScore),
          confidence: filterConfidence,
          eligibility: filterEligibility || undefined,
          run_id: targetRunId,
          limit: 120,
        }),
        detailRunId && scansSource.find((s) => s.id === detailRunId)?.status !== "QUEUED"
          ? fetchHiddenGemScanDetail(detailRunId)
          : Promise.resolve(null),
      ]);
      if (candidatesRes.ok) {
        setCandidates(candidatesRes.data);
      } else {
        setNotice({ status: candidatesRes.status, message: candidatesRes.message });
      }
      if (scanDetailRes && scanDetailRes.ok) {
        setRejections(scanDetailRes.data.rejections);
      } else {
        setRejections([]);
      }
    },
    [
      filterConfidence,
      filterEligibility,
      filterHorizon,
      filterMinScore,
      filterTrack,
      runScope,
    ],
  );

  const loadWorkspaceData = useCallback(async () => {
    const filters = filterStateRef.current;
    try {
      const minScoreVal = optionalFloat(filters.filterMinScore);
      const [scansRes, configsRes, watchlistRes, alertsRes, qualityRes] = await Promise.all([
        fetchHiddenGemScans(20),
        fetchHiddenGemConfigs(),
        fetchHiddenGemWatchlist(),
        fetchHiddenGemAlerts(40),
        fetchHiddenGemQualityStats(),
      ]);

      if (!scansRes.ok) {
        setNotice({ status: scansRes.status, message: scansRes.message });
        return;
      }

      setScans(scansRes.data);
      if (configsRes.ok) setConfigs(configsRes.data);
      if (watchlistRes.ok) setWatchlist(watchlistRes.data);
      if (alertsRes.ok) setAlerts(alertsRes.data);
      if (qualityRes.ok) setQualityStats(qualityRes.data);

      const targetRunId =
        filters.runScope === "all"
          ? undefined
          : filters.runScope === "latest_completed"
            ? (pickDefaultScanRunId(scansRes.data) ?? undefined)
            : filters.runScope;

      const detailRunId = targetRunId ?? scansRes.data[0]?.id;
      const [candidatesRes, scanDetailRes] = await Promise.all([
        fetchHiddenGemCandidates({
          track: filters.filterTrack,
          horizon: filters.filterHorizon,
          min_score: minScoreVal,
          confidence: filters.filterConfidence,
          eligibility: filters.filterEligibility || undefined,
          run_id: targetRunId,
          limit: 120,
        }),
        detailRunId && scansRes.data.find((s) => s.id === detailRunId)?.status !== "QUEUED"
          ? fetchHiddenGemScanDetail(detailRunId)
          : Promise.resolve(null),
      ]);

      const firstError = [
        configsRes,
        watchlistRes,
        alertsRes,
        qualityRes,
        candidatesRes,
      ].find((res) => !res.ok);

      if (firstError && !firstError.ok) {
        setNotice({ status: firstError.status, message: firstError.message });
      } else {
        setNotice(null);
      }

      const nextCandidates = candidatesRes.ok ? candidatesRes.data : [];
      const nextRejections = scanDetailRes && scanDetailRes.ok ? scanDetailRes.data.rejections : [];
      if (candidatesRes.ok) setCandidates(nextCandidates);
      setRejections(nextRejections);

      writeDeskCache("hidden-gems:workspace", {
        scans: scansRes.data,
        configs: configsRes.ok ? configsRes.data : [],
        watchlist: watchlistRes.ok ? watchlistRes.data : [],
        alerts: alertsRes.ok ? alertsRes.data : [],
        qualityStats: qualityRes.ok ? qualityRes.data : [],
        candidates: nextCandidates,
        rejections: nextRejections,
      });
    } finally {
      bootstrapDone.current = true;
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => void loadWorkspaceData());
    // Intentionally run once on mount; filter updates use fetchFilteredCandidatesOnly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!bootstrapDone.current) return;
    void Promise.resolve().then(() => void fetchFilteredCandidatesOnly(scans));
    // Only re-fetch candidates when filter state changes (never re-fetch configs/alerts/quality).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFilteredCandidatesOnly]);

  useEffect(() => {
    if (!activeScan) return;
    pollTimer.current = setTimeout(() => {
      void fetchHiddenGemScans(20).then((res) => {
        if (!res.ok) {
          setNotice({ status: res.status, message: res.message });
          return;
        }
        setScans(res.data);
        const stillRunning = res.data.some(
          (s) => s.status === "QUEUED" || s.status === "RUNNING",
        );
        if (!stillRunning) {
          void loadWorkspaceData();
        }
      });
    }, 2500);
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
    setRunScope("latest_completed");
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
    if (
      found.discovery_track === "EARLY" ||
      found.discovery_track === "CONFIRMED" ||
      found.discovery_track === "BOTH"
    ) {
      setScanTrack(found.discovery_track);
    }
    if (
      found.trading_horizon === "SHORT_TERM" ||
      found.trading_horizon === "SWING" ||
      found.trading_horizon === "BOTH"
    ) {
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
    if (typeof f.max_early_return_24h_pct === "number") {
      setMaxEarly24h(String(f.max_early_return_24h_pct));
    }
    if (typeof f.max_early_return_7d_pct === "number") {
      setMaxEarly7d(String(f.max_early_return_7d_pct));
    }
    const sched = found.schedule_config ?? {};
    if (sched.enabled && typeof sched.interval_minutes === "number") {
      setScheduleMinutes(String(sched.interval_minutes));
    } else {
      setScheduleMinutes("0");
    }
  }

  async function handleInspectCandidate(
    candidateId: string,
    variants: CandidateSummary[] = [],
  ) {
    setModalOpen(true);
    setModalVariants(variants);
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
      setWatchlist((prev) => (prev ?? watchlist).filter((item) => item.id !== existing.id));
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
    setWatchlist((prev) => [res.data, ...(prev ?? watchlist).filter((w) => w.asset_id !== res.data.asset_id)]);
  }

  async function handleRemoveWatchlistItem(itemId: string) {
    const res = await removeFromHiddenGemWatchlist(itemId);
    if (!res.ok) {
      setNotice({ status: res.status, message: res.message });
      return;
    }
    setWatchlist((prev) => (prev ?? watchlist).filter((item) => item.id !== itemId));
  }

  const displayedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? candidates.filter(
          (c) =>
            c.symbol.toLowerCase().includes(q) ||
            c.name.toLowerCase().includes(q) ||
            c.canonical_provider_id.toLowerCase().includes(q),
        )
      : candidates;

    const groups = groupByAsset
      ? dedupeCandidatesByAsset(filtered)
      : filtered.map((row) => ({ primary: row, variants: [row] }));

    return [...groups].sort((a, b) => {
      const va = sortMetricValue(a.primary, sortBy);
      const vb = sortMetricValue(b.primary, sortBy);
      if (sortBy === "market_cap") return va - vb;
      return vb - va;
    });
  }, [candidates, groupByAsset, searchQuery, sortBy]);

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      filterTrack ||
      filterHorizon ||
      filterConfidence ||
      filterEligibility ||
      filterMinScore.trim() ||
      sortBy !== "score",
  );

  function resetAllFilters() {
    setSearchQuery("");
    setFilterTrack("");
    setFilterHorizon("");
    setFilterConfidence("");
    setFilterEligibility("");
    setFilterMinScore("");
    setSortBy("score");
  }

  const latestLimitations = useMemo(() => {
    const raw = inspectedScan?.source_metadata?.limitations;
    return Array.isArray(raw) ? raw.map(String) : [];
  }, [inspectedScan]);

  const outcomeOverview = useMemo(() => {
    const totalTracked = qualityStats.reduce((sum, r) => sum + r.total_tracked, 0);
    const totalEval7d = qualityStats.reduce((sum, r) => sum + r.evaluated_7d, 0);
    let weightedHits = 0;
    for (const row of qualityStats) {
      if (row.positive_7d_rate !== null && row.evaluated_7d > 0) {
        weightedHits += row.positive_7d_rate * row.evaluated_7d;
      }
    }
    const hitRatePct = totalEval7d > 0 ? (weightedHits / totalEval7d) * 100 : null;
    return { totalTracked, totalEval7d, hitRatePct };
  }, [qualityStats]);

  if (initialLoading && !cachedWorkspace) {
    return <DeskSkeleton />;
  }

  const funnelTotal = Math.max(1, inspectedScan?.universe_scanned ?? 0);
  const eligiblePct = inspectedScan
    ? Math.min(100, (inspectedScan.candidates_eligible / funnelTotal) * 100)
    : 0;
  const watchCount = inspectedScan
    ? Math.max(0, inspectedScan.candidates_discovered - inspectedScan.candidates_eligible)
    : 0;
  const watchPct = inspectedScan ? Math.min(100 - eligiblePct, (watchCount / funnelTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hidden Gem Discovery"
        description={
          locale === "id"
            ? "Terminal riset altcoin deterministik untuk jalur Early Asymmetric & Confirmed Momentum dengan rincian komponen, penolakan hard-gate, dan audit bukti."
            : "Deterministic Early Asymmetric & Confirmed Momentum research desk with component scoring, hard-gate rejection audit, and forward outcome tracking."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowBuilder((prev) => !prev)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === "id" ? "Parameter Scan" : "Scan Parameters"}
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
                {locale === "id" ? "Jalankan Scan" : "Run Discovery Scan"}
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

      {/* Institutional 4-Card Telemetry Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
              {locale === "id" ? "Status Scan Terbaru" : "Latest Scan Run"}
            </p>
            {latestScan ? (
              <span className="font-mono text-[10px] text-subtle-foreground">
                #{latestScan.id.slice(0, 8)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            {latestScan ? (
              <Badge tone={scanStatusTone(latestScan.status)}>
                {(latestScan.status === "RUNNING" || latestScan.status === "QUEUED") && (
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                )}
                {latestScan.status}
              </Badge>
            ) : (
              <Badge tone="neutral">IDLE</Badge>
            )}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {latestScan ? `${latestScan.universe_scanned} scanned` : "No runs"}
            </span>
          </div>
          {latestScan?.error_summary ? (
            <p className="truncate font-mono text-[10px] text-destructive" title={latestScan.error_summary}>
              {latestScan.error_summary}
            </p>
          ) : (
            <p className="font-mono text-[10px] text-subtle-foreground">
              {latestScan ? formatUtc(latestScan.completed_at ?? latestScan.created_at) : "Ready"}
            </p>
          )}
        </Card>

        <Card className="p-4 flex flex-col justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Tier & Rezim Pasar" : "Capability & Regime"}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{inspectedScan?.effective_tier ?? "BASIC"}</Badge>
            <Badge tone="neutral">{inspectedScan?.market_regime ?? "UNKNOWN"}</Badge>
          </div>
          <p className="truncate font-mono text-[10px] text-subtle-foreground">
            {inspectedScan?.evaluation_profile ?? "BASIC_CAPABILITY_PROFILE"}
          </p>
        </Card>

        <Card className="p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
              {locale === "id" ? "Funnel Seleksi" : "Screening Yield"}
            </p>
            {inspectedScan ? (
              <span className="font-mono text-[10px] text-subtle-foreground">
                #{inspectedScan.id.slice(0, 8)}
              </span>
            ) : null}
          </div>
          <p className="font-mono text-base font-semibold tabular-nums text-foreground">
            <span className="text-positive">{inspectedScan?.candidates_eligible ?? 0}</span>
            <span className="mx-1 text-xs font-normal text-muted-foreground">eligible</span>
            <span className="text-xs font-normal text-subtle-foreground">
              / {inspectedScan?.candidates_discovered ?? 0} scored ·{" "}
              {inspectedScan?.candidates_rejected ?? 0} rejected
            </span>
          </p>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-positive" style={{ width: `${eligiblePct}%` }} />
            <div className="h-full bg-primary/60" style={{ width: `${watchPct}%` }} />
          </div>
        </Card>

        <Card className="p-4 flex flex-col justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Kredit & Track Record" : "Credits & Outcome Hit Rate"}
          </p>
          <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
            <span className="text-base font-semibold text-foreground">
              {inspectedScan?.cmc_credits_consumed ?? 0}{" "}
              <span className="text-xs font-normal text-muted-foreground">cr</span>
            </span>
            <span className="text-xs text-muted-foreground">
              7d Hit:{" "}
              <span className="font-semibold text-foreground">
                {outcomeOverview.hitRatePct !== null
                  ? `${outcomeOverview.hitRatePct.toFixed(1)}%`
                  : "—"}
              </span>
            </span>
          </div>
          <p className="font-mono text-[10px] text-subtle-foreground">
            {watchlist.length} watchlist · {outcomeOverview.totalTracked} tracked ({outcomeOverview.totalEval7d} eval 7d)
          </p>
        </Card>
      </div>

      {/* Live Transparent Progress Panel while QUEUED or RUNNING */}
      {activeScan ? (
        <HiddenGemScanProgress
          scan={activeScan}
          locale={locale}
          cancelling={cancellingId === activeScan.id}
          onCancel={(scanId) => void handleCancelScan(scanId)}
        />
      ) : null}

      {/* Collapsible Scan Builder */}
      {showBuilder ? (
        <Card elevated className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {locale === "id" ? "Parameter Discovery Scan" : "Discovery Scan Parameters"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {locale === "id"
                  ? "Atur jalur riset, horizon perdagangan, dan batas penyaring likuiditas/anti-chase."
                  : "Configure discovery track, trading horizon, universe limit, and hard-gate overrides."}
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
              label:
                locale === "id"
                  ? `Kandidat (${displayedRows.length})`
                  : `Discovery Feed (${displayedRows.length})`,
              icon: Gem,
            },
            {
              id: "watchlist",
              label: `Watchlist (${watchlist.length})`,
              icon: Star,
            },
            {
              id: "rejections",
              label:
                locale === "id"
                  ? `Riwayat Scan & Penolakan (${rejections.length})`
                  : `Runs & Rejections (${rejections.length})`,
              icon: AlertCircle,
            },
            {
              id: "alerts",
              label:
                locale === "id"
                  ? `Track Record & Event (${alerts.length})`
                  : `Outcomes & Events (${alerts.length})`,
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
          <Card className="p-4 space-y-3">
            {/* Toolbar Row 1: Scope, View Mode, Quick Search & Sort */}
            <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <label htmlFor="f-run-scope" className="text-[11px] font-medium text-muted-foreground">
                    {locale === "id" ? "Sumber Scan:" : "Scan Scope:"}
                  </label>
                  <select
                    id="f-run-scope"
                    value={runScope}
                    onChange={(e) => setRunScope(e.target.value)}
                    className={COMPACT_SELECT_CLASS}
                  >
                    <option value="latest_completed">
                      {locale === "id" ? "Scan Selesai Terbaru" : "Latest Completed Run"}
                    </option>
                    <option value="all">
                      {locale === "id" ? "Semua Riwayat Scan" : "All Historical Runs"}
                    </option>
                    {scans.map((run) => (
                      <option key={run.id} value={run.id}>
                        #{run.id.slice(0, 8)} · {run.status} ({run.candidates_eligible} elig)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Group 1 Row per Asset vs All Pairs */}
                <div
                  role="group"
                  aria-label="Candidate row grouping"
                  className="inline-flex rounded-[8px] border border-border bg-background p-0.5"
                >
                  <button
                    type="button"
                    onClick={() => setGroupByAsset(true)}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      groupByAsset
                        ? "bg-card-elevated text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Layers className="h-3 w-3" aria-hidden="true" />
                    {locale === "id" ? "1 Baris / Koin" : "Best / Asset"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroupByAsset(false)}
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-[6px] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      !groupByAsset
                        ? "bg-card-elevated text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {locale === "id" ? "Semua Track × Horizon" : "All Track × Horizon"}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 sm:w-52 sm:flex-none">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    aria-label="Filter ticker or asset name"
                    placeholder={locale === "id" ? "Cari ticker / nama..." : "Filter symbol / name..."}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="min-h-9 w-full rounded-[8px] border border-border bg-input-bg pl-8 pr-2.5 font-mono text-[11px] text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden="true" />
                  <select
                    aria-label="Sort candidates by"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortMetric)}
                    className={COMPACT_SELECT_CLASS}
                  >
                    <option value="score">Score ↓</option>
                    <option value="rs_btc_7d">RS vs BTC 7d ↓</option>
                    <option value="return_7d">7d Return ↓</option>
                    <option value="return_24h">24h Return ↓</option>
                    <option value="market_cap">Market Cap ↑</option>
                  </select>
                </div>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-[8px] border border-border bg-card px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Reset
                  </button>
                ) : null}
              </div>
            </div>

            {/* Toolbar Row 2: Quantitative Filters */}
            <div className="grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-5">
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
                  onChange={(e) => setFilterConfidence(e.target.value as ConfidenceFilter)}
                  className={INPUT_CLASS}
                >
                  <option value="">All Levels</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                  <option value="INSUFFICIENT">INSUFFICIENT</option>
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
                  <option value="REJECTED">REJECTED</option>
                  <option value="INSUFFICIENT_DATA">INSUFFICIENT_DATA</option>
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="f-min" className="text-[11px] text-muted-foreground">
                  Min Adjusted Score
                </label>
                <input
                  id="f-min"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="e.g. 65"
                  value={filterMinScore}
                  onChange={(e) => setFilterMinScore(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </Card>

          {displayedRows.length === 0 ? (
            <EmptyState
              icon={<Gem className="h-5 w-5" aria-hidden="true" />}
              title={
                hasActiveFilters
                  ? locale === "id"
                    ? "Tidak Ada Kandidat yang Cocok dengan Filter"
                    : "No Candidates Match Active Filters"
                  : locale === "id"
                    ? "Belum Ada Kandidat pada Scan Ini"
                    : "No Hidden Gem Candidates Found"
              }
              description={
                hasActiveFilters
                  ? locale === "id"
                    ? "Reset filter atau ubah cakupan scan ke Semua Riwayat Scan."
                    : "Reset active filters or switch Scan Scope to inspect older runs."
                  : locale === "id"
                    ? "Jalankan Discovery Scan untuk memindai pasar dan menghitung skor deterministik Early & Confirmed."
                    : "Run a Discovery Scan to ingest snapshots, apply hard gates, and score Early & Confirmed candidates."
              }
              action={
                hasActiveFilters ? (
                  <Button size="md" variant="secondary" onClick={resetAllFilters}>
                    Reset Filters
                  </Button>
                ) : (
                  <Button size="md" onClick={() => void handleRunScan()} loading={submittingScan}>
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {locale === "id" ? "Jalankan Scan Pertama" : "Run Discovery Scan"}
                  </Button>
                )
              }
            />
          ) : (
            <>
              {/* Desktop Institutional Table */}
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
                      {displayedRows.map(({ primary: cand, variants }) => {
                        const isWatched = watchlistByAsset.has(cand.asset_id);
                        return (
                          <tr
                            key={cand.id}
                            className="transition-colors hover:bg-muted/45"
                          >
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => void handleInspectCandidate(cand.id, variants)}
                                className="cursor-pointer text-left font-semibold text-foreground hover:text-link"
                              >
                                {cand.symbol}
                                <span className="ml-1.5 font-normal text-muted-foreground">
                                  {cand.name}
                                </span>
                              </button>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-subtle-foreground">
                                <span>CMC #{cand.canonical_provider_id}</span>
                                {runScope === "all" && cand.created_at ? (
                                  <span>· {formatUtc(cand.created_at)}</span>
                                ) : null}
                                {variants.length > 1 ? (
                                  <span className="rounded bg-muted px-1.5 py-0.2 text-muted-foreground">
                                    +{variants.length - 1} tracks
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-3 font-mono text-[11px] text-foreground">
                              <span className="block font-semibold">{cand.discovery_track}</span>
                              <span className="text-muted-foreground">{cand.trading_horizon}</span>
                            </td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">
                              <div className="ml-auto flex max-w-[96px] flex-col items-end gap-1">
                                <span className="text-sm font-semibold text-foreground">
                                  {formatScore(cand.adjusted_score)}
                                </span>
                                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={`h-full rounded-full ${scoreBarColor(cand.adjusted_score)}`}
                                    style={{
                                      width: `${
                                        cand.adjusted_score !== null
                                          ? Math.max(0, Math.min(100, cand.adjusted_score))
                                          : 0
                                      }%`,
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] text-subtle-foreground">
                                  {formatWeightCoverage(cand.valid_weight_coverage)} cov
                                </span>
                              </div>
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
                            <td
                              className={`px-3 py-3 text-right font-mono tabular-nums ${pctToneClass(cand.rs_btc_7d)}`}
                            >
                              {cand.rs_btc_7d !== null
                                ? `${cand.rs_btc_7d >= 0 ? "+" : ""}${cand.rs_btc_7d.toFixed(1)} pp`
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-label={
                                    isWatched
                                      ? `Remove ${cand.symbol} from watchlist`
                                      : `Watch ${cand.symbol}`
                                  }
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
                                  onClick={() => void handleInspectCandidate(cand.id, variants)}
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
                {displayedRows.map(({ primary: cand, variants }) => {
                  const isWatched = watchlistByAsset.has(cand.asset_id);
                  return (
                    <Card key={cand.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => void handleInspectCandidate(cand.id, variants)}
                          className="cursor-pointer text-left"
                        >
                          <p className="text-sm font-semibold text-foreground hover:text-link">
                            {cand.symbol}{" "}
                            <span className="font-normal text-muted-foreground">{cand.name}</span>
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {cand.discovery_track} · {cand.trading_horizon}
                            {variants.length > 1 ? ` · +${variants.length - 1} tracks` : ""}
                          </p>
                        </button>
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

                      <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums sm:grid-cols-4">
                        <div>
                          <span className="block text-subtle-foreground">Price</span>
                          <span className="text-foreground">{formatUsd(cand.price)}</span>
                        </div>
                        <div>
                          <span className="block text-subtle-foreground">MCap</span>
                          <span className="text-foreground">{formatCompactUsd(cand.market_cap)}</span>
                        </div>
                        <div>
                          <span className="block text-subtle-foreground">24h / 7d</span>
                          <span className={pctToneClass(cand.return_24h)}>
                            {formatPct(cand.return_24h, { signed: true })}
                          </span>
                          <span className="text-subtle-foreground"> / </span>
                          <span className={pctToneClass(cand.return_7d)}>
                            {formatPct(cand.return_7d, { signed: true })}
                          </span>
                        </div>
                        <div>
                          <span className="block text-subtle-foreground">RS BTC 7d</span>
                          <span className={pctToneClass(cand.rs_btc_7d)}>
                            {cand.rs_btc_7d !== null
                              ? `${cand.rs_btc_7d >= 0 ? "+" : ""}${cand.rs_btc_7d.toFixed(1)} pp`
                              : "—"}
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
                          onClick={() => void handleInspectCandidate(cand.id, variants)}
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
                {locale === "id" ? "Batasan Data Scan Aktif" : "Selected Scan Data Limitations"}
              </p>
              <ul className="mt-1.5 list-disc pl-5 space-y-1">
                {latestLimitations.map((lim) => (
                  <li key={lim}>{lim}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {locale === "id" ? "Riwayat Eksekusi Scan" : "Recent Scan Runs"}
              </h2>
              <span className="text-[11px] text-muted-foreground">
                {locale === "id"
                  ? "Klik 'Lihat Feed' untuk memeriksa hasil run tertentu."
                  : "Select 'View Feed' to inspect candidates from a run."}
              </span>
            </div>
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
                      <th className="py-2 px-3 text-right">Timestamp</th>
                      <th className="py-2 pl-3 text-right">Feed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-[11px]">
                    {scans.map((run) => (
                      <tr key={run.id} className="hover:bg-muted/35">
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
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {formatUtc(run.completed_at ?? run.created_at)}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <Button
                            size="sm"
                            variant={resolvedRunId === run.id ? "primary" : "secondary"}
                            onClick={() => {
                              setRunScope(run.id);
                              setActiveTab("feed");
                            }}
                          >
                            {locale === "id" ? "Lihat Feed" : "View Feed"}
                          </Button>
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
              {locale === "id"
                ? `Audit Log Penolakan Hard-Gate (${inspectedScan ? `#${inspectedScan.id.slice(0, 8)}` : "—"})`
                : `Hard-Gate Rejections (${inspectedScan ? `#${inspectedScan.id.slice(0, 8)}` : "—"})`}
            </h2>
            {rejections.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No rejections logged for the inspected scan run.
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-border">
                {rejections.slice(0, 60).map((rej) => (
                  <div
                    key={rej.id}
                    className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
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

      {/* TAB 4: OUTCOMES & EVENTS */}
      {activeTab === "alerts" ? (
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-link" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">
                {locale === "id"
                  ? "Track Record Forward Outcome (T+7d / T+30d)"
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
                      <th className="py-2 px-3 text-right">Avg Rel BTC 7d</th>
                      <th className="py-2 pl-3 text-right">Mean MAE 30d</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono text-[11px] tabular-nums">
                    {qualityStats.map((row) => (
                      <tr key={`${row.score_version}-${row.discovery_track}-${row.effective_tier}`}>
                        <td className="py-2.5 pr-3 text-foreground">{row.score_version}</td>
                        <td className="py-2.5 px-3 text-foreground">{row.discovery_track}</td>
                        <td className="py-2.5 px-3 text-muted-foreground">{row.effective_tier}</td>
                        <td className="py-2.5 px-3 text-right text-foreground">
                          {row.total_tracked}
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted-foreground">
                          {row.evaluated_7d}
                        </td>
                        <td className="py-2.5 px-3 text-right text-foreground">
                          {row.positive_7d_rate !== null
                            ? `${(row.positive_7d_rate * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                        <td className={`py-2.5 px-3 text-right ${pctToneClass(row.avg_rel_btc_7d)}`}>
                          {row.avg_rel_btc_7d !== null
                            ? `${row.avg_rel_btc_7d >= 0 ? "+" : ""}${row.avg_rel_btc_7d.toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className={`py-2.5 pl-3 text-right ${pctToneClass(row.mean_mae_30d)}`}>
                          {formatPct(row.mean_mae_30d, { signed: true })}
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
              {locale === "id" ? "Log Event Perubahan Kandidat" : "Candidate State Transition Log"}
            </h2>
            {alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {alerts.map((al) => {
                  const track =
                    typeof al.payload?.track === "string" ? al.payload.track : null;
                  const horizon =
                    typeof al.payload?.horizon === "string" ? al.payload.horizon : null;
                  return (
                    <div
                      key={al.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-card-elevated px-3.5 py-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          tone={
                            al.severity === "HIGH" || al.severity === "CRITICAL"
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
                          {String(al.payload?.symbol ?? al.asset_id.slice(0, 8))}
                          {track ? ` · ${track}${horizon ? `/${horizon}` : ""}` : ""}
                          {typeof al.payload?.adjusted_score === "number"
                            ? ` · Score ${al.payload.adjusted_score.toFixed(1)}`
                            : ""}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-subtle-foreground">
                        {formatUtc(al.created_at)}
                      </span>
                    </div>
                  );
                })}
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
        variants={modalVariants}
        locale={locale}
        watched={Boolean(detail && watchlistByAsset.has(detail.candidate.asset_id))}
        onSelectVariant={(cid) => void handleInspectCandidate(cid, modalVariants)}
        onToggleWatchlist={(c) => void handleToggleWatchlist(c)}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
