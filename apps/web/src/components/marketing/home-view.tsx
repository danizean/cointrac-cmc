"use client";

import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  DatabaseZap,
  FileCheck2,
  Lock,
  Plug,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { PROMPT_CATALOG, RESOURCE_CATALOG } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import { useAppPreferences } from "../app-preferences";
import { HeroConsole } from "./hero-console";

export function HomeView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].home;
  const staticResources = RESOURCE_CATALOG.filter((item) => !item.uri.includes("{")).length;
  const templateResources = RESOURCE_CATALOG.filter((item) => item.uri.includes("{")).length;

  return (
    <main id="content" className="relative overflow-x-clip">
      {/* Architectural Hero */}
      <div className="ct-hero-glow relative">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[560px]"
        />
        <section className="relative mx-auto grid w-full max-w-[1240px] items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:px-8 lg:pb-24 lg:pt-20">
          <div className="space-y-7">
            <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{copy.eyebrow}</span>
            </div>

            <h1 className="ct-enter-delay-1 max-w-[17ch] text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[56px]">
              {copy.title}
            </h1>

            <p className="ct-enter-delay-2 max-w-xl text-[16px] leading-[1.65] text-muted-foreground sm:text-[17px]">
              {copy.lede}
            </p>

            <div className="ct-enter-delay-3 flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href="/signup"
                className="tg-btn tg-btn-primary ct-btn-glow inline-flex min-h-12 px-6"
              >
                <span>{copy.primaryCta}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/playground"
                className="tg-btn tg-btn-secondary inline-flex min-h-12 bg-card/60 px-5"
              >
                <span>{locale === "id" ? "Buka Playground" : "Open Playground"}</span>
              </Link>
              <Link
                href="/docs"
                className="inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold text-link transition-colors hover:text-foreground"
              >
                {copy.secondaryCta}
              </Link>
            </div>
          </div>

          <HeroConsole locale={locale} />
        </section>
      </div>

      {/* Engineering Guarantees Strip */}
      <section className="border-y border-border/80 bg-card/35">
        <div className="mx-auto grid max-w-[1240px] grid-cols-2 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-link">
              <FileCheck2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-xs font-semibold text-foreground">EvidenceEnvelope[T]</p>
              <p className="text-xs text-subtle-foreground">
                {locale === "id" ? "Audit trail setiap respons" : "Audited response contract"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-link">
              <DatabaseZap className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-xs font-semibold text-foreground">Null-Safe Data</p>
              <p className="text-xs text-subtle-foreground">
                {locale === "id" ? "Data kosong tetap null" : "Missing series stay null"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-link">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-xs font-semibold text-foreground">OAuth 2.1 + PKCE</p>
              <p className="text-xs text-subtle-foreground">
                {locale === "id" ? "Isolasi tenant & API key" : "Scoped keys & user isolation"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-card text-link">
              <Plug className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-mono text-xs font-semibold text-foreground">
                {staticResources} Resources · {PROMPT_CATALOG.length} Prompts
              </p>
              <p className="text-xs text-subtle-foreground">
                {templateResources} {locale === "id" ? "template URI MCP" : "MCP URI templates"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8">
        {/* Asymmetric Bento Architecture */}
        <section className="py-20">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
              {locale === "id" ? "Arsitektur" : "Architecture"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-foreground sm:text-4xl">
              {copy.problemTitle}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {copy.problemBody}
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-12">
            {copy.values.map((val, idx) => {
              const Icon = idx === 0 ? Cpu : idx === 1 ? ShieldCheck : FileCheck2;
              const span = idx === 0 ? "lg:col-span-6" : "lg:col-span-3";
              return (
                <article
                  key={val.title}
                  className={`${idx === 0 ? "ct-surface-featured" : "ct-surface-card"} ${span} flex flex-col justify-between rounded-[16px] p-6 transition-colors hover:border-border-strong`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-background text-link">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="font-mono text-[11px] text-subtle-foreground">
                        0{idx + 1}
                      </span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
                      {val.title}
                    </h3>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                      {val.body}
                    </p>
                  </div>

                  {idx === 0 ? (
                    <div className="mt-6 flex flex-wrap gap-2 border-t border-border/80 pt-4 font-mono text-[11px] text-subtle-foreground">
                      <span className="rounded-[6px] border border-border bg-background/70 px-2 py-0.5 text-foreground">
                        status
                      </span>
                      <span className="rounded-[6px] border border-border bg-background/70 px-2 py-0.5 text-foreground">
                        methodology
                      </span>
                      <span className="rounded-[6px] border border-border bg-background/70 px-2 py-0.5 text-foreground">
                        evidence
                      </span>
                      <span className="rounded-[6px] border border-border bg-background/70 px-2 py-0.5 text-foreground">
                        limitations
                      </span>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        {/* Connected Pipeline Flow */}
        <section className="border-t border-border py-20">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
              {locale === "id" ? "Alur Kerja" : "How It Works"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              {copy.flowTitle}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {copy.flowLede}
            </p>
          </div>

          <ol className="relative mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {copy.flow.map((step, index) => (
              <li
                key={step.title}
                className="ct-surface-card relative rounded-[16px] p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-7 items-center rounded-[7px] border border-primary/30 bg-primary/10 px-2 font-mono text-[11px] font-semibold text-link">
                    STEP 0{index + 1}
                  </span>
                  {index < copy.flow.length - 1 ? (
                    <ArrowRight
                      className="hidden h-4 w-4 text-subtle-foreground lg:block"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Dual Interface: REST API & MCP */}
        <section className="border-t border-border py-20">
          <div className="grid gap-6 lg:grid-cols-2">
            <article className="ct-surface-featured flex flex-col justify-between rounded-[18px] p-7">
              <div>
                <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-link">
                  <Terminal className="h-4 w-4" aria-hidden="true" />
                  <span>REST API</span>
                </div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  Unified HTTP JSON Endpoints
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {copy.channels[2]?.body}
                </p>
                <div className="mt-5 rounded-[10px] border border-border bg-code-bg px-4 py-3 font-mono text-xs text-muted-foreground">
                  <span className="text-positive">GET</span>{" "}
                  <span className="text-foreground">/v1/market/overview</span>
                  <span className="mx-2 text-border-strong">·</span>
                  <span className="text-link">x-cointrac-key</span>
                </div>
              </div>
              <div className="mt-6 pt-2">
                <Link
                  href="/docs"
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
                >
                  <span>{copy.docsCta}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </article>

            <article className="ct-surface-featured flex flex-col justify-between rounded-[18px] p-7">
              <div>
                <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-link">
                  <Plug className="h-4 w-4" aria-hidden="true" />
                  <span>Model Context Protocol</span>
                </div>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  Streamable HTTP &amp; Local stdio MCP
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.mcpLede}</p>
                <div className="mt-5 rounded-[10px] border border-border bg-code-bg px-4 py-3 font-mono text-xs text-muted-foreground">
                  <span className="text-link">POST</span>{" "}
                  <span className="text-foreground">https://mcp.cointrac.xyz/mcp</span>
                  <span className="mx-2 text-border-strong">·</span>
                  <span>11 tools</span>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-subtle-foreground">
                  {copy.mcpNote}
                </p>
              </div>
              <div className="mt-6 pt-2">
                <Link
                  href="/integrations"
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
                >
                  <span>{copy.channels[1]?.title}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </article>
          </div>
        </section>

        {/* Audiences */}
        <section className="border-t border-border py-20">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
            {copy.audiencesTitle}
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {copy.audiences.map((item) => (
              <article
                key={item.title}
                className="ct-surface-card rounded-[16px] p-6 transition-colors hover:border-border-strong"
              >
                <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Pricing & Quota Transparency */}
        <section id="pricing" className="scroll-mt-24 border-t border-border py-20">
          <div className="max-w-3xl">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
              {locale === "id" ? "Paket & Kuota" : "Plans & Quotas"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
              {copy.pricingTitle}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {copy.pricingLede}
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
            {copy.plans.map((plan, idx) => {
              const highlighted = idx === 1;
              return (
                <article
                  key={plan.title}
                  className={`flex flex-col justify-between rounded-[16px] p-6 ${
                    highlighted
                      ? "ct-surface-featured border-primary/50"
                      : "ct-surface-card"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />
                        <h3 className="text-base font-semibold text-foreground">{plan.title}</h3>
                      </div>
                      {highlighted ? (
                        <span className="rounded-full border border-primary/35 bg-primary/12 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-link">
                          {locale === "id" ? "Populer" : "Recommended"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      {plan.body}
                    </p>
                  </div>
                  <div className="mt-6 border-t border-border/80 pt-4">
                    <Link
                      href="/signup"
                      className={`tg-btn w-full ${highlighted ? "tg-btn-primary" : "tg-btn-secondary"} inline-flex`}
                    >
                      <span>{copy.primaryCta}</span>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-6 font-mono text-xs text-subtle-foreground">{copy.pricingNote}</p>
        </section>

        {/* FAQ */}
        <section className="border-t border-border py-20">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
            {copy.faqTitle}
          </h2>
          <div className="ct-surface-card mt-8 divide-y divide-border rounded-[16px] px-6">
            {copy.faq.map((item) => (
              <details key={item.question} className="group py-2.5">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-foreground sm:text-base">
                  <span>{item.question}</span>
                  <span className="font-mono text-sm text-subtle-foreground transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="pb-3 pr-6 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-border py-16">
          <div className="ct-surface-featured ct-hero-glow rounded-[20px] p-7 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-3xl">
                {copy.closingTitle}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {copy.closingBody}
              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-col gap-3 sm:flex-row lg:mt-0">
              <Link href="/signup" className="tg-btn tg-btn-primary ct-btn-glow inline-flex">
                <span>{copy.primaryCta}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/product" className="tg-btn tg-btn-secondary inline-flex">
                {copy.previewLink}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
