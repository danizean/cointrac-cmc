"use client";

import Link from "next/link";
import { TOOL_CATALOG, type ToolCatalogEntry } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import type { ToolName } from "@/lib/types";
import { useAppPreferences } from "../app-preferences";

const GROUPS: Record<"market" | "risk" | "history", ToolName[]> = {
  market: ["get_market_overview", "analyze_market_regime", "analyze_asset", "analyze_sector_rotation"],
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

  return (
    <main id="content" className="mx-auto w-full max-w-[1200px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-link">{copy.eyebrow}</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.lede}</p>
      <p className="mt-3 max-w-3xl text-sm text-muted-foreground">{copy.catalogNote}</p>

      <div className="mt-14 space-y-16">
        {copy.groups.map((group) => (
          <section key={group.id}>
            <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{group.body}</p>
            <ul className="mt-6 divide-y divide-border border-y border-border">
              {GROUPS[group.id].map((name) => {
                const tool = entry(name);
                return (
                  <li key={tool.name} className="grid gap-3 py-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <p className="font-mono text-sm break-all text-foreground">{tool.name}</p>
                      <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                        {tool.method} {tool.restPath}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{tool.label}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tool.summary}</p>
                      <p className="mt-2 text-sm leading-relaxed text-foreground">{tool.routingNote}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-16 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.availabilityTitle}</h2>
        <dl className="mt-6 grid gap-6 md:grid-cols-2">
          {copy.availability.map((item) => (
            <div key={item.label}>
              <dt className="font-mono text-sm text-link">{item.label}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-foreground">{copy.modesTitle}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/integrations" className="tg-btn tg-btn-primary inline-flex">
            {copy.nextIntegrations}
          </Link>
          <Link href="/docs" className="tg-btn tg-btn-secondary inline-flex">
            {copy.nextDocs}
          </Link>
        </div>
      </section>
    </main>
  );
}
