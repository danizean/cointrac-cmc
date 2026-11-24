"use client";

import Link from "next/link";
import { Play, Plug, Sparkles } from "lucide-react";
import { useAppPreferences } from "./app-preferences";

export function OverviewHero() {
  const { t } = useAppPreferences();

  return (
    <section className="flex flex-col justify-between gap-6 border-b border-border pb-7 lg:flex-row lg:items-end">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t.overview.badge}</span>
        </div>
        <h1 className="max-w-3xl text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {t.overview.heroTitlePrefix}{" "}
          <span className="text-primary">{t.overview.heroTitleAccent}</span>
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t.overview.heroDesc}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/playground"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-bold text-accent-foreground shadow-sm transition-opacity duration-200 hover:opacity-90"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {t.overview.ctaPlayground}
        </Link>
        <Link
          href="/connect"
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-xs font-semibold text-foreground shadow-xs transition-colors duration-200 hover:border-primary/50 hover:bg-card-elevated"
        >
          <Plug className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t.overview.ctaConnect}
        </Link>
      </div>
    </section>
  );
}
