"use client";

import { ArrowRight, Check, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useAppPreferences } from "@/components/app-preferences";
import { PRICING_COPY } from "@/lib/pricing-copy";

export function PricingView() {
  const { locale } = useAppPreferences();
  const copy = PRICING_COPY[locale];

  return (
    <main id="content" className="relative overflow-x-clip">
      <div className="ct-hero-glow relative border-b border-border/80">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[360px]"
        />
        <div className="relative mx-auto w-full max-w-[1240px] px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.eyebrow}</span>
          </div>

          <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl">
            {copy.title}
          </h1>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
            {copy.lede}
          </p>

          <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-[12px] border border-positive/35 bg-positive-soft px-4 py-2.5 text-xs font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            <span>{copy.freeBanner}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-4 py-14 sm:px-6 lg:px-8">
        {/* Plans Grid */}
        <section aria-labelledby="pricing-plans-heading">
          <h2 id="pricing-plans-heading" className="sr-only">
            {copy.plansHeading}
          </h2>
          <div className="grid gap-5 lg:grid-cols-3">
            {copy.plans.map((plan) => (
              <article
                key={plan.id}
                className={`flex flex-col justify-between rounded-[18px] p-6 ${
                  plan.highlighted ? "ct-surface-featured border-primary/50" : "ct-surface-card"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider ${
                        plan.comingSoon
                          ? "border border-border bg-muted text-muted-foreground"
                          : "border border-positive/35 bg-positive-soft text-positive"
                      }`}
                    >
                      {plan.badge}
                    </span>
                  </div>

                  <div className="mt-4 flex items-baseline gap-1.5">
                    <span className="font-mono text-3xl font-bold tracking-tight text-foreground">
                      {plan.price}
                    </span>
                    <span className="text-xs text-muted-foreground">{plan.period}</span>
                  </div>

                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                    {plan.description}
                  </p>

                  <ul className="mt-5 space-y-2.5 border-t border-border/80 pt-5 text-sm text-foreground">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-positive"
                          aria-hidden="true"
                        />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-7 pt-2">
                  {plan.comingSoon ? (
                    <span
                      aria-disabled="true"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-[11px] border border-border bg-muted/60 px-4 text-xs font-semibold text-muted-foreground"
                    >
                      {plan.ctaLabel}
                    </span>
                  ) : (
                    <Link
                      href={plan.ctaHref}
                      className="tg-btn tg-btn-primary ct-btn-glow flex min-h-11 w-full items-center justify-center gap-2"
                    >
                      <span>{plan.ctaLabel}</span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Plan Limits & BYOK */}
        <section
          aria-labelledby="pricing-byok-heading"
          className="ct-surface-featured mt-12 rounded-[18px] p-6 sm:p-8"
        >
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="max-w-2xl space-y-2">
              <div className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-link">
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copy.byokEyebrow}</span>
              </div>
              <h2
                id="pricing-byok-heading"
                className="text-xl font-semibold tracking-tight text-foreground"
              >
                {copy.byokTitle}
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{copy.byokBody}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link href="/playground" className="tg-btn tg-btn-secondary inline-flex">
                <span>{copy.byokPlaygroundCta}</span>
              </Link>
              <Link href="/docs" className="tg-btn tg-btn-secondary inline-flex">
                <span>{copy.byokDocsCta}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section aria-labelledby="pricing-faq-heading" className="mt-14">
          <h2
            id="pricing-faq-heading"
            className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {copy.faqTitle}
          </h2>
          <dl className="mt-6 grid gap-4 md:grid-cols-2">
            {copy.faq.map((item) => (
              <div key={item.question} className="ct-surface-card rounded-[16px] p-5">
                <dt className="text-sm font-semibold text-foreground">{item.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
