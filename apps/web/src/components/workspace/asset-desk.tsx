"use client";

import { BarChart3, GitCompareArrows, Play, TrendingUp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, PageHeader } from "@/components/ui/primitives";
import { runIntelligenceTool } from "@/lib/api";
import { readDeskCache, useDeskCache, writeDeskCache } from "@/lib/desk-cache";
import { symbolList, validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { DeskHeaderActions, DeskResultArea, type DeskError } from "./desk-chrome";

const QUICK_ASSETS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "ONDO", "NEAR", "UNI"] as const;

type AssetMode = Extract<ToolName, "analyze_asset" | "compare_assets" | "analyze_momentum">;

interface AssetCachedPayload {
  tool: AssetMode;
  symbol: string;
  peers: string;
  quote: string;
  envelopes: EvidenceEnvelope[];
}

const INPUT =
  "mt-1.5 min-h-11 sm:min-h-10 w-full min-w-0 rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

const MODE_TABS: {
  id: AssetMode;
  labelEn: string;
  labelId: string;
  icon: typeof BarChart3;
}[] = [
  { id: "analyze_asset", labelEn: "Analyze Coin", labelId: "Analisis Koin", icon: BarChart3 },
  { id: "compare_assets", labelEn: "Compare Peers", labelId: "Bandingkan Koin", icon: GitCompareArrows },
  { id: "analyze_momentum", labelEn: "Momentum", labelId: "Cek Momentum", icon: TrendingUp },
];

export function AssetDesk() {
  const { locale } = useAppPreferences();
  const searchParams = useSearchParams();
  const querySymbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const copy = workspaceCopy(locale);

  const cached = useDeskCache<AssetCachedPayload>("assets:last");

  const [symbolOverride, setSymbolOverride] = useState<string | null>(querySymbol || null);
  const [peersOverride, setPeersOverride] = useState<string | null>(null);
  const [quoteOverride, setQuoteOverride] = useState<string | null>(null);
  const [modeOverride, setModeOverride] = useState<AssetMode | null>(querySymbol ? "analyze_asset" : null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<DeskError | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [liveEnvelopes, setLiveEnvelopes] = useState<EvidenceEnvelope[] | null>(null);
  const [liveCachedAt, setLiveCachedAt] = useState<number | null>(null);
  const initialized = useRef(false);

  const mode = modeOverride ?? cached?.value.tool ?? "analyze_asset";
  const symbol = symbolOverride ?? cached?.value.symbol ?? "BTC";
  const peers = peersOverride ?? cached?.value.peers ?? "ETH, SOL";
  const quote = quoteOverride ?? cached?.value.quote ?? "USD";
  const envelopes = liveEnvelopes ?? cached?.value.envelopes ?? [];
  const cachedAt = liveCachedAt ?? cached?.cachedAt ?? null;

  const run = useCallback(
    async (overrides?: { tool?: AssetMode; symbol?: string; peers?: string; quote?: string }) => {
      const tool = overrides?.tool ?? mode;
      const activeSym = (overrides?.symbol ?? symbol).trim().toUpperCase();
      const activePeers = overrides?.peers ?? peers;
      const quoteCurrency = (overrides?.quote ?? quote).trim().toUpperCase() || "USD";
      const params =
        tool === "analyze_asset"
          ? { quote_currency: quoteCurrency, symbol: activeSym }
          : {
              quote_currency: quoteCurrency,
              symbols: symbolList(
                tool === "analyze_momentum" && !activePeers.trim()
                  ? activeSym
                  : `${activeSym}, ${activePeers}`,
              ),
            };
      const invalid = validateToolInput(tool, params);
      if (invalid) {
        setValidation(invalid);
        return;
      }

      setValidation(null);
      setRunning(true);
      setError(null);
      const result = await runIntelligenceTool(tool, params);
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
      const ts = writeDeskCache<AssetCachedPayload>("assets:last", {
        tool,
        symbol: activeSym,
        peers: activePeers,
        quote: quoteCurrency,
        envelopes: next,
      });
      setLiveCachedAt(ts);
    },
    [mode, peers, quote, symbol],
  );

  useEffect(() => {
    if (initialized.current || !querySymbol) return;
    initialized.current = true;
    const prev = readDeskCache<AssetCachedPayload>("assets:last");
    if (
      prev &&
      prev.value.tool === "analyze_asset" &&
      prev.value.symbol === querySymbol &&
      prev.value.envelopes.length > 0
    ) {
      return;
    }
    void Promise.resolve().then(() => void run({ tool: "analyze_asset", symbol: querySymbol }));
  }, [querySymbol, run]);

  const showPeersInput = mode === "compare_assets" || mode === "analyze_momentum";

  return (
    <div className="space-y-6">
      <PageHeader
        title={NAV_LABELS[locale].assets}
        description={copy.assetsBody}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label={locale === "id" ? "Mode analisis koin" : "Asset analysis mode"}
            className="flex flex-wrap items-center gap-1.5"
          >
            {MODE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setModeOverride(tab.id);
                    if (!running) void run({ tool: tab.id });
                  }}
                  className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary/50 bg-primary/14 text-link"
                      : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{locale === "id" ? tab.labelId : tab.labelEn}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_ASSETS.map((ticker) => {
              const active = symbol.trim().toUpperCase() === ticker;
              return (
                <button
                  key={ticker}
                  type="button"
                  disabled={running}
                  onClick={() => {
                    setSymbolOverride(ticker);
                    if (!running) void run({ symbol: ticker });
                  }}
                  className={`min-h-8 cursor-pointer rounded-full border px-2.5 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                    active
                      ? "border-primary/50 bg-primary/14 text-link"
                      : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  {ticker}
                </button>
              );
            })}
          </div>
        </div>

        <form
          className={`grid gap-3.5 ${showPeersInput ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_auto]"}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!running) void run();
          }}
        >
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "id" ? "Koin Utama" : "Primary Coin"}
            <input
              className={INPUT}
              value={symbol}
              placeholder="BTC"
              onChange={(event) => setSymbolOverride(event.target.value)}
            />
          </label>

          {showPeersInput ? (
            <label className="text-xs font-medium text-muted-foreground">
              {locale === "id" ? "Bandingkan dengan (pisahkan koma)" : "Compare With (comma-separated)"}
              <input
                className={INPUT}
                value={peers}
                placeholder="ETH, SOL"
                onChange={(event) => setPeersOverride(event.target.value)}
              />
            </label>
          ) : null}

          <div className="flex items-end">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={running}
              className="ct-btn-glow w-full sm:w-auto"
            >
              {!running ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              <span>
                {mode === "compare_assets"
                  ? locale === "id"
                    ? "Bandingkan"
                    : "Compare"
                  : mode === "analyze_momentum"
                    ? locale === "id"
                      ? "Cek Momentum"
                      : "Check Momentum"
                    : locale === "id"
                      ? "Analisis"
                      : "Analyze"}
              </span>
            </Button>
          </div>
        </form>
      </div>

      <DeskResultArea
        running={running}
        error={error}
        validation={validation}
        envelopes={envelopes}
        cachedAt={cachedAt}
        onRetry={() => void run()}
        emptyIcon={<BarChart3 className="h-5 w-5 text-link" aria-hidden="true" />}
        emptyTitle={locale === "id" ? "Pilih koin di atas" : "Pick a coin above"}
        emptyDescription={
          locale === "id"
            ? "Klik ticker populer atau tekan Analisis untuk melihat harga, likuiditas, dan perbandingan koin."
            : "Click any popular ticker or press Analyze to inspect price, liquidity, and peer comparisons."
        }
        emptyAction={
          <Button variant="primary" size="md" onClick={() => void run()} className="ct-btn-glow">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {locale === "id"
                ? `Analisis ${symbol.trim().toUpperCase() || "BTC"}`
                : `Analyze ${symbol.trim().toUpperCase() || "BTC"}`}
            </span>
          </Button>
        }
      />
    </div>
  );
}
