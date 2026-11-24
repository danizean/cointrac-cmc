"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  formatCompactUsd,
  formatInteger,
  formatNumber,
  formatPct,
  formatRatio,
  formatUsd,
  formatUtc,
  MISSING,
  pctToneClass,
} from "@/lib/format";
import type {
  AnalyzeAssetData,
  AnalyzeMomentumData,
  CompareAssetsData,
  DerivativesAnalysisData,
  DetectAnomaliesData,
  EvidenceEnvelope,
  HistoricalPerformanceData,
  MarketOverviewData,
  MarketRegimeData,
  ScanMoversData,
  SectorRotationData,
} from "@/lib/types";
import { useAppPreferences } from "./app-preferences";
import { CoinLogo } from "./coin-logo";
import { SectorRotationChart } from "./sector-rotation-chart";
import {
  AnomalyDirectionBadge,
  DataModeBadge,
  FreshnessBadge,
  MultiHorizonRiskBadge,
  RegimeBadge,
  RotationBadge,
  StatusBadge,
} from "./status-badges";

function MetricTile({
  label,
  value,
  sub,
  toneClass = "text-foreground",
}: {
  label: string;
  value: string;
  sub?: string;
  toneClass?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${toneClass}`}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {sub}
        </p>
      )}
    </div>
  );
}

function LimitationsBox({ limitations }: { limitations: string[] }) {
  const { t } = useAppPreferences();
  if (limitations.length === 0) return null;
  return (
    <div className="rounded-xl border border-accent/35 bg-accent/10 p-4">
      <p className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-accent">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t.playground.limitationsTitle}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-foreground">
        {limitations.map((item, idx) => (
          <li key={`${idx}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function renderToolData(envelope: EvidenceEnvelope) {
  switch (envelope.tool) {
    case "get_market_overview": {
      const d = envelope.data as MarketOverviewData;
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Total Market Cap"
              value={formatCompactUsd(d.total_market_cap)}
              sub={`24h: ${formatPct(d.total_market_cap_change_24h_pct, { signed: true })}`}
            />
            <MetricTile
              label="24h Total Volume"
              value={formatCompactUsd(d.total_volume_24h)}
              sub={`Quote: ${d.quote_currency}`}
            />
            <MetricTile
              label="BTC / ETH Dominance"
              value={`${formatPct(d.btc_dominance, { decimals: 1 })} / ${formatPct(d.eth_dominance, { decimals: 1 })}`}
              sub={`BTC 24h: ${formatPct(d.btc_dominance_change_24h, { signed: true })}`}
            />
            <MetricTile
              label="Fear & Greed"
              value={
                d.fear_greed_value !== null
                  ? `${Math.round(d.fear_greed_value)} (${d.fear_greed_classification ?? MISSING})`
                  : MISSING
              }
              sub={`Top-50 breadth: ${formatPct(d.top50_breadth_positive_pct, { decimals: 1 })}`}
            />
          </div>

          {(d.btc || d.eth || d.sol) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[d.btc, d.eth, d.sol]
                .filter((coin): coin is NonNullable<typeof coin> => coin !== null)
                .map((coin) => (
                  <div
                    key={coin.symbol}
                    className="rounded-xl border border-border bg-background/60 p-3.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <CoinLogo
                          cmcId={coin.cmc_id}
                          symbol={coin.symbol}
                          name={coin.name}
                          size="md"
                        />
                        <div className="min-w-0 leading-tight">
                          <p className="font-mono text-xs font-bold text-foreground">
                            {coin.symbol}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {coin.name ?? coin.symbol}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${pctToneClass(coin.percent_change_24h)}`}
                      >
                        {formatPct(coin.percent_change_24h, { signed: true })}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-base font-bold tabular-nums text-foreground">
                      {formatUsd(coin.price)}
                    </p>
                  </div>
                ))}
            </div>
          )}

          {(d.top_gainers.length > 0 || d.top_losers.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="overflow-x-auto rounded-xl border border-border bg-background/50">
                <p className="border-b border-border bg-card-elevated/60 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-positive">
                  Top Gainers (24h)
                </p>
                <table className="w-full text-left font-mono text-xs tabular-nums">
                  <tbody className="divide-y divide-border">
                    {d.top_gainers.map((item) => (
                      <tr key={item.symbol}>
                        <td className="px-3.5 py-2 font-bold text-foreground">
                          <span className="inline-flex items-center gap-2">
                            <CoinLogo
                              cmcId={item.cmc_id}
                              symbol={item.symbol}
                              name={item.name}
                              size="sm"
                            />
                            <span>{item.symbol}</span>
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-right text-muted-foreground">
                          {formatUsd(item.price)}
                        </td>
                        <td className="px-3.5 py-2 text-right font-semibold text-positive">
                          {formatPct(item.percent_change_24h, { signed: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border bg-background/50">
                <p className="border-b border-border bg-card-elevated/60 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-destructive">
                  Top Losers (24h)
                </p>
                <table className="w-full text-left font-mono text-xs tabular-nums">
                  <tbody className="divide-y divide-border">
                    {d.top_losers.map((item) => (
                      <tr key={item.symbol}>
                        <td className="px-3.5 py-2 font-bold text-foreground">
                          <span className="inline-flex items-center gap-2">
                            <CoinLogo
                              cmcId={item.cmc_id}
                              symbol={item.symbol}
                              name={item.name}
                              size="sm"
                            />
                            <span>{item.symbol}</span>
                          </span>
                        </td>
                        <td className="px-3.5 py-2 text-right text-muted-foreground">
                          {formatUsd(item.price)}
                        </td>
                        <td className="px-3.5 py-2 text-right font-semibold text-destructive">
                          {formatPct(item.percent_change_24h, { signed: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      );
    }

    case "analyze_market_regime": {
      const d = envelope.data as MarketRegimeData;
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-xs text-muted-foreground">
              Classified Regime:
            </span>
            <RegimeBadge regime={d.regime} />
            {d.signal_conflict && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent">
                SIGNAL CONFLICT
              </span>
            )}
            {d.confidence && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                CONFIDENCE {d.confidence}
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Total MCap 24h"
              value={formatPct(d.total_mcap_change_24h_pct, { signed: true })}
              toneClass={pctToneClass(d.total_mcap_change_24h_pct)}
            />
            <MetricTile
              label="BTC Dom Delta 24h"
              value={formatPct(d.btc_dominance_change_24h, { signed: true })}
              toneClass={pctToneClass(d.btc_dominance_change_24h)}
            />
            <MetricTile
              label="Top-50 Breadth"
              value={formatPct(d.top50_breadth_positive_pct, { decimals: 1 })}
            />
            <MetricTile
              label="Fear & Greed"
              value={
                d.fear_greed_value !== null
                  ? `${Math.round(d.fear_greed_value)} / 100`
                  : MISSING
              }
              sub={
                d.btc_outperforming_median_alt === null
                  ? "BTC vs median alt: —"
                  : d.btc_outperforming_median_alt
                    ? "BTC outperforming median alt"
                    : "Alts outperforming BTC"
              }
            />
          </div>
          {d.rationale.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.rationale.map((line) => (
                <span
                  key={line}
                  className="rounded-lg border border-border bg-background/70 px-2.5 py-1 font-mono text-[11px] text-foreground"
                >
                  {line}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    case "scan_market_movers": {
      const d = envelope.data as ScanMoversData;
      return d.movers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          No assets satisfied all screening thresholds. Try widening{" "}
          <code className="font-mono text-foreground">max_24h_gain_pct</code> or
          lowering liquidity floors.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-2.5">Symbol</th>
                <th className="px-3.5 py-2.5 text-right">Market Cap</th>
                <th className="px-3.5 py-2.5 text-right">Volume 24h</th>
                <th className="px-3.5 py-2.5 text-right">Vol/MCap</th>
                <th className="px-3.5 py-2.5 text-right">24h %</th>
                <th className="px-3.5 py-2.5 text-right">7d %</th>
                <th className="px-3.5 py-2.5 text-right">RS vs BTC 7d</th>
                <th className="px-3.5 py-2.5 text-right">Momentum</th>
                <th className="px-3.5 py-2.5">Horizon Risk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {d.movers.map((row) => (
                <tr
                  key={`${row.cmc_id ?? row.symbol}`}
                  className="hover:bg-card-elevated/50"
                >
                  <td className="px-3.5 py-2.5 font-bold text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <CoinLogo
                        cmcId={row.cmc_id}
                        symbol={row.symbol}
                        name={row.name}
                        size="sm"
                      />
                      <span>
                        {row.symbol}
                        {row.name ? (
                          <span className="ml-1.5 font-sans font-normal text-muted-foreground">
                            {row.name}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatCompactUsd(row.market_cap)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatCompactUsd(row.volume_24h)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatRatio(row.volume_to_mcap)}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right font-semibold ${pctToneClass(row.percent_change_24h)}`}
                  >
                    {formatPct(row.percent_change_24h, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right font-semibold ${pctToneClass(row.percent_change_7d)}`}
                  >
                    {formatPct(row.percent_change_7d, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right font-semibold ${pctToneClass(row.rs_vs_btc_7d)}`}
                  >
                    {formatPct(row.rs_vs_btc_7d, { signed: true })}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-bold text-primary">
                    {formatNumber(row.composite_momentum_score, 1)}
                  </td>
                  <td className="px-3.5 py-2.5">
                    <MultiHorizonRiskBadge risk={row.multi_horizon_risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "compare_assets": {
      const d = envelope.data as CompareAssetsData;
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-2.5">Asset</th>
                <th className="px-3.5 py-2.5 text-right">Price</th>
                <th className="px-3.5 py-2.5 text-right">Vol/MCap</th>
                <th className="px-3.5 py-2.5 text-right">FDV/MCap</th>
                <th className="px-3.5 py-2.5 text-right">7d %</th>
                <th className="px-3.5 py-2.5 text-right">RS vs BTC 7d</th>
                <th className="px-3.5 py-2.5 text-right">Momentum</th>
                <th className="px-3.5 py-2.5 text-right">Vol (365d)</th>
                <th className="px-3.5 py-2.5 text-right">Max DD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {d.assets.map((asset) => (
                <tr
                  key={`${asset.cmc_id ?? asset.symbol}`}
                  className="hover:bg-card-elevated/50"
                >
                  <td className="px-3.5 py-2.5 font-bold text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <CoinLogo
                        cmcId={asset.cmc_id}
                        symbol={asset.symbol}
                        name={asset.name}
                        size="sm"
                      />
                      <span>
                        {asset.symbol}
                        {asset.cmc_id !== null && (
                          <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                            #{asset.cmc_id}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatUsd(asset.price)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatRatio(asset.volume_to_mcap)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatRatio(asset.fdv_to_mcap_ratio, 2)}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right font-semibold ${pctToneClass(asset.percent_change_7d)}`}
                  >
                    {formatPct(asset.percent_change_7d, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right font-semibold ${pctToneClass(asset.rs_vs_btc_7d)}`}
                  >
                    {formatPct(asset.rs_vs_btc_7d, { signed: true })}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-bold text-primary">
                    {formatNumber(asset.composite_momentum_score, 1)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {asset.annualized_volatility !== null
                      ? formatPct(asset.annualized_volatility * 100, {
                          decimals: 1,
                        })
                      : MISSING}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-destructive">
                    {asset.max_drawdown !== null
                      ? formatPct(asset.max_drawdown * 100, { decimals: 1 })
                      : MISSING}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "analyze_asset": {
      const d = envelope.data as AnalyzeAssetData;
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-3">
            <CoinLogo
              cmcId={d.cmc_id}
              symbol={d.symbol}
              name={d.name}
              size="md"
            />
            <div className="min-w-0 leading-tight">
              <p className="font-mono text-sm font-bold text-foreground">
                {d.symbol}
                {d.name ? (
                  <span className="ml-2 font-sans text-xs font-medium text-muted-foreground">
                    {d.name}
                  </span>
                ) : null}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {d.cmc_id !== null ? `CMC ID #${d.cmc_id}` : "Canonical ID —"} ·{" "}
                {d.quote_currency}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label={`${d.symbol} Price`}
              value={formatUsd(d.price)}
              sub={d.cmc_id !== null ? `CMC ID #${d.cmc_id}` : "Canonical ID —"}
            />
            <MetricTile
              label="Market Cap"
              value={formatCompactUsd(d.market_cap)}
              sub={`Vol/MCap: ${formatRatio(d.volume_to_mcap)}`}
            />
            <MetricTile
              label="FDV / MCap"
              value={formatRatio(d.fdv_to_mcap_ratio, 2)}
              sub={`Circulating: ${formatPct(d.circulating_supply_pct, { decimals: 1 })}`}
            />
            <MetricTile
              label="RS vs BTC (7d)"
              value={formatPct(d.rs_vs_btc_7d, { signed: true })}
              sub={`30d: ${formatPct(d.rs_vs_btc_30d, { signed: true })}`}
              toneClass={pctToneClass(d.rs_vs_btc_7d)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="24h / 7d Change"
              value={formatPct(d.percent_change_24h, { signed: true })}
              sub={`7d: ${formatPct(d.percent_change_7d, { signed: true })}`}
              toneClass={pctToneClass(d.percent_change_24h)}
            />
            <MetricTile
              label="30d / 60d Change"
              value={formatPct(d.percent_change_30d, { signed: true })}
              sub={`60d: ${formatPct(d.percent_change_60d, { signed: true })}`}
              toneClass={pctToneClass(d.percent_change_30d)}
            />
            <MetricTile
              label="Composite Momentum"
              value={formatNumber(d.composite_momentum_score, 1)}
              sub={
                d.timeframes_available !== undefined &&
                d.timeframes_available !== null
                  ? `${d.timeframes_available}/4 timeframes`
                  : undefined
              }
              toneClass="text-primary"
            />
            <MetricTile
              label="Ann. Volatility / Max DD"
              value={
                d.annualized_volatility !== null
                  ? formatPct(d.annualized_volatility * 100, { decimals: 1 })
                  : MISSING
              }
              sub={`Max DD: ${
                d.max_drawdown !== null
                  ? formatPct(d.max_drawdown * 100, { decimals: 1 })
                  : MISSING
              }`}
            />
          </div>

          {d.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.tags.slice(0, 14).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border bg-background/70 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    case "analyze_momentum": {
      const d = envelope.data as AnalyzeMomentumData;
      return (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-2.5">Symbol</th>
                <th className="px-3.5 py-2.5 text-right">1h</th>
                <th className="px-3.5 py-2.5 text-right">24h</th>
                <th className="px-3.5 py-2.5 text-right">7d</th>
                <th className="px-3.5 py-2.5 text-right">30d</th>
                <th className="px-3.5 py-2.5 text-right">RS BTC 7d</th>
                <th className="px-3.5 py-2.5 text-right">Accel</th>
                <th className="px-3.5 py-2.5 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {d.assets.map((row) => (
                <tr key={row.symbol} className="hover:bg-card-elevated/50">
                  <td className="px-3.5 py-2.5 font-bold text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <CoinLogo cmcId={row.cmc_id} symbol={row.symbol} size="sm" />
                      <span>{row.symbol}</span>
                    </span>
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.percent_change_1h)}`}
                  >
                    {formatPct(row.percent_change_1h, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.percent_change_24h)}`}
                  >
                    {formatPct(row.percent_change_24h, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.percent_change_7d)}`}
                  >
                    {formatPct(row.percent_change_7d, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.percent_change_30d)}`}
                  >
                    {formatPct(row.percent_change_30d, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.rs_vs_btc_7d)}`}
                  >
                    {formatPct(row.rs_vs_btc_7d, { signed: true })}
                  </td>
                  <td
                    className={`px-3.5 py-2.5 text-right ${pctToneClass(row.acceleration_7d_vs_30d)}`}
                  >
                    {formatNumber(row.acceleration_7d_vs_30d, 2)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-bold text-primary">
                    {formatNumber(row.composite_momentum_score, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "detect_market_anomalies": {
      const d = envelope.data as DetectAnomaliesData;
      return (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile
              label="Volume/MCap Outliers"
              value={String(d.volume_mcap_outliers.length)}
            />
            <MetricTile
              label="Price Change Outliers"
              value={String(d.price_change_outliers.length)}
            />
            <MetricTile
              label="BTC Divergences"
              value={String(d.btc_divergences.length)}
            />
          </div>

          {d.volume_mcap_outliers.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <p className="border-b border-border bg-card-elevated/70 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-accent">
                Volume-to-MCap Statistical Outliers
              </p>
              <table className="w-full text-left font-mono text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="px-3.5 py-2">Symbol</th>
                    <th className="px-3.5 py-2 text-right">Value</th>
                    <th className="px-3.5 py-2 text-right">Z-Score</th>
                    <th className="px-3.5 py-2 text-right">Mod Z (MAD)</th>
                    <th className="px-3.5 py-2">Direction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.volume_mcap_outliers.map((hit) => (
                    <tr key={`${hit.symbol}-${hit.metric}`}>
                      <td className="px-3.5 py-2 font-bold">
                        <span className="inline-flex items-center gap-2">
                          <CoinLogo cmcId={hit.cmc_id} symbol={hit.symbol} size="sm" />
                          <span>{hit.symbol}</span>
                        </span>
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        {formatRatio(hit.value)}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        {formatNumber(hit.z_score)}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold text-accent">
                        {formatNumber(hit.modified_z_score)}
                      </td>
                      <td className="px-3.5 py-2">
                        <AnomalyDirectionBadge direction={hit.direction} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.btc_divergences.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <p className="border-b border-border bg-card-elevated/70 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
                Strong BTC Divergences
              </p>
              <table className="w-full text-left font-mono text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="px-3.5 py-2">Symbol</th>
                    <th className="px-3.5 py-2 text-right">Asset 24h</th>
                    <th className="px-3.5 py-2 text-right">BTC 24h</th>
                    <th className="px-3.5 py-2 text-right">Spread</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.btc_divergences.map((div) => (
                    <tr key={div.symbol}>
                      <td className="px-3.5 py-2 font-bold">
                        <span className="inline-flex items-center gap-2">
                          <CoinLogo cmcId={div.cmc_id} symbol={div.symbol} size="sm" />
                          <span>{div.symbol}</span>
                        </span>
                      </td>
                      <td
                        className={`px-3.5 py-2 text-right font-semibold ${pctToneClass(div.asset_change_24h_pct)}`}
                      >
                        {formatPct(div.asset_change_24h_pct, { signed: true })}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        {formatPct(div.btc_change_24h_pct, { signed: true })}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold">
                        {formatPct(div.divergence_pct, { signed: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    case "analyze_sector_rotation": {
      const d = envelope.data as SectorRotationData;
      return (
        <div className="space-y-4">
          <SectorRotationChart sectors={d.sectors} />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5">Sector</th>
                  <th className="px-3.5 py-2.5 text-right">Assets</th>
                  <th className="px-3.5 py-2.5 text-right">Median 24h</th>
                  <th className="px-3.5 py-2.5 text-right">Excess 24h</th>
                  <th className="px-3.5 py-2.5 text-right">Median 7d</th>
                  <th className="px-3.5 py-2.5 text-right">Excess 7d</th>
                  <th className="px-3.5 py-2.5 text-right">Breadth</th>
                  <th className="px-3.5 py-2.5 text-right">Vol Share</th>
                  <th className="px-3.5 py-2.5">Signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono tabular-nums">
                {d.sectors.map((s) => (
                  <tr
                    key={s.sector_slug}
                    className={
                      s.sector_slug === "rwa"
                        ? "bg-accent/10"
                        : "hover:bg-card-elevated/50"
                    }
                  >
                    <td className="px-3.5 py-2.5 font-sans font-semibold text-foreground">
                      {s.display_name}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      {s.constituent_count}
                    </td>
                    <td
                      className={`px-3.5 py-2.5 text-right font-medium ${pctToneClass(s.median_change_24h_pct)}`}
                    >
                      {formatPct(s.median_change_24h_pct, { signed: true })}
                    </td>
                    <td
                      className={`px-3.5 py-2.5 text-right font-medium ${pctToneClass(s.excess_change_24h_vs_market_pct)}`}
                    >
                      {formatPct(s.excess_change_24h_vs_market_pct, { signed: true })}
                    </td>
                    <td
                      className={`px-3.5 py-2.5 text-right font-medium ${pctToneClass(s.median_change_7d_pct)}`}
                    >
                      {formatPct(s.median_change_7d_pct, { signed: true })}
                    </td>
                    <td
                      className={`px-3.5 py-2.5 text-right font-medium ${pctToneClass(s.excess_change_7d_vs_market_pct)}`}
                    >
                      {formatPct(s.excess_change_7d_vs_market_pct, { signed: true })}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      {formatPct(s.breadth_positive_24h_pct, { decimals: 1 })}
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      {formatPct(s.sector_volume_share_pct, { decimals: 1 })}
                    </td>
                    <td className="px-3.5 py-2.5">
                      <RotationBadge signal={s.rotation_signal} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case "get_historical_performance": {
      const d = envelope.data as HistoricalPerformanceData;
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <CoinLogo cmcId={d.cmc_id} symbol={d.symbol} size="md" />
            <span className="font-mono text-sm font-bold text-foreground">
              {d.symbol}
            </span>
            {d.cmc_id !== null && (
              <span className="font-mono text-xs text-muted-foreground">
                #{d.cmc_id}
              </span>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricTile
              label="Aligned Overlap Days"
              value={formatInteger(d.overlap_days)}
              sub={`Asset: ${d.symbol}`}
            />
            <MetricTile
              label="Simple Return"
              value={
                d.simple_return !== null
                  ? formatPct(d.simple_return * 100, { signed: true })
                  : MISSING
              }
              sub={`Log return: ${d.log_return !== null ? formatRatio(d.log_return, 4) : MISSING}`}
              toneClass={pctToneClass(d.simple_return)}
            />
            <MetricTile
              label="Annualized Volatility (365d)"
              value={
                d.annualized_volatility !== null
                  ? formatPct(d.annualized_volatility * 100, { decimals: 2 })
                  : MISSING
              }
            />
            <MetricTile
              label="Max Drawdown"
              value={
                d.max_drawdown !== null
                  ? formatPct(d.max_drawdown * 100, { decimals: 2 })
                  : MISSING
              }
              toneClass="text-destructive"
            />
            <MetricTile
              label="Beta vs BTC"
              value={formatNumber(d.beta_vs_btc, 3)}
            />
            <MetricTile
              label="Correlation vs BTC"
              value={formatNumber(d.correlation_vs_btc, 3)}
            />
          </div>
        </div>
      );
    }

    case "analyze_derivatives": {
      const d = envelope.data as DerivativesAnalysisData;
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs text-muted-foreground">
            <CoinLogo cmcId={d.cmc_id} symbol={d.symbol} size="sm" />
            <span className="font-bold text-foreground">{d.symbol}</span>
            {d.cmc_id !== null && <span>#{d.cmc_id}</span>}
            <span>·</span>
            <span>Mode:</span>
            <strong className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 text-foreground">
              {d.mode}
            </strong>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricTile
              label="Funding Rate"
              value={
                d.funding_rate !== null
                  ? formatPct(d.funding_rate * 100, { decimals: 4 })
                  : MISSING
              }
            />
            <MetricTile
              label="Open Interest"
              value={formatCompactUsd(d.open_interest)}
            />
            <MetricTile
              label="24h Liquidations"
              value={formatCompactUsd(d.liquidations_24h)}
            />
            <MetricTile
              label="Market Pairs"
              value={
                d.sampled_pair_count !== undefined &&
                d.sampled_pair_count !== null &&
                d.market_pair_count !== null
                  ? `${formatInteger(d.sampled_pair_count)} / ${formatInteger(d.market_pair_count)}`
                  : formatInteger(d.market_pair_count)
              }
              sub={
                d.outlier_pairs_excluded !== undefined &&
                d.outlier_pairs_excluded !== null
                  ? `OI pairs: ${formatInteger(d.open_interest_pairs_included)} · Outliers excluded: ${formatInteger(d.outlier_pairs_excluded)}`
                  : undefined
              }
            />
            <MetricTile
              label="Spot Volume 24h"
              value={formatCompactUsd(d.spot_volume_24h)}
            />
            <MetricTile
              label="Ann. Volatility (365d)"
              value={
                d.annualized_volatility !== null
                  ? formatPct(d.annualized_volatility * 100, { decimals: 2 })
                  : MISSING
              }
            />
          </div>
        </div>
      );
    }

    default:
      return (
        <pre className="overflow-auto rounded-xl border border-border bg-background/80 p-3 font-mono text-xs">
          {JSON.stringify(envelope.data, null, 2)}
        </pre>
      );
  }
}

export function EnvelopeFormattedReport({
  envelope,
}: {
  envelope: EvidenceEnvelope;
}) {
  return (
    <article className="tg-panel space-y-5 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-primary">
              {envelope.tool}
            </span>
            <StatusBadge status={envelope.status} />
            <DataModeBadge mode={envelope.evidence.data_mode} />
            <FreshnessBadge freshness={envelope.evidence.freshness} />
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            {envelope.summary}
          </p>
        </div>

        <Link
          href={`/evidence?id=${encodeURIComponent(envelope.evidence.evidence_id)}`}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 font-mono text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary hover:text-primary"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
          <span>{envelope.evidence.evidence_id}</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {renderToolData(envelope)}
      <LimitationsBox limitations={envelope.limitations} />
    </article>
  );
}

export function EnvelopeEvidenceView({
  envelope,
}: {
  envelope: EvidenceEnvelope;
}) {
  const { t } = useAppPreferences();
  const { evidence, methodology, limitations } = envelope;
  const sourceEntries = Object.entries(evidence.source_timestamps);

  return (
    <article className="tg-panel space-y-5 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-foreground">
            {evidence.evidence_id}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            ({envelope.tool})
          </span>
          <DataModeBadge mode={evidence.data_mode} />
          <FreshnessBadge freshness={evidence.freshness} />
        </div>

        <Link
          href={`/evidence?id=${encodeURIComponent(evidence.evidence_id)}`}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 font-mono text-xs font-bold text-primary-foreground transition-opacity duration-200 hover:opacity-90"
        >
          <span>{t.playground.openEvidence}</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label={t.playground.retrievedUtc}
          value={formatUtc(evidence.retrieved_at_utc).slice(11)}
          sub={formatUtc(evidence.retrieved_at_utc).slice(0, 10)}
        />
        <MetricTile
          label={t.playground.creditCost}
          value={String(evidence.cmc_credit_cost)}
          sub={
            evidence.cache_hit
              ? t.playground.servedFromCache
              : t.playground.upstreamLiveCall
          }
          toneClass={evidence.cache_hit ? "text-positive" : "text-accent"}
        />
        <MetricTile
          label={t.playground.observationWindow}
          value={methodology.annualization_basis}
          sub={methodology.observation_window}
        />
        <MetricTile
          label={t.playground.engineVersion}
          value={envelope.status}
          sub={envelope.engine_version}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card-elevated/60 p-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.playground.endpointsCalled} ({evidence.cmc_endpoints_called.length})
          </p>
          {evidence.cmc_endpoints_called.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              {MISSING}
            </p>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs text-foreground">
              {evidence.cmc_endpoints_called.map((ep) => (
                <li
                  key={ep}
                  className="rounded-lg border border-border bg-card px-3 py-1.5"
                >
                  {ep}
                </li>
              ))}
            </ul>
          )}

          {sourceEntries.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t.playground.sourceTimestamps}
              </p>
              <dl className="mt-2 space-y-1.5 font-mono text-[11px]">
                {sourceEntries.map(([endpoint, ts]) => (
                  <div key={endpoint} className="flex justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{endpoint}</dt>
                    <dd className="shrink-0 text-foreground">{formatUtc(ts)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-card-elevated/60 p-4">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.playground.methodologyTitle} ({methodology.annualization_basis})
          </p>
          {methodology.metrics.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No formulas listed.
            </p>
          ) : (
            <ul className="space-y-1.5 font-mono text-xs text-foreground">
              {methodology.metrics.map((formula) => (
                <li
                  key={formula}
                  className="rounded-lg border border-border bg-card px-3 py-1.5"
                >
                  {formula}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <LimitationsBox limitations={limitations} />
    </article>
  );
}
