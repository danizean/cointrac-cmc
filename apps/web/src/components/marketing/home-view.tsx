"use client";

import Image from "next/image";
import Link from "next/link";
import { PROMPT_CATALOG, RESOURCE_CATALOG, TOOL_CATALOG } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import type { ToolName } from "@/lib/types";
import { useAppPreferences } from "../app-preferences";

const PREVIEW: ToolName[] = [
  "get_market_overview",
  "analyze_market_regime",
  "scan_market_movers",
  "analyze_asset",
];

export function HomeView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].home;
  const preview = PREVIEW.map((name) => TOOL_CATALOG.find((tool) => tool.name === name)).filter(
    (tool) => tool !== undefined,
  );

  return (
    <main id="content" className="mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-8">
      <section className="grid items-start gap-10 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:py-14">
        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] text-primary">{copy.eyebrow}</p>
          <h1 className="mt-4 max-w-[18ch] text-4xl font-semibold leading-[1.12] tracking-tight text-foreground sm:text-5xl">
            {copy.title}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">{copy.lede}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="tg-btn tg-btn-primary inline-flex">
              {copy.primaryCta}
            </Link>
            <Link href="/docs" className="tg-btn tg-btn-secondary inline-flex">
              {copy.secondaryCta}
            </Link>
          </div>
        </div>
        <figure className="min-w-0 rounded-[14px] border border-border bg-card">
          <div className="flex items-center border-b border-border bg-[#080B12] px-5 py-4">
            <Image
              src="/brand/cointrac-wordmark.png"
              alt="CoinTrac"
              width={150}
              height={28}
              priority
              className="h-7 w-auto"
            />
          </div>
          <dl>
            {preview.map((tool) => (
              <div key={tool.name} className="border-b border-border px-5 py-4 last:border-b-0">
                <dt className="font-mono text-xs text-primary">{tool.method} {tool.restPath}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-foreground">{tool.summary}</dd>
              </div>
            ))}
          </dl>
          <figcaption className="px-5 py-4 text-xs leading-relaxed text-muted-foreground">
            {copy.stageCaption} {TOOL_CATALOG.length} tools · {RESOURCE_CATALOG.filter((item) => !item.uri.includes("{")).length} resources · {RESOURCE_CATALOG.filter((item) => item.uri.includes("{")).length} templates · {PROMPT_CATALOG.length} prompts.
          </figcaption>
        </figure>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.audiencesTitle}</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {copy.audiences.map((item) => (
            <article key={item.title} className="rounded-[14px] border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight">{copy.problemTitle}</h2>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.problemBody}</p>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.flowTitle}</h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{copy.flowLede}</p>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {copy.flow.map((step, index) => (
            <li key={step.title} className="rounded-[14px] border border-border p-5">
              <p className="font-mono text-xs text-primary">0{index + 1}</p>
              <h3 className="mt-2 text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-border py-14">
        <div className="grid gap-8 lg:grid-cols-2">
          <article>
            <h2 className="text-2xl font-semibold tracking-tight">API</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{copy.channels[2]?.body}</p>
            <Link href="/docs" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
              {copy.docsCta}
            </Link>
          </article>
          <article>
            <h2 className="text-2xl font-semibold tracking-tight">MCP</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{copy.mcpLede}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.mcpNote}</p>
            <Link href="/integrations" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-primary">
              {copy.channels[1]?.title}
            </Link>
          </article>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-24 border-t border-border py-14">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.pricingTitle}</h2>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{copy.pricingLede}</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {copy.plans.map((plan) => (
            <article key={plan.title} className="rounded-[14px] border border-border bg-card p-5">
              <h3 className="text-base font-semibold">{plan.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{plan.body}</p>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">{copy.pricingNote}</p>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="text-2xl font-semibold tracking-tight">{copy.faqTitle}</h2>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {copy.faq.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="cursor-pointer text-base font-medium text-foreground">{item.question}</summary>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-14">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight">{copy.closingTitle}</h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">{copy.closingBody}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/signup" className="tg-btn tg-btn-primary inline-flex">
            {copy.primaryCta}
          </Link>
          <Link href="/capabilities" className="tg-btn tg-btn-secondary inline-flex">
            {copy.previewLink}
          </Link>
        </div>
      </section>
    </main>
  );
}
