"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, ArrowUpRight, ShieldCheck } from "lucide-react";
import {
  formatCompactQuoteCurrency,
  formatInteger,
  formatNumber,
  formatPct,
  formatQuoteCurrency,
  formatRatio,
  formatUtc,
  MISSING,
  pctToneClass,
  UNAVAILABLE,
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
  explainEvidenceStatus,
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
  barPct,
  barClass = "bg-primary",
}: {
  label: string;
  value: string;
  sub?: string;
  toneClass?: string;
  barPct?: number | null;
  barClass?: string;
}) {
  const clamped =
    typeof barPct === "number" && Number.isFinite(barPct)
      ? Math.max(0, Math.min(100, barPct))
      : null;
  return (
    <div className="ct-surface-card flex flex-col justify-between rounded-[14px] p-4 transition-colors hover:border-border-strong">
      <div>
        <p className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
          {label}
        </p>
        <p className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </p>
      </div>
      {clamped !== null ? (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barClass}`}
            style={{ width: `${clamped}%` }}
          />
        </div>
      ) : null}
      {sub ? <p className="mt-2 font-mono text-[11px] text-muted-foreground">{sub}</p> : null}
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
      const btcDom =
        typeof d.btc_dominance === "number" && Number.isFinite(d.btc_dominance)
          ? Math.max(0, Math.min(100, d.btc_dominance))
          : null;
      const ethDom =
        typeof d.eth_dominance === "number" && Number.isFinite(d.eth_dominance)
          ? Math.max(0, Math.min(100 - (btcDom ?? 0), d.eth_dominance))
          : null;
      const fg =
        typeof d.fear_greed_value === "number" && Number.isFinite(d.fear_greed_value)
          ? Math.max(0, Math.min(100, d.fear_greed_value))
          : null;
      const fgTone =
        fg === null
          ? "bg-muted-foreground"
          : fg >= 60
            ? "bg-positive"
            : fg <= 35
              ? "bg-destructive"
              : "bg-warning";

      return (
        <div className="space-y-5">
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              label="Total Market Cap"
              value={formatCompactQuoteCurrency(d.total_market_cap, d.quote_currency)}
              sub={`24h: ${formatPct(d.total_market_cap_change_24h_pct, { signed: true })}`}
              toneClass={pctToneClass(d.total_market_cap_change_24h_pct)}
            />
            <MetricTile
              label="24h Total Volume"
              value={formatCompactQuoteCurrency(d.total_volume_24h, d.quote_currency)}
              sub={`Quote: ${d.quote_currency}`}
            />
            <div className="ct-surface-card flex flex-col justify-between rounded-[14px] p-4 transition-colors hover:border-border-strong">
              <div>
                <p className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  BTC / ETH Dominance
                </p>
                <p className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
                  {`${formatPct(d.btc_dominance, { decimals: 1 })} / ${formatPct(d.eth_dominance, { decimals: 1 })}`}
                </p>
              </div>
              {btcDom !== null ? (
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${btcDom}%` }} />
                  {ethDom !== null ? (
                    <div className="h-full bg-info" style={{ width: `${ethDom}%` }} />
                  ) : null}
                </div>
              ) : null}
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {`BTC 24h: ${formatPct(d.btc_dominance_change_24h, { signed: true })}`}
              </p>
            </div>
            <MetricTile
              label="Fear & Greed"
              value={
                fg !== null
                  ? `${Math.round(fg)} (${d.fear_greed_classification ?? MISSING})`
                  : MISSING
              }
              barPct={fg}
              barClass={fgTone}
              sub={`Top-50 breadth: ${formatPct(d.top50_breadth_positive_pct, { decimals: 1 })}`}
            />
          </div>

          {(d.btc || d.eth || d.sol) && (
            <div className="grid gap-3.5 sm:grid-cols-3">
              {[d.btc, d.eth, d.sol]
                .filter((coin): coin is NonNullable<typeof coin> => coin !== null)
                .map((coin) => {
                  const pos =
                    typeof coin.percent_change_24h === "number" && coin.percent_change_24h >= 0;
                  return (
                    <Link
                      key={coin.symbol}
                      href={`/app/assets?symbol=${encodeURIComponent(coin.symbol)}`}
                      className="ct-surface-card group rounded-[14px] p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:bg-card-elevated"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CoinLogo
                            cmcId={coin.cmc_id}
                            symbol={coin.symbol}
                            name={coin.name}
                            size="md"
                          />
                          <div className="min-w-0 leading-tight">
                            <p className="font-mono text-xs font-bold text-foreground group-hover:text-link">
                              {coin.symbol}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {coin.name ?? coin.symbol}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                            coin.percent_change_24h === null
                              ? "bg-muted text-muted-foreground"
                              : pos
                                ? "bg-positive-soft text-positive"
                                : "bg-destructive-soft text-destructive"
                          }`}
                        >
                          {formatPct(coin.percent_change_24h, { signed: true })}
                        </span>
                      </div>
                      <div className="mt-3 flex items-baseline justify-between gap-2">
                        <p className="font-mono text-lg font-bold tabular-nums text-foreground">
                          {formatQuoteCurrency(coin.price, d.quote_currency)}
                        </p>
                        <ArrowUpRight
                          className="h-3.5 w-3.5 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-link"
                          aria-hidden="true"
                        />
                      </div>
                    </Link>
                  );
                })}
            </div>
          )}

          {(d.top_gainers.length > 0 || d.top_losers.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="ct-surface-card overflow-hidden rounded-[14px]">
                <p className="border-b border-border bg-card-elevated/60 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-positive">
                  Top Gainers (24h)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs tabular-nums">
                    <tbody className="divide-y divide-border">
                      {d.top_gainers.map((item) => (
                        <tr
                          key={item.symbol}
                          className="transition-colors hover:bg-card-elevated/60"
                        >
                          <td className="px-4 py-2.5 font-bold text-foreground">
                            <Link
                              href={`/app/assets?symbol=${encodeURIComponent(item.symbol)}`}
                              className="inline-flex items-center gap-2 hover:text-link"
                            >
                              <CoinLogo
                                cmcId={item.cmc_id}
                                symbol={item.symbol}
                                name={item.name}
                                size="sm"
                              />
                              <span>{item.symbol}</span>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">
                            {formatQuoteCurrency(item.price, d.quote_currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-positive">
                            {formatPct(item.percent_change_24h, { signed: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="ct-surface-card overflow-hidden rounded-[14px]">
                <p className="border-b border-border bg-card-elevated/60 px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-destructive">
                  Top Losers (24h)
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs tabular-nums">
                    <tbody className="divide-y divide-border">
                      {d.top_losers.map((item) => (
                        <tr
                          key={item.symbol}
                          className="transition-colors hover:bg-card-elevated/60"
                        >
                          <td className="px-4 py-2.5 font-bold text-foreground">
                            <Link
                              href={`/app/assets?symbol=${encodeURIComponent(item.symbol)}`}
                              className="inline-flex items-center gap-2 hover:text-link"
                            >
                              <CoinLogo
                                cmcId={item.cmc_id}
                                symbol={item.symbol}
                                name={item.name}
                                size="sm"
                              />
                              <span>{item.symbol}</span>
                            </Link>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">
                            {formatQuoteCurrency(item.price, d.quote_currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-destructive">
                            {formatPct(item.percent_change_24h, { signed: true })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card-elevated/45 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xs font-medium text-muted-foreground">
                Market Regime
              </span>
              <RegimeBadge regime={d.regime} />
              {d.signal_conflict && (
                <span className="inline-flex shrink-0 items-center rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent">
                  SIGNAL CONFLICT
                </span>
              )}
            </div>
            {d.confidence && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-background/70 px-2.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                CONFIDENCE {d.confidence}
              </span>
            )}
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
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
              barPct={d.top50_breadth_positive_pct}
              barClass="bg-primary"
            />
            <MetricTile
              label="Fear & Greed"
              value={
                d.fear_greed_value !== null
                  ? `${Math.round(d.fear_greed_value)} / 100`
                  : MISSING
              }
              barPct={d.fear_greed_value}
              barClass={
                d.fear_greed_value !== null && d.fear_greed_value >= 60
                  ? "bg-positive"
                  : d.fear_greed_value !== null && d.fear_greed_value <= 35
                    ? "bg-destructive"
                    : "bg-warning"
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
                  className="rounded-[8px] border border-border bg-background/70 px-3 py-1 font-mono text-[11px] text-foreground"
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
          No coins matched all screening filters. Try raising the Max 24h Gain cap or lowering the
          minimum Market Cap / Volume.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3.5 py-2.5">Coin</th>
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
                    <Link
                      href={`/app/assets?symbol=${encodeURIComponent(row.symbol)}`}
                      className="group inline-flex items-center gap-2 hover:text-link"
                    >
                      <CoinLogo
                        cmcId={row.cmc_id}
                        symbol={row.symbol}
                        name={row.name}
                        size="sm"
                      />
                      <span>
                        {row.symbol}
                        {row.name ? (
                          <span className="ml-1.5 font-sans font-normal text-muted-foreground group-hover:text-link/80">
                            {row.name}
                          </span>
                        ) : null}
                      </span>
                      <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                    </Link>
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatCompactQuoteCurrency(row.market_cap, d.quote_currency)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right">
                    {formatCompactQuoteCurrency(row.volume_24h, d.quote_currency)}
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
        <div className="space-y-2.5">
          <p className="font-mono text-[11px] text-muted-foreground">
            Comparison table only — row order does not imply winner ranking. Quote currency:{" "}
            <strong className="text-foreground">{d.quote_currency}</strong>
          </p>
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
                              CMC ID {asset.cmc_id}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right">
                      {formatQuoteCurrency(asset.price, d.quote_currency)}
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
                    <td className="px-3.5 py-2.5 text-right text-muted-foreground">
                      {asset.annualized_volatility !== null
                        ? formatPct(asset.annualized_volatility * 100, {
                            decimals: 1,
                          })
                        : UNAVAILABLE}
                    </td>
                    <td className="px-3.5 py-2.5 text-right text-destructive">
                      {asset.max_drawdown !== null
                        ? formatPct(asset.max_drawdown * 100, { decimals: 1 })
                        : UNAVAILABLE}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              value={formatQuoteCurrency(d.price, d.quote_currency)}
              sub={d.cmc_id !== null ? `CMC ID #${d.cmc_id}` : "Canonical ID —"}
            />
            <MetricTile
              label="Market Cap"
              value={formatCompactQuoteCurrency(d.market_cap, d.quote_currency)}
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
                  : UNAVAILABLE
              }
              sub={`Max DD: ${
                d.max_drawdown !== null
                  ? formatPct(d.max_drawdown * 100, { decimals: 1 })
                  : UNAVAILABLE
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
        <div className="space-y-2.5">
          <p className="font-mono text-[11px] text-muted-foreground">
            Momentum metrics reflect past returns only and are not trade entry signals. Spread (7d−30d) shows cumulative return spread (pp); Daily Rate Δ normalizes to per-day rate.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[780px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5">Symbol</th>
                  <th className="px-3.5 py-2.5 text-right">1h</th>
                  <th className="px-3.5 py-2.5 text-right">24h</th>
                  <th className="px-3.5 py-2.5 text-right">7d</th>
                  <th className="px-3.5 py-2.5 text-right">30d</th>
                  <th className="px-3.5 py-2.5 text-right">RS BTC 7d</th>
                  <th className="px-3.5 py-2.5 text-right">Spread (7d−30d)</th>
                  <th className="px-3.5 py-2.5 text-right">Daily Rate Δ</th>
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
                    <td
                      className={`px-3.5 py-2.5 text-right ${pctToneClass(row.daily_rate_spread_7d_vs_30d_pct)}`}
                    >
                      {formatPct(row.daily_rate_spread_7d_vs_30d_pct, {
                        signed: true,
                        decimals: 2,
                      })}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-bold text-primary">
                      {formatNumber(row.composite_momentum_score, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                    <tr key={`${hit.symbol}-${hit.metric}`} className="hover:bg-card-elevated/50">
                      <td className="px-3.5 py-2 font-bold">
                        <Link
                          href={`/app/assets?symbol=${encodeURIComponent(hit.symbol)}`}
                          className="group inline-flex items-center gap-2 hover:text-link"
                        >
                          <CoinLogo cmcId={hit.cmc_id} symbol={hit.symbol} size="sm" />
                          <span>{hit.symbol}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                        </Link>
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

          {d.price_change_outliers.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <p className="border-b border-border bg-card-elevated/70 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-link">
                Price Change Statistical Outliers
              </p>
              <table className="w-full text-left font-mono text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[11px] text-muted-foreground">
                    <th className="px-3.5 py-2">Symbol</th>
                    <th className="px-3.5 py-2 text-right">24h Move</th>
                    <th className="px-3.5 py-2 text-right">Z-Score</th>
                    <th className="px-3.5 py-2 text-right">Mod Z (MAD)</th>
                    <th className="px-3.5 py-2">Direction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.price_change_outliers.map((hit) => (
                    <tr key={`${hit.symbol}-${hit.metric}`} className="hover:bg-card-elevated/50">
                      <td className="px-3.5 py-2 font-bold">
                        <Link
                          href={`/app/assets?symbol=${encodeURIComponent(hit.symbol)}`}
                          className="group inline-flex items-center gap-2 hover:text-link"
                        >
                          <CoinLogo cmcId={hit.cmc_id} symbol={hit.symbol} size="sm" />
                          <span>{hit.symbol}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                        </Link>
                      </td>
                      <td className={`px-3.5 py-2 text-right font-semibold ${pctToneClass(hit.value)}`}>
                        {formatPct(hit.value, { signed: true })}
                      </td>
                      <td className="px-3.5 py-2 text-right">
                        {formatNumber(hit.z_score)}
                      </td>
                      <td className="px-3.5 py-2 text-right font-bold text-link">
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
                    <tr key={div.symbol} className="hover:bg-card-elevated/50">
                      <td className="px-3.5 py-2 font-bold">
                        <Link
                          href={`/app/assets?symbol=${encodeURIComponent(div.symbol)}`}
                          className="group inline-flex items-center gap-2 hover:text-link"
                        >
                          <CoinLogo cmcId={div.cmc_id} symbol={div.symbol} size="sm" />
                          <span>{div.symbol}</span>
                          <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                        </Link>
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning-soft/40 px-3.5 py-2 font-mono text-[11px] text-muted-foreground">
            <span>
              Overlapping multi-tag membership: sector volume shares do NOT sum to 100%.
            </span>
            {(d.unique_constituent_count !== undefined && d.unique_constituent_count !== null) ||
            (d.overlapping_asset_count !== undefined && d.overlapping_asset_count !== null) ? (
              <span className="text-foreground">
                Unique assets: {formatInteger(d.unique_constituent_count)} · Multi-sector overlap:{" "}
                {formatInteger(d.overlapping_asset_count)}
              </span>
            ) : null}
          </div>
          <SectorRotationChart sectors={d.sectors} />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[840px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5">Sector</th>
                  <th className="px-3.5 py-2.5 text-right">Assets</th>
                  <th className="px-3.5 py-2.5 text-right">Median 24h</th>
                  <th className="px-3.5 py-2.5 text-right">Cap-Wt 24h</th>
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
                      className={`px-3.5 py-2.5 text-right font-medium ${pctToneClass(s.cap_weighted_change_24h_pct)}`}
                    >
                      {formatPct(s.cap_weighted_change_24h_pct, { signed: true })}
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

          {d.rwa_universe ? (
            <div className="space-y-3 rounded-xl border border-border bg-card-elevated/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Underlying RWA Universe — Sampled Subset Only (Not Full Universe)
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Isolated from crypto RWA governance tokens. Sampled{" "}
                    {formatInteger(d.rwa_universe.sampled_rwa_assets)} of{" "}
                    {formatInteger(d.rwa_universe.total_rwa_assets)} tracked instruments · Sampled cap:{" "}
                    {formatCompactQuoteCurrency(d.rwa_universe.total_tokenized_market_cap, "USD")} · 24h vol:{" "}
                    {formatCompactQuoteCurrency(d.rwa_universe.total_tokenized_volume_24h, "USD")}
                  </p>
                </div>
                <span className="rounded-full border border-border bg-background px-2.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  Scope: {d.rwa_universe.scope}
                </span>
              </div>
              {d.rwa_universe.top_rwa_assets.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[600px] text-left font-mono text-xs tabular-nums">
                    <thead>
                      <tr className="border-b border-border bg-background/60 text-[10.5px] uppercase text-muted-foreground">
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Market Cap</th>
                        <th className="px-3 py-2 text-right">24h Vol</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {d.rwa_universe.top_rwa_assets.map((asset, idx) => (
                        <tr key={`${asset.rwa_id ?? asset.symbol ?? idx}`}>
                          <td className="px-3 py-2 font-semibold text-foreground">
                            {asset.symbol ?? MISSING}
                            {asset.name ? (
                              <span className="ml-1.5 font-sans font-normal text-muted-foreground">
                                {asset.name}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {asset.asset_type ?? MISSING}
                          </td>
                          <td className="px-3 py-2 text-right">{formatQuoteCurrency(asset.price, "USD")}</td>
                          <td className="px-3 py-2 text-right">{formatCompactQuoteCurrency(asset.market_cap, "USD")}</td>
                          <td className="px-3 py-2 text-right">{formatCompactQuoteCurrency(asset.volume_24h, "USD")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    case "get_historical_performance": {
      const d = envelope.data as HistoricalPerformanceData;
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <CoinLogo cmcId={d.cmc_id} symbol={d.symbol} size="md" />
              <span className="font-mono text-sm font-bold text-foreground">
                {d.symbol}
              </span>
              {d.cmc_id !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                  CMC ID {d.cmc_id}
                </span>
              )}
            </div>
            <Link
              href={`/app/assets?symbol=${encodeURIComponent(d.symbol)}`}
              className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-link hover:underline"
            >
              <span>Asset profile</span>
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
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
                  : UNAVAILABLE
              }
              sub={`Log return: ${d.log_return !== null ? formatRatio(d.log_return, 4) : UNAVAILABLE}`}
              toneClass={pctToneClass(d.simple_return)}
            />
            <MetricTile
              label="Annualized Volatility (365d)"
              value={
                d.annualized_volatility !== null
                  ? formatPct(d.annualized_volatility * 100, { decimals: 2 })
                  : UNAVAILABLE
              }
            />
            <MetricTile
              label="Max Drawdown"
              value={
                d.max_drawdown !== null
                  ? formatPct(d.max_drawdown * 100, { decimals: 2 })
                  : UNAVAILABLE
              }
              toneClass="text-destructive"
            />
            <MetricTile
              label="Beta vs BTC"
              value={d.beta_vs_btc !== null ? formatNumber(d.beta_vs_btc, 3) : UNAVAILABLE}
            />
            <MetricTile
              label="Correlation vs BTC"
              value={
                d.correlation_vs_btc !== null
                  ? formatNumber(d.correlation_vs_btc, 3)
                  : UNAVAILABLE
              }
            />
          </div>
        </div>
      );
    }

    case "analyze_derivatives": {
      const d = envelope.data as DerivativesAnalysisData;
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2.5 font-mono text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2.5">
              <CoinLogo cmcId={d.cmc_id} symbol={d.symbol} size="sm" />
              <span className="font-bold text-foreground">{d.symbol}</span>
              {d.cmc_id !== null && <span>CMC ID {d.cmc_id}</span>}
              <span>·</span>
              <span>Mode:</span>
              <strong className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 text-foreground">
                {d.mode}
              </strong>
            </div>
            <Link
              href={`/app/assets?symbol=${encodeURIComponent(d.symbol)}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-link hover:underline"
            >
              <span>Asset profile</span>
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricTile
              label="Funding Rate (Agg)"
              value={
                d.funding_rate !== null
                  ? formatPct(d.funding_rate * 100, { decimals: 4 })
                  : UNAVAILABLE
              }
            />
            <MetricTile
              label="Open Interest (Sampled Pairs)"
              value={
                d.open_interest !== null
                  ? formatCompactQuoteCurrency(d.open_interest, d.quote_currency)
                  : UNAVAILABLE
              }
              sub={
                d.open_interest_pairs_included !== undefined &&
                d.open_interest_pairs_included !== null
                  ? `Subset of ${formatInteger(d.open_interest_pairs_included)} valid OI pairs (not full market)`
                  : "Subset of sampled pairs; not full-market OI"
              }
            />
            <MetricTile
              label="24h Liquidations (Asset)"
              value={
                d.liquidations_24h !== null
                  ? formatCompactQuoteCurrency(d.liquidations_24h, d.quote_currency)
                  : UNAVAILABLE
              }
              sub="Asset-specific liquidations not exposed on active CMC feed"
            />
            <MetricTile
              label="Market Pairs (Sampled)"
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
                  ? `OI pairs: ${formatInteger(d.open_interest_pairs_included)} · Excluded: ${formatInteger(d.outlier_pairs_excluded)}`
                  : undefined
              }
            />
            <MetricTile
              label="Spot Volume 24h"
              value={
                d.spot_volume_24h !== null
                  ? formatCompactQuoteCurrency(d.spot_volume_24h, d.quote_currency)
                  : UNAVAILABLE
              }
            />
            <MetricTile
              label="Ann. Volatility (365d)"
              value={
                d.annualized_volatility !== null
                  ? formatPct(d.annualized_volatility * 100, { decimals: 2 })
                  : UNAVAILABLE
              }
            />
          </div>

          {d.market_pairs && d.market_pairs.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <p className="border-b border-border bg-card-elevated/70 px-3.5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
                Sampled Derivatives Pairs ({d.market_pairs.length})
              </p>
              <table className="w-full min-w-[780px] text-left font-mono text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[10.5px] uppercase text-muted-foreground">
                    <th className="px-3 py-2">Exchange</th>
                    <th className="px-3 py-2">Pair</th>
                    <th className="px-3 py-2">Quote</th>
                    <th className="px-3 py-2 text-right">Open Interest</th>
                    <th className="px-3 py-2 text-right">Volume 24h</th>
                    <th className="px-3 py-2 text-right">Funding</th>
                    <th className="px-3 py-2">Flags</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.market_pairs.map((pair, idx) => (
                    <tr key={`${pair.market_id ?? pair.market_pair_symbol ?? idx}`}>
                      <td className="px-3 py-2 font-sans font-medium text-foreground">
                        {pair.exchange_name ?? MISSING}
                      </td>
                      <td className="px-3 py-2">{pair.market_pair_symbol ?? MISSING}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {pair.quote_currency ?? MISSING}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCompactQuoteCurrency(pair.open_interest, d.quote_currency)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatCompactQuoteCurrency(pair.volume_24h, d.quote_currency)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {pair.funding_rate !== null
                          ? formatPct(pair.funding_rate * 100, { decimals: 4 })
                          : MISSING}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-muted-foreground">
                        {[
                          pair.outlier_detected ? "outlier" : null,
                          ...pair.exclusions,
                        ]
                          .filter(Boolean)
                          .join(", ") || "included"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {d.market_wide_liquidations || d.derivatives_venues ? (
            <div className="grid gap-3 md:grid-cols-2">
              {d.market_wide_liquidations ? (
                <div className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft/30 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
                      Market-Wide Exchange Liquidations
                    </span>
                    <span className="rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-warning">
                      MARKET-WIDE ONLY — NOT ATTRIBUTABLE TO THIS COIN
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Total 24h</p>
                      <p className="font-semibold text-foreground">
                        {formatCompactQuoteCurrency(
                          d.market_wide_liquidations.total_24h,
                          d.market_wide_liquidations.quote_currency,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Long 24h</p>
                      <p className="font-semibold text-foreground">
                        {formatCompactQuoteCurrency(
                          d.market_wide_liquidations.long_24h,
                          d.market_wide_liquidations.quote_currency,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Short 24h</p>
                      <p className="font-semibold text-foreground">
                        {formatCompactQuoteCurrency(
                          d.market_wide_liquidations.short_24h,
                          d.market_wide_liquidations.quote_currency,
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {d.derivatives_venues ? (
                <div className="space-y-2 rounded-xl border border-warning/40 bg-warning-soft/30 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-foreground">
                      Market-Wide Derivatives Venues ({d.derivatives_venues.sampled_exchanges} sampled)
                    </span>
                    <span className="rounded-full border border-warning/50 bg-warning-soft px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-warning">
                      MARKET-WIDE ONLY — NOT ATTRIBUTABLE TO THIS COIN
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Venue Sample OI</p>
                      <p className="font-semibold text-foreground">
                        {formatCompactQuoteCurrency(
                          d.derivatives_venues.total_open_interest,
                          d.derivatives_venues.quote_currency,
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Venue Sample Vol 24h</p>
                      <p className="font-semibold text-foreground">
                        {formatCompactQuoteCurrency(
                          d.derivatives_venues.total_volume_24h,
                          d.derivatives_venues.quote_currency,
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    case "get_capabilities":
      return (
        <div className="space-y-2.5">
          <div className="rounded-xl border border-primary/35 bg-primary/8 px-3.5 py-2 font-mono text-[11px] font-semibold text-link">
            System Capability Snapshot (Not Live Market Data)
          </div>
          <pre className="overflow-auto rounded-xl border border-border bg-background/80 p-3 font-mono text-xs">
            {JSON.stringify(envelope.data, null, 2)}
          </pre>
        </div>
      );

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
  const pathname = usePathname();
  const inWorkspace = pathname === "/app" || pathname.startsWith("/app/");
  const evidenceHref = `${inWorkspace ? "/app/evidence" : "/evidence"}?id=${encodeURIComponent(envelope.evidence.evidence_id)}`;

  return (
    <article className="ct-surface-featured space-y-5 rounded-[18px] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold text-link">
              {envelope.tool}
            </span>
            <StatusBadge status={envelope.status} />
            <DataModeBadge mode={envelope.evidence.data_mode} />
            {envelope.evidence.data_mode !== "UNAVAILABLE" ? (
              <FreshnessBadge freshness={envelope.evidence.freshness} />
            ) : null}
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            {envelope.summary}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {explainEvidenceStatus(envelope.status)}
          </p>
        </div>

        <Link
          href={evidenceHref}
          className="inline-flex min-h-11 sm:min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1.5 font-mono text-xs font-medium text-foreground transition-colors duration-200 hover:border-primary hover:text-link"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
          <span>{envelope.evidence.evidence_id}</span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      {envelope.warnings && envelope.warnings.length > 0 ? (
        <div className="space-y-1 rounded-xl border border-warning/40 bg-warning-soft/50 px-3.5 py-2.5 text-xs text-foreground">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-warning">
            Warnings
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
            {envelope.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {renderToolData(envelope)}

      <details className="rounded-xl border border-border bg-background/50 px-3.5 py-2.5 text-xs">
        <summary className="cursor-pointer font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Source Timestamps, Freshness &amp; Field Provenance
        </summary>
        <div className="mt-3 space-y-3 font-mono text-[11px]">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <span className="text-subtle-foreground">Retrieved UTC: </span>
              <span className="text-foreground">
                {formatUtc(envelope.evidence.retrieved_at_utc)}
              </span>
            </div>
            <div>
              <span className="text-subtle-foreground">Methodology: </span>
              <span className="text-foreground">
                {envelope.methodology.version ?? MISSING} ({envelope.methodology.annualization_basis})
              </span>
            </div>
            <div>
              <span className="text-subtle-foreground">CMC Credits / Cache: </span>
              <span className="text-foreground">
                {envelope.evidence.cmc_credit_cost} cr ·{" "}
                {envelope.evidence.cache_hit ? "cache_hit=true" : "cache_hit=false"}
              </span>
            </div>
          </div>

          {Object.keys(envelope.evidence.source_timestamps ?? {}).length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase text-subtle-foreground">Source Timestamps</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {Object.entries(envelope.evidence.source_timestamps).map(([key, ts]) => (
                  <div key={key} className="truncate text-muted-foreground">
                    <span className="text-foreground">{key}</span>: {ts}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {envelope.field_provenance &&
          Object.keys(envelope.field_provenance).length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10.5px] uppercase text-subtle-foreground">Field Provenance</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-card-elevated/60 text-muted-foreground">
                      <th className="px-2.5 py-1.5">Field / Metric</th>
                      <th className="px-2.5 py-1.5">Availability</th>
                      <th className="px-2.5 py-1.5">Source / Endpoint</th>
                      <th className="px-2.5 py-1.5">Reason / Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(envelope.field_provenance).map(([field, prov]) => (
                      <tr key={field}>
                        <td className="px-2.5 py-1.5 font-semibold text-foreground">{field}</td>
                        <td className="px-2.5 py-1.5">{prov.availability}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">
                          {prov.endpoint ?? prov.source ?? MISSING}
                        </td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">
                          {prov.reason_code ?? prov.data_mode ?? MISSING}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </details>

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
  const pathname = usePathname();
  const inWorkspace = pathname === "/app" || pathname.startsWith("/app/");
  const evidenceHref = `${inWorkspace ? "/app/evidence" : "/evidence"}?id=${encodeURIComponent(envelope.evidence.evidence_id)}`;
  const { evidence, methodology, limitations } = envelope;
  const sourceEntries = Object.entries(evidence.source_timestamps);

  return (
    <article className="ct-surface-featured space-y-5 rounded-[18px] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-foreground">
            {evidence.evidence_id}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            ({envelope.tool})
          </span>
          <DataModeBadge mode={evidence.data_mode} />
          {evidence.data_mode !== "UNAVAILABLE" ? (
            <FreshnessBadge freshness={evidence.freshness} />
          ) : null}
        </div>

        <Link
          href={evidenceHref}
          className="inline-flex min-h-11 sm:min-h-9 cursor-pointer items-center gap-1.5 rounded-[10px] bg-primary px-3.5 py-1.5 font-mono text-xs font-bold text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
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
