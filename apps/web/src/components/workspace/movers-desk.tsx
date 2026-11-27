"use client";

import { ChevronDown, ChevronUp, Play, SlidersHorizontal, TrendingUp } from "lucide-react";
import { useCallback, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import type { EvidenceEnvelope, RankBy } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

interface MoverPreset {
  id: string;
  labelEn: string;
  labelId: string;
  hintEn: string;
  hintId: string;
  minCap: string;
  minVol: string;
  maxGain: string;
  rankBy: RankBy;
  universe: string;
  limit: string;
}

const MOVER_PRESETS: MoverPreset[] = [
  {
    id: "anti-chase",
    labelEn: "Anti-Chase Mid Cap",
    labelId: "Mid Cap Anti-FOMO",
    hintEn: "$250M+ cap · $15M+ vol · ≤18% 24h",
    hintId: "Kapitalisasi $250M+ · Vol $15M+ · ≤18% 24j",
    minCap: "250000000",
    minVol: "15000000",
    maxGain: "18",
    rankBy: "composite_momentum_score",
    universe: "150",
    limit: "15",
  },
  {
    id: "large-cap",
    labelEn: "Blue-Chip Large Cap",
    labelId: "Large Cap Likuid",
    hintEn: "$1B+ cap · $50M+ vol · ≤15% 24h",
    hintId: "Kapitalisasi $1B+ · Vol $50M+ · ≤15% 24j",
    minCap: "1000000000",
    minVol: "50000000",
    maxGain: "15",
    rankBy: "composite_momentum_score",
    universe: "150",
    limit: "15",
  },
  {
    id: "btc-strength",
    labelEn: "Outperforming BTC",
    labelId: "Unggul dari BTC",
    hintEn: "$500M+ cap · $30M+ vol · vs BTC 7d",
    hintId: "Kapitalisasi $500M+ · Vol $30M+ · vs BTC 7h",
    minCap: "500000000",
    minVol: "30000000",
    maxGain: "20",
    rankBy: "rs_vs_btc_7d",
    universe: "150",
    limit: "15",
  },
  {
    id: "early-breakout",
    labelEn: "Early Breakout",
    labelId: "Breakout Awal",
    hintEn: "$100M+ cap · $10M+ vol · ≤25% 24h",
    hintId: "Kapitalisasi $100M+ · Vol $10M+ · ≤25% 24j",
    minCap: "100000000",
    minVol: "10000000",
    maxGain: "25",
    rankBy: "volume_to_mcap",
    universe: "200",
    limit: "20",
  },
];

interface MoversCachedPayload {
  quote: string;
  activePreset: string;
  minCap: string;
  minVol: string;
  maxGain: string;
  universe: string;
  limit: string;
  rankBy: RankBy;
  envelopes: EvidenceEnvelope[];
}

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGroupedInteger(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatCompactHint(raw: string): string | null {
  const n = optionalNumber(raw);
  if (n === null || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function MoversDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const cached = useDeskCache<MoversCachedPayload>("movers:last");

  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [presetOverride, setPresetOverride] = useState<string | null>(null);
  const [minCapOverride, setMinCapOverride] = useState<string | null>(null);
  const [minVolOverride, setMinVolOverride] = useState<string | null>(null);
  const [maxGainOverride, setMaxGainOverride] = useState<string | null>(null);
  const [universeOverride, setUniverseOverride] = useState<string | null>(null);
  const [limitOverride, setLimitOverride] = useState<string | null>(null);
  const [rankByOverride, setRankByOverride] = useState<RankBy | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const [running, setRunning] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [error, setError] = useState<DeskError | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);

  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const activePreset = presetOverride ?? cached?.value.activePreset ?? "anti-chase";
  const minCap = minCapOverride ?? cached?.value.minCap ?? "250000000";
  const minVol = minVolOverride ?? cached?.value.minVol ?? "15000000";
  const maxGain = maxGainOverride ?? cached?.value.maxGain ?? "18";
  const universe = universeOverride ?? cached?.value.universe ?? "150";
  const limit = limitOverride ?? cached?.value.limit ?? "15";
  const rankBy = rankByOverride ?? cached?.value.rankBy ?? "composite_momentum_score";
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (overrides?: {
      quote?: string;
      activePreset?: string;
      minCap?: string;
      minVol?: string;
      maxGain?: string;
      rankBy?: RankBy;
      universe?: string;
      limit?: string;
    }) => {
      const nextUniverse = overrides?.universe ?? universe;
      const nextLimit = overrides?.limit ?? limit;
      const parsedUniverse = optionalNumber(nextUniverse) ?? 150;
      const parsedLimit = optionalNumber(nextLimit) ?? 15;
      if (parsedUniverse < 10 || parsedUniverse > 200) {
        setValidation(
          locale === "id"
            ? "Koin Dipindai harus antara 10 hingga 200."
            : "Coins Scanned must be between 10 and 200.",
        );
        return;
      }
      if (parsedLimit < 1 || parsedLimit > 50) {
        setValidation(
          locale === "id"
            ? "Jumlah Hasil harus antara 1 hingga 50."
            : "Max Results must be between 1 and 50.",
        );
        return;
      }
      setValidation(null);
      setRunning(true);
      setError(null);

      const nextQuote = (overrides?.quote ?? quote).trim().toUpperCase() || "USD";
      const nextMinCap = overrides?.minCap ?? minCap;
      const nextMinVol = overrides?.minVol ?? minVol;
      const nextMaxGain = overrides?.maxGain ?? maxGain;
      const nextRankBy = overrides?.rankBy ?? rankBy;
      const nextPreset = overrides?.activePreset ?? activePreset;

      const result = await runIntelligenceTool("scan_market_movers", {
        quote_currency: nextQuote,
        min_market_cap_usd: optionalNumber(nextMinCap),
        min_volume_24h_usd: optionalNumber(nextMinVol),
        max_24h_gain_pct: optionalNumber(nextMaxGain),
        rank_by: nextRankBy,
        limit: parsedLimit,
        universe_size: parsedUniverse,
      });
      setRunning(false);
      if (!result.ok) {
        setError({
          status: result.status,
          message: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        });
        return;
      }

      const next = [result.data];
      setLiveEnvelopes(next);
      const ts = writeDeskCache<MoversCachedPayload>("movers:last", {
        quote: nextQuote,
        activePreset: nextPreset,
        minCap: nextMinCap,
        minVol: nextMinVol,
        maxGain: nextMaxGain,
        universe: nextUniverse,
        limit: nextLimit,
        rankBy: nextRankBy,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [activePreset, limit, locale, maxGain, minCap, minVol, quote, rankBy, universe],
  );

  function applyPreset(preset: MoverPreset) {
    setPresetOverride(preset.id);
    setMinCapOverride(preset.minCap);
    setMinVolOverride(preset.minVol);
    setMaxGainOverride(preset.maxGain);
    setRankByOverride(preset.rankBy);
    setUniverseOverride(preset.universe);
    setLimitOverride(preset.limit);
    if (!running) {
      void run({
        activePreset: preset.id,
        minCap: preset.minCap,
        minVol: preset.minVol,
        maxGain: preset.maxGain,
        rankBy: preset.rankBy,
        universe: preset.universe,
        limit: preset.limit,
      });
    }
  }

  const sortOptions: { value: RankBy; labelEn: string; labelId: string }[] = [
    { value: "composite_momentum_score", labelEn: "Momentum Score", labelId: "Skor Momentum" },
    { value: "rs_vs_btc_7d", labelEn: "vs BTC (7d)", labelId: "vs BTC (7h)" },
    { value: "volume_to_mcap", labelEn: "Vol / Cap Ratio", labelId: "Rasio Vol / Cap" },
  ];

  const minCapHint = formatCompactHint(minCap);
  const minVolHint = formatCompactHint(minVol);

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].movers}
        description={copy.moversBody}
        actions={
          <DeskHeaderActions
            quote={quote}
            running={running}
            onSelectQuote={(nextQuote) => {
              setQuoteOverride(nextQuote);
              if (!running) void run({ quote: nextQuote });
            }}
            onRefresh={() => void run()}
          />
        }
      />

      <div className="ct-surface-featured space-y-4 rounded-[16px] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            {locale === "id" ? "Strategi Pemindaian" : "Screener Strategy"}
          </span>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <SlidersHorizontal className="h-3 w-3 text-link" aria-hidden="true" />
            <span>{locale === "id" ? "Filter Kustom" : "Custom Filters"}</span>
            {showFilters ? (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {MOVER_PRESETS.map((preset) => {
            const active = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                disabled={running}
                onClick={() => applyPreset(preset)}
                className={`cursor-pointer rounded-[12px] border p-3 text-left transition-all disabled:opacity-60 ${
                  active
                    ? "border-primary/55 bg-primary/12 shadow-[0_0_20px_-8px_rgba(6,182,212,0.45)]"
                    : "border-border bg-background/70 hover:border-border-strong hover:bg-card-elevated/60"
                }`}
              >
                <p className={`text-xs font-semibold ${active ? "text-link" : "text-foreground"}`}>
                  {locale === "id" ? preset.labelId : preset.labelEn}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {locale === "id" ? preset.hintId : preset.hintEn}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
              {locale === "id" ? "Urutkan:" : "Sort by:"}
            </span>
            <div className="inline-flex flex-wrap items-center gap-1.5">
              {sortOptions.map((opt) => {
                const active = rankBy === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={running}
                    onClick={() => {
                      setRankByOverride(opt.value);
                      setPresetOverride("custom");
                      if (!running) void run({ rankBy: opt.value, activePreset: "custom" });
                    }}
                    className={`min-h-8 cursor-pointer rounded-full border px-3 font-mono text-[11px] font-medium transition-colors disabled:opacity-50 ${
                      active
                        ? "border-primary/50 bg-primary/14 text-link"
                        : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                    }`}
                  >
                    {locale === "id" ? opt.labelId : opt.labelEn}
                  </button>
                );
              })}
            </div>
          </div>

          <span className="font-mono text-[11px] text-subtle-foreground">
            {locale === "id"
              ? `Memindai top ${universe} koin · Maks ${limit} hasil`
              : `Scanning top ${universe} coins · Max ${limit} results`}
          </span>
        </div>

        {showFilters ? (
          <form
            className="grid gap-3.5 border-t border-border/60 pt-4 sm:grid-cols-2 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!running) void run();
            }}
          >
            <label className="text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between gap-1">
                <span>{locale === "id" ? "Kapitalisasi Min." : "Min Market Cap"}</span>
                {minCapHint ? (
                  <span className="font-mono text-[10.5px] text-link">{minCapHint}</span>
                ) : null}
              </span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={formatGroupedInteger(minCap)}
                onChange={(event) => {
                  setMinCapOverride(event.target.value.replace(/\D/g, ""));
                  setPresetOverride("custom");
                }}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              <span className="flex items-center justify-between gap-1">
                <span>{locale === "id" ? "Volume 24j Min." : "Min 24h Volume"}</span>
                {minVolHint ? (
                  <span className="font-mono text-[10.5px] text-link">{minVolHint}</span>
                ) : null}
              </span>
              <input
                className={INPUT}
                inputMode="numeric"
                value={formatGroupedInteger(minVol)}
                onChange={(event) => {
                  setMinVolOverride(event.target.value.replace(/\D/g, ""));
                  setPresetOverride("custom");
                }}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              <span>{locale === "id" ? "Maks. Naik 24j (%)" : "Max 24h Gain (%)"}</span>
              <input
                className={INPUT}
                inputMode="decimal"
                value={maxGain}
                onChange={(event) => {
                  setMaxGainOverride(event.target.value);
                  setPresetOverride("custom");
                }}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              <span>{locale === "id" ? "Koin Dipindai (10–200)" : "Coins Scanned (10–200)"}</span>
              <input
                className={INPUT}
                type="number"
                min={10}
                max={200}
                inputMode="numeric"
                value={universe}
                onChange={(event) => {
                  setUniverseOverride(event.target.value);
                  setPresetOverride("custom");
                  if (validation) setValidation(null);
                }}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              <span>{locale === "id" ? "Jumlah Hasil (1–50)" : "Max Results (1–50)"}</span>
              <input
                className={INPUT}
                type="number"
                min={1}
                max={50}
                inputMode="numeric"
                value={limit}
                onChange={(event) => {
                  setLimitOverride(event.target.value);
                  setPresetOverride("custom");
                  if (validation) setValidation(null);
                }}
              />
            </label>

            <div className="flex items-end">
              <Button type="submit" variant="primary" size="md" loading={running} className="w-full">
                {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                <span>{locale === "id" ? "Terapkan" : "Apply Scan"}</span>
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      <DeskResultArea
        running={running}
        error={error}
        validation={validation}
        envelopes={envelopes}
        cachedAt={cachedAt}
        onRetry={() => void run()}
        emptyIcon={<TrendingUp className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Siap memindai penggerak pasar" : "Ready to scan market movers"}
        emptyDescription={
          locale === "id"
            ? "Pilih strategi di atas untuk menemukan koin dengan momentum kuat tanpa mengejar lonjakan ekstrem."
            : "Pick a strategy above to find coins with healthy momentum and liquidity."
        }
        emptyAction={
          <Button variant="primary" size="md" onClick={() => void run()} className="ct-btn-glow">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.run}</span>
          </Button>
        }
      />
    </div>
  );
}
