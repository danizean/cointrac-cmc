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
    <main
      id="content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6"
    >
      <section className="flex flex-col justify-between gap-6 border-b border-border pb-7 lg:flex-row lg:items-end">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/12 px-3 py-1 font-mono text-[11px] font-semibold text-primary">
            <Plug className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.connect.badge}</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
            {t.connect.title}
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {t.connect.descPrefix}{" "}
            <code className="rounded-lg border border-border bg-card px-2 py-0.5 font-mono text-xs text-primary">
              {mcpUrl}
            </code>{" "}
            {t.connect.descSuffix}
          </p>
        </div>

        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex cursor-pointer items-center gap-2 self-start rounded-xl bg-accent px-4 py-2.5 text-xs font-bold text-accent-foreground shadow-sm transition-opacity duration-200 hover:opacity-90 lg:self-auto"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>{t.connect.openApiBtn}</span>
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </section>

      <section aria-labelledby="snippets-heading" className="space-y-3">
        <h2
          id="snippets-heading"
          className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          <Plug className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          {t.connect.snippetsHeading}
        </h2>
        <ConnectSnippets mcpUrl={mcpUrl} apiBaseUrl={apiBaseUrl} />
      </section>

      <section aria-labelledby="tools-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="tools-heading"
            className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Terminal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {t.connect.toolsHeading}
          </h2>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t.connect.toolsHint}
          </span>
        </div>

        <div className="tg-panel overflow-hidden rounded-2xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/80 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">{t.connect.colMcpTool}</th>
                  <th className="px-4 py-3">{t.connect.colRestEndpoint}</th>
                  <th className="px-4 py-3">{t.connect.colCapability}</th>
                  <th className="px-4 py-3">{t.connect.colRouting}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {TOOL_CATALOG.map((tool) => (
                  <tr key={tool.name} className="hover:bg-card-elevated/60">
                    <td className="px-4 py-3 font-mono font-bold text-primary">
                      {tool.name}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-foreground">
                      <span
                        className={`mr-2 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          tool.method === "GET"
                            ? "bg-positive/15 text-positive"
                            : "bg-primary/15 text-primary"
                        }`}
                      >
                        {tool.method}
                      </span>
                      {tool.restPath}
                    </td>
                    <td className="px-4 py-3 text-foreground">{tool.summary}</td>
                    <td className="px-4 py-3 text-muted-foreground">
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
        <section aria-labelledby="resources-heading" className="space-y-3">
          <h2
            id="resources-heading"
            className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <Layers className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
            {t.connect.resourcesHeading}
          </h2>

          <div className="space-y-2.5">
            {RESOURCE_CATALOG.map((res) => (
              <article
                key={res.uri}
                className="tg-panel rounded-xl p-4 transition-colors duration-150 hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <code className="font-mono text-xs font-bold text-primary">
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

        <section aria-labelledby="prompts-heading" className="space-y-3">
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
                className="tg-panel rounded-xl p-4 transition-colors duration-150 hover:border-accent/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-mono text-sm font-bold text-accent">
                    {prompt.name}
                  </h3>
                  <span className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {prompt.args.length > 0
                      ? `${t.connect.argsPrefix}: ${prompt.args.join(", ")}`
                      : t.connect.noArgs}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-foreground">
                  {prompt.description}
                </p>
                <p className="mt-3 rounded-lg border border-border bg-code-bg px-3 py-2 font-mono text-[11px] text-primary">
                  {prompt.workflow}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
