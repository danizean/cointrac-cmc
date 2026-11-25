"use client";

import { FileSearch, Terminal } from "lucide-react";
import { useAppPreferences } from "./app-preferences";

export function PlaygroundHero() {
  const { t } = useAppPreferences();
  return (
    <div className="ct-hero-glow relative border-b border-border/80">
      <div
        aria-hidden="true"
        className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[320px]"
      />
      <section className="relative mx-auto w-full max-w-[1240px] space-y-3.5 px-4 pb-10 pt-12 sm:px-6 lg:px-8 lg:pb-12 lg:pt-14">
        <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t.playground.badge}</span>
        </div>
        <h1 className="ct-enter-delay-1 text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl">
          {t.playground.title}
        </h1>
        <p className="ct-enter-delay-2 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
          {t.playground.desc}
        </p>
      </section>
    </div>
  );
}

export function EvidenceHero() {
  const { t } = useAppPreferences();
  return (
    <section className="space-y-2.5 border-b border-border pb-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-positive/35 bg-positive/12 px-3 py-1 font-mono text-[11px] font-semibold text-positive">
        <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t.evidence.badge}</span>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
        {t.evidence.title}
      </h1>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t.evidence.desc}
      </p>
    </section>
  );
}
