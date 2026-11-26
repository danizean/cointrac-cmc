"use client";

import { ArrowRight, Gem, Layers, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badges";
import { TOOL_CATALOG, type ToolCatalogEntry } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import type { ToolName } from "@/lib/types";
import { useAppPreferences } from "../app-preferences";

type GroupId = "all" | "market" | "risk" | "history";

const GROUPS: Record<"market" | "risk" | "history", ToolName[]> = {
  market: [
    "get_market_overview",
    "analyze_market_regime",
    "analyze_asset",
    "analyze_sector_rotation",
  ],
  risk: [
    "scan_market_movers",
    "compare_assets",
    "analyze_momentum",
    "detect_market_anomalies",
    "analyze_derivatives",
  ],
  history: ["get_historical_performance"],
};

function entry(name: ToolName): ToolCatalogEntry {
  const found = TOOL_CATALOG.find((tool) => tool.name === name);
  if (!found) {
    throw new Error(`Missing catalog tool ${name}`);
  }
  return found;
}

export function CapabilitiesView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].capabilities;
  const [filter, setFilter] = useState<GroupId>("all");

  const visibleGroups =
    filter === "all" ? copy.groups : copy.groups.filter((group) => group.id === filter);

  const filterTabs: { id: GroupId; label: string; count: number }[] = [
    { id: "all", label: locale === "id" ? "Semua" : "All", count: TOOL_CATALOG.length },
    { id: "market", label: locale === "id" ? "Pasar & Aset" : "Market", count: GROUPS.market.length },
    { id: "risk", label: locale === "id" ? "Risiko & Screener" : "Risk", count: GROUPS.risk.length },
    { id: "history", label: locale === "id" ? "Historis" : "History", count: GROUPS.history.length },
  ];

  return (
    <main id="content" className="relative overflow-x-clip">
      {/* Hero Header */}
      <div className="ct-hero-glow relative border-b border-border/80">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[360px]"
        />
        <div className="relative mx-auto w-full max-w-[1240px] px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.eyebrow}</span>
          </div>

          <h1
            id="product-hero-heading"
            className="ct-enter-delay-1 mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl"
          >
            {copy.title}
          </h1>

          <p className="ct-enter-delay-2 mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
            {copy.lede}
          </p>

          <div className="ct-enter-delay-3 mt-7 flex flex-wrap items-center justify-between gap-4">
            {/* Category Filter Pills */}
            <div
              role="tablist"
              aria-label={locale === "id" ? "Filter kategori tool" : "Filter tool category"}
              className="inline-flex flex-wrap gap-1.5 rounded-[12px] border border-border bg-card/80 p-1"
            >
              {filterTabs.map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFilter(tab.id)}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span
                      className={`font-mono text-[10.5px] ${
                        active ? "text-white/85" : "text-subtle-foreground"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            <Link
              href="/playground"
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border-strong bg-card px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Play className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Coba di Playground" : "Try in Playground"}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Tool Catalog Groups */}
      <div className="mx-auto w-full max-w-[1240px] px-4 py-14 sm:px-6 lg:px-8">
        <p className="font-mono text-xs text-subtle-foreground">{copy.catalogNote}</p>

        <div className="mt-8 space-y-14">
          {visibleGroups.map((group) => (
            <section
              key={group.id}
              aria-labelledby={`group-${group.id}-heading`}
              className="space-y-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2
                    id={`group-${group.id}-heading`}
                    className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
                  >
                    {group.title}
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {group.body}
                  </p>
                </div>
                <span className="font-mono text-xs text-subtle-foreground">
                  {GROUPS[group.id].length} {GROUPS[group.id].length === 1 ? "tool" : "tools"}
                </span>
              </div>

              <div className="ct-surface-featured overflow-hidden rounded-[16px]">
                <ul className="divide-y divide-border">
                  {GROUPS[group.id].map((name) => {
                    const tool = entry(name);
                    return (
                      <li
                        key={tool.name}
                        className="grid gap-4 p-5 transition-colors hover:bg-card-elevated/50 lg:grid-cols-[24.5rem_minmax(0,1fr)_auto] lg:items-center"
                      >
                        <div className="min-w-0 space-y-2">
                          <p className="font-mono text-sm font-semibold text-link">
                            {tool.name}
                          </p>
                          <p className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] border border-border bg-background/70 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                            <span
                              className={`shrink-0 ${
                                tool.method === "GET"
                                  ? "font-semibold text-positive"
                                  : "font-semibold text-link"
                              }`}
                            >
                              {tool.method}
                            </span>
                            <span className="truncate">{tool.restPath}</span>
                          </p>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-foreground">{tool.label}</p>
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {tool.summary}
                          </p>
                          <p className="text-xs leading-relaxed text-subtle-foreground">
                            {tool.routingNote}
                          </p>
                        </div>

                        <div className="lg:justify-self-end">
                          <Link
                            href="/playground"
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] border border-border bg-background/60 px-3 font-mono text-[11.5px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
                          >
                            <span>{locale === "id" ? "Uji" : "Test"}</span>
                            <ArrowRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
        </div>

        {/* Hidden Gem Discovery Engine Module */}
        <section
          aria-labelledby="hidden-gems-module-heading"
          className="mt-16 border-t border-border pt-14"
        >
          <div className="ct-surface-featured flex flex-col justify-between gap-5 rounded-[16px] p-6 lg:flex-row lg:items-center">
            <div className="max-w-3xl space-y-2">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-link">
                <Gem className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Hidden Gem Discovery Engine</span>
              </div>
              <h2
                id="hidden-gems-module-heading"
                className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
              >
                {locale === "id"
                  ? "Mesin Penemuan Altcoin Deterministik (/v1/hidden-gems/*)"
                  : "Deterministic Altcoin Discovery Pipeline (/v1/hidden-gems/*)"}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {locale === "id"
                  ? "Pemindaian asinkron jalur Early Asymmetric dan Confirmed Momentum dengan penyaring anti-chase, fallback historis adaptif, sitasi bukti teraudit, pengingat Telegram opsional, serta evaluasi forward T+1/3/7/14/30 hari."
                  : "Asynchronous Early Asymmetric & Confirmed Momentum screening with hard-gate anti-chase rules, adaptive historical fallback, evidence-cited explanations, optional Telegram alerts, and T+1/3/7/14/30d outcome checkpoints."}
              </p>
              <div className="flex flex-wrap gap-2 pt-1 font-mono text-[11px] text-muted-foreground">
                <span className="rounded-[7px] border border-border bg-background/70 px-2.5 py-0.5 text-foreground">
                  <strong className="text-link">POST</strong> /v1/hidden-gems/scans
                </span>
                <span className="rounded-[7px] border border-border bg-background/70 px-2.5 py-0.5 text-foreground">
                  <strong className="text-positive">GET</strong> /v1/hidden-gems/candidates
                </span>
                <span className="rounded-[7px] border border-border bg-background/70 px-2.5 py-0.5 text-foreground">
                  <strong className="text-positive">GET</strong> /v1/hidden-gems/quality-stats
                </span>
              </div>
            </div>
            <Link
              href="/app/hidden-gems"
              className="tg-btn tg-btn-secondary inline-flex shrink-0"
            >
              <span>{locale === "id" ? "Buka Workspace" : "Open Workspace"}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* Status & Data Mode Section */}
        <section
          aria-labelledby="availability-heading"
          className="mt-16 border-t border-border pt-14"
        >
          <h2
            id="availability-heading"
            className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {copy.availabilityTitle}
          </h2>
          <dl className="mt-6 grid gap-4 md:grid-cols-2">
            {copy.availability.map((item) => (
              <div
                key={item.label}
                className="ct-surface-card rounded-[16px] p-5 transition-colors hover:border-border-strong"
              >
                <dt>
                  <StatusBadge status={item.label} />
                </dt>
                <dd className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
              </div>
            ))}
          </dl>

          <div className="ct-surface-card mt-6 rounded-[14px] p-5">
            <p className="text-sm leading-relaxed text-muted-foreground">{copy.modesTitle}</p>
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/integrations" className="tg-btn tg-btn-primary ct-btn-glow inline-flex">
              <span>{copy.nextIntegrations}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/docs" className="tg-btn tg-btn-secondary inline-flex">
              {copy.nextDocs}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
