"use client";

import { FileSearch, Terminal } from "lucide-react";
import { useAppPreferences } from "./app-preferences";

export function PlaygroundHero() {
  const { t } = useAppPreferences();
  return (
    <section className="space-y-2.5 border-b border-border pb-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/12 px-3 py-1 font-mono text-[11px] font-semibold text-accent">
        <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t.playground.badge}</span>
      </div>
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
        {t.playground.title}
      </h1>
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        {t.playground.desc}
      </p>
    </section>
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
