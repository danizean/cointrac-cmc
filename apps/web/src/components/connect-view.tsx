"use client";

import { ArrowUpRight, BookOpen, Layers, Plug, Terminal } from "lucide-react";
import {
  PROMPT_CATALOG,
  RESOURCE_CATALOG,
  TOOL_CATALOG,
} from "@/lib/catalog";
import { useAppPreferences } from "./app-preferences";
import { ConnectSnippets } from "./connect-snippets";

interface ConnectViewProps {
  mcpUrl: string;
  docsUrl: string;
  apiBaseUrl: string;
}

export function ConnectView({ mcpUrl, docsUrl, apiBaseUrl }: ConnectViewProps) {
  const { t } = useAppPreferences();

  return (
    <main id="content" className="relative overflow-x-clip">
      {/* Hero Header */}
      <div className="ct-hero-glow relative border-b border-border/80">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[340px]"
        />
        <div className="relative mx-auto flex w-full max-w-[1240px] flex-col justify-between gap-6 px-4 pb-12 pt-12 sm:px-6 lg:flex-row lg:items-end lg:px-8 lg:pb-14 lg:pt-16">
          <div className="space-y-4">
            <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
              <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t.connect.badge}</span>
            </div>
            <h1 className="ct-enter-delay-1 text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl">
              {t.connect.title}
            </h1>
            <p className="ct-enter-delay-2 max-w-3xl text-base leading-relaxed text-muted-foreground">
              {t.connect.descPrefix}{" "}
              <code className="rounded-[7px] border border-border bg-card px-2 py-0.5 font-mono text-xs text-link">
                {mcpUrl}
              </code>{" "}
              {t.connect.descSuffix}
            </p>
          </div>

          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tg-btn tg-btn-primary ct-btn-glow ct-enter-delay-3 inline-flex shrink-0 cursor-pointer self-start lg:self-auto"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>{t.connect.openApiBtn}</span>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-14 px-4 py-12 sm:px-6 lg:px-8">
        <section aria-labelledby="snippets-heading" className="space-y-4">
          <h2
            id="snippets-heading"
            className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Plug className="h-3.5 w-3.5 text-link" aria-hidden="true" />
            {t.connect.snippetsHeading}
          </h2>
          <ConnectSnippets mcpUrl={mcpUrl} apiBaseUrl={apiBaseUrl} />
        </section>

        <section aria-labelledby="tools-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="tools-heading"
              className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <Terminal className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              {t.connect.toolsHeading}
            </h2>
            <span className="font-mono text-[11px] text-subtle-foreground">
              {t.connect.toolsHint}
            </span>
          </div>

          <div className="ct-surface-featured overflow-hidden rounded-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-card-elevated/70 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">{t.connect.colMcpTool}</th>
                    <th className="px-4 py-3">{t.connect.colRestEndpoint}</th>
                    <th className="px-4 py-3">{t.connect.colCapability}</th>
                    <th className="px-4 py-3">{t.connect.colRouting}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {TOOL_CATALOG.map((tool) => (
                    <tr key={tool.name} className="transition-colors hover:bg-card-elevated/50">
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-link">
                        {tool.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-foreground">
                        <span
                          className={`mr-2 inline-flex rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold ${
                            tool.method === "GET"
                              ? "bg-positive/15 text-positive"
                              : "bg-primary/15 text-link"
                          }`}
                        >
                          {tool.method}
                        </span>
                        {tool.restPath}
                      </td>
                      <td className="px-4 py-3.5 text-foreground">{tool.summary}</td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {tool.routingNote}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="resources-heading" className="space-y-4">
            <h2
              id="resources-heading"
              className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <Layers className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
              {t.connect.resourcesHeading}
            </h2>

            <div className="space-y-3">
              {RESOURCE_CATALOG.map((res) => (
                <article
                  key={res.uri}
                  className="ct-surface-card rounded-[14px] p-4 transition-colors duration-150 hover:border-border-strong"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="font-mono text-xs font-semibold text-link">
                      {res.uri}
                    </code>
                    <span className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {res.backedBy}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {res.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="prompts-heading" className="space-y-4">
            <h2
              id="prompts-heading"
              className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              <BookOpen className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              {t.connect.promptsHeading}
            </h2>

            <div className="space-y-3">
              {PROMPT_CATALOG.map((prompt) => (
                <article
                  key={prompt.name}
                  className="ct-surface-card rounded-[14px] p-4 transition-colors duration-150 hover:border-border-strong"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-mono text-sm font-semibold text-foreground">
                      {prompt.name}
                    </h3>
                    <span className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {prompt.args.length > 0
                        ? `${t.connect.argsPrefix}: ${prompt.args.join(", ")}`
                        : t.connect.noArgs}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {prompt.description}
                  </p>
                  <p className="mt-3 rounded-[9px] border border-border bg-code-bg px-3 py-2 font-mono text-[11px] text-link">
                    {prompt.workflow}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
