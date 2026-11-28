"use client";

import { ArrowRight, Check, Copy, KeyRound, Plug, Server } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PROMPT_CATALOG, RESOURCE_CATALOG, publicMcpUrl } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import { useAppPreferences } from "../app-preferences";

export function IntegrationsView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].integrations;
  const mcpUrl = publicMcpUrl();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

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
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.eyebrow}</span>
          </div>

          <h1
            id="integrations-hero-heading"
            className="ct-enter-delay-1 mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl"
          >
            {copy.title}
          </h1>

          <p className="ct-enter-delay-2 mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
            {copy.lede}
          </p>

          <div className="ct-enter-delay-3 mt-7 flex flex-wrap gap-3">
            <Link href="/connect" className="tg-btn tg-btn-primary ct-btn-glow inline-flex">
              <span>{copy.connectCta}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/app/connections" className="tg-btn tg-btn-secondary inline-flex">
              {locale === "id" ? "Buka Koneksi Workspace" : "Open Workspace Connections"}
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-4 py-14 sm:px-6 lg:px-8">
        {/* Transport, Endpoint, Auth Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <section className="ct-surface-card rounded-[16px] p-6">
            <div className="flex items-center gap-2 text-link">
              <Plug className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">{copy.conceptTitle}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {copy.conceptBody}
            </p>
          </section>

          <section className="ct-surface-featured rounded-[16px] p-6">
            <div className="flex items-center gap-2 text-link">
              <Server className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">{copy.localTitle}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.localBody}</p>
            <div className="mt-4 flex items-center justify-between gap-2 rounded-[9px] border border-border bg-code-bg px-3 py-2">
              <code className="truncate font-mono text-xs text-link">{mcpUrl}</code>
              <button
                type="button"
                onClick={() => void handleCopy()}
                aria-label={locale === "id" ? "Salin URL MCP" : "Copy MCP URL"}
                className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </section>

          <section className="ct-surface-card rounded-[16px] p-6">
            <div className="flex items-center gap-2 text-link">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">{copy.publicTitle}</h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.publicBody}</p>
          </section>
        </div>

        {/* 4 Target Clients: ChatGPT, Claude, Gemini, Hermes */}
        <section aria-labelledby="integrations-clients-heading" className="mt-16">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2
              id="integrations-clients-heading"
              className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
            >
              {copy.statusTitle}
            </h2>
            <span className="font-mono text-xs text-subtle-foreground">
              ChatGPT · Claude · Gemini · Hermes
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {copy.rows.map((row) => (
              <article
                key={row.name}
                className="ct-surface-card flex flex-col justify-between rounded-[16px] p-6 transition-colors hover:border-border-strong"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold tracking-tight text-foreground">
                      {row.name}
                    </h3>
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-link">
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{row.detail}</p>
                </div>
                <div className="mt-5 border-t border-border/80 pt-3">
                  <Link
                    href="/connect"
                    className="inline-flex items-center gap-1.5 font-mono text-xs font-medium text-link hover:underline"
                  >
                    <span>{locale === "id" ? "Lihat panduan koneksi" : "View setup guide"}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Resources & Prompts */}
        <section
          aria-labelledby="integrations-resources-heading"
          className="mt-16 grid gap-6 border-t border-border pt-14 lg:grid-cols-2"
        >
          <div className="ct-surface-featured rounded-[16px] p-6">
            <h2
              id="integrations-resources-heading"
              className="text-xl font-semibold tracking-tight text-foreground"
            >
              Resources &amp; URI templates
            </h2>
            <p className="mt-1.5 font-mono text-[11px] text-subtle-foreground">
              {locale === "id"
                ? "3 statis via resources/list · 3 template URI via resources/templates/list"
                : "3 static via resources/list · 3 URI templates via resources/templates/list"}
            </p>
            <ul className="mt-4 divide-y divide-border">
              {RESOURCE_CATALOG.map((resource) => {
                const isTemplate = resource.uri.includes("{");
                return (
                  <li key={resource.uri} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-xs font-semibold text-link">{resource.uri}</p>
                      <span className="rounded-full border border-border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-subtle-foreground">
                        {isTemplate ? "resources/templates/list" : "resources/list"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {resource.description}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="ct-surface-featured rounded-[16px] p-6">
            <h2
              id="integrations-prompts-heading"
              className="text-xl font-semibold tracking-tight text-foreground"
            >
              MCP Prompts
            </h2>
            <p className="mt-1.5 font-mono text-[11px] text-subtle-foreground">
              {locale === "id"
                ? "Semua argumen prompt dikirim sebagai string MCP (mis. symbols: 'BTC,ETH,SOL')."
                : "All prompt arguments are MCP strings (e.g. symbols: 'BTC,ETH,SOL', not arrays)."}
            </p>
            <ul className="mt-4 divide-y divide-border">
              {PROMPT_CATALOG.map((prompt) => (
                <li key={prompt.name} className="py-3 first:pt-0 last:pb-0">
                  <p className="font-mono text-xs font-semibold text-link">{prompt.name}</p>
                  {prompt.args.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {prompt.args.map((arg) => (
                        <span
                          key={arg}
                          className="rounded-full border border-border bg-background/70 px-2 py-0.5 font-mono text-[10px] text-foreground"
                        >
                          {arg}: string (comma-separated)
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {prompt.description}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
