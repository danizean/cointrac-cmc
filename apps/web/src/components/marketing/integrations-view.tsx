"use client";

import Link from "next/link";
import { PROMPT_CATALOG, RESOURCE_CATALOG, publicMcpUrl } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import { useAppPreferences } from "../app-preferences";

export function IntegrationsView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].integrations;
  const localUrl = publicMcpUrl();

  return (
    <main id="content" className="mx-auto w-full max-w-[1200px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-link">{copy.eyebrow}</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.lede}</p>

      <div className="mt-14 grid gap-10 md:grid-cols-3">
        <section>
          <h2 className="text-lg font-semibold">{copy.conceptTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.conceptBody}</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">{copy.localTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.localBody}</p>
          <p className="mt-3 font-mono text-xs break-all text-foreground">{localUrl}</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">{copy.publicTitle}</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.publicBody}</p>
        </section>
      </div>

      <div className="mt-8">
        <Link href="/connect" className="tg-btn tg-btn-primary inline-flex">
          {copy.connectCta}
        </Link>
      </div>

      <section className="mt-16 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Resources and templates</h2>
          <ul className="mt-4 space-y-4">
            {RESOURCE_CATALOG.map((resource) => (
              <li key={resource.uri}>
                <p className="font-mono text-xs text-primary">{resource.uri}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{resource.description}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Prompts</h2>
          <ul className="mt-4 space-y-4">
            {PROMPT_CATALOG.map((prompt) => (
              <li key={prompt.name}>
                <p className="font-mono text-xs text-primary">{prompt.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{prompt.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.statusTitle}</h2>
        <ul className="mt-6 border-t border-border">
          {copy.rows.map((row) => (
            <li key={row.name} className="grid gap-2 border-b border-border py-5 md:grid-cols-[16rem_minmax(0,1fr)]">
              <div>
                <p className="text-sm font-semibold text-foreground">{row.name}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-link">{row.status}</p>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{row.detail}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
