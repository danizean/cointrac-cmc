"use client";

import { ArrowRight, ArrowUpRight, BookOpen, Play } from "lucide-react";
import Link from "next/link";
import { TOOL_CATALOG, publicOpenApiDocsUrl } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import { useAppPreferences } from "../app-preferences";

const HIDDEN_GEM_ROUTES = [
  {
    method: "POST",
    path: "/v1/hidden-gems/scans",
    mcpTool: "REST-only (enqueue)",
    notesEn: "Enqueue async discovery scan (202 Accepted, optional Idempotency-Key)",
    notesId: "Antrekan scan discovery asinkron (202 Accepted, mendukung Idempotency-Key)",
  },
  {
    method: "GET",
    path: "/v1/hidden-gems/scans",
    mcpTool: "REST-only (run history)",
    notesEn: "List account scan runs, credit cost, capability profile & status",
    notesId: "Daftar eksekusi scan akun, biaya kredit, profil kapabilitas & status",
  },
  {
    method: "GET",
    path: "/v1/hidden-gems/candidates",
    mcpTool: "list_hidden_gem_candidates",
    notesEn: "Filter scored candidates (track, horizon, min_score, confidence)",
    notesId: "Filter kandidat terskor (track, horizon, min_score, confidence)",
  },
  {
    method: "GET",
    path: "/v1/hidden-gems/candidates/{id}",
    mcpTool: "get_hidden_gem_detail",
    notesEn: "Inspect 6-component breakdown, deterministic thesis & persisted evidence",
    notesId: "Detail 6 komponen skor, penjelasan deterministik & bukti terpersistensi",
  },
  {
    method: "GET",
    path: "/v1/hidden-gems/quality-stats",
    mcpTool: "get_hidden_gem_quality_stats",
    notesEn: "Aggregated forward T+1/3/7/14/30d outcome accuracy by track & version",
    notesId: "Agregat akurasi evaluasi forward T+1/3/7/14/30d per track & versi",
  },
  {
    method: "POST",
    path: "/v1/hidden-gems/outcomes/evaluate",
    mcpTool: "REST-only (checkpoint eval)",
    notesEn: "Evaluate due forward outcome checkpoints against stored snapshots",
    notesId: "Evaluasi checkpoint outcome forward dari snapshot tersimpan",
  },
] as const;

export function DocsView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].docs;
  const openApiUrl = publicOpenApiDocsUrl();

  return (
    <main id="content" className="relative overflow-x-clip">
      {/* Hero Header */}
      <div className="ct-hero-glow relative border-b border-border/80">
        <div
          aria-hidden="true"
          className="ct-grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[340px]"
        />
        <div className="relative mx-auto w-full max-w-[1240px] px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{copy.eyebrow}</span>
          </div>

          <h1
            id="docs-hero-heading"
            className="ct-enter-delay-1 mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl"
          >
            {copy.title}
          </h1>

          <p className="ct-enter-delay-2 mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-[17px]">
            {copy.lede}
          </p>

          <div className="ct-enter-delay-3 mt-7 flex flex-wrap gap-3">
            <a
              href={openApiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tg-btn tg-btn-primary ct-btn-glow inline-flex"
            >
              <span>{locale === "id" ? "Buka OpenAPI (Swagger)" : "Open OpenAPI Reference"}</span>
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <Link href="/playground" className="tg-btn tg-btn-secondary inline-flex">
              <Play className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{locale === "id" ? "Buka Playground" : "Open Playground"}</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1240px] px-4 py-14 sm:px-6 lg:px-8">
        <section id="api" aria-labelledby="docs-api-heading" className="scroll-mt-24 space-y-4">
          <div>
            <h2
              id="docs-api-heading"
              className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
            >
              REST Intelligence Endpoints
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {copy.apiIntro}
            </p>
          </div>

          <div className="ct-surface-featured overflow-hidden rounded-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead className="border-b border-border bg-card-elevated/60 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Metode" : "Method"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Path endpoint" : "Endpoint path"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Tool MCP" : "MCP tool"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Deskripsi" : "Description"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {TOOL_CATALOG.map((tool) => (
                    <tr key={tool.name} className="transition-colors hover:bg-card-elevated/50">
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs">
                        <span
                          className={`inline-flex rounded-[6px] px-2 py-0.5 font-semibold ${
                            tool.method === "GET"
                              ? "bg-positive-soft text-positive"
                              : "bg-primary/14 text-link"
                          }`}
                        >
                          {tool.method}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-foreground">
                        {tool.restPath}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs font-semibold text-link">
                        {tool.name}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">{tool.label}</td>
                    </tr>
                  ))}
                  <tr className="transition-colors hover:bg-card-elevated/50">
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs">
                      <span className="inline-flex rounded-[6px] bg-positive-soft px-2 py-0.5 font-semibold text-positive">
                        GET
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-foreground">
                      /v1/capabilities
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs font-semibold text-link">
                      get_capabilities
                    </td>
                    <td className="px-4 py-3.5 text-xs text-muted-foreground">
                      Quota Profile, Budget State &amp; Plan Capabilities
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section
          id="hidden-gems-api"
          aria-labelledby="docs-hidden-gems-heading"
          className="mt-14 scroll-mt-24 space-y-4"
        >
          <div>
            <h2
              id="docs-hidden-gems-heading"
              className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
            >
              {locale === "id" ? "Endpoint Hidden Gem Discovery" : "Hidden Gem Discovery Endpoints"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {locale === "id"
                ? "Endpoint terisolasi per akun untuk memindai altcoin Early/Confirmed, menyimpan watchlist, mengaudit penolakan hard-gate, dan melacak outcome forward."
                : "Account-scoped REST endpoints for asynchronous Early/Confirmed altcoin scans, watchlists, hard-gate rejection logs, alerts, and forward outcomes."}
            </p>
          </div>

          <div className="ct-surface-featured overflow-hidden rounded-[16px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                <thead className="border-b border-border bg-card-elevated/60 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Metode" : "Method"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Path endpoint" : "Endpoint path"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Tool MCP" : "MCP tool"}</th>
                    <th className="px-4 py-3 font-semibold">{locale === "id" ? "Fungsi" : "Purpose"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {HIDDEN_GEM_ROUTES.map((route) => (
                    <tr
                      key={`${route.method}-${route.path}`}
                      className="transition-colors hover:bg-card-elevated/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs">
                        <span
                          className={`inline-flex rounded-[6px] px-2 py-0.5 font-semibold ${
                            route.method === "GET"
                              ? "bg-positive-soft text-positive"
                              : "bg-primary/14 text-link"
                          }`}
                        >
                          {route.method}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-foreground">
                        {route.path}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs font-semibold text-link">
                        {route.mcpTool}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        {locale === "id" ? route.notesId : route.notesEn}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {copy.sections.map((section) => (
            <section
              key={section.title}
              className="ct-surface-card flex flex-col justify-between rounded-[16px] p-6 transition-colors hover:border-border-strong"
            >
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
                <ul className="mt-3 flex flex-wrap gap-4">
                  {section.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-link hover:underline"
                      >
                        <span>{link.label}</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 border-t border-border/80 pt-3">
                <h3 className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {copy.source}
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {section.sources.map((source) => (
                    <li key={source} className="font-mono text-xs break-all text-muted-foreground">
                      {source}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>

        {/* Status Meanings Section */}
        <section
          id="status-meanings"
          aria-labelledby="docs-status-heading"
          className="mt-14 scroll-mt-24 space-y-4"
        >
          <div>
            <h2
              id="docs-status-heading"
              className="text-2xl font-semibold tracking-[-0.02em] text-foreground"
            >
              {locale === "id" ? "Arti Status Respons API & MCP" : "Response Status Meanings"}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {locale === "id"
                ? "CoinTrac tidak pernah menyembunyikan data yang kosong sebagai angka nol. Periksa status respons bersama evidence.data_mode dan evidence.cache_hit."
                : "CoinTrac never disguises missing upstream values as zero. Inspect response status alongside evidence.data_mode and evidence.cache_hit."}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                status: "OK",
                desc:
                  locale === "id"
                    ? "Seluruh data yang dibutuhkan tersedia dan seluruh rumus Python selesai penuh."
                    : "All required upstream inputs were available and all deterministic calculations completed.",
              },
              {
                status: "PARTIAL",
                desc:
                  locale === "id"
                    ? "Sebagian metrik tersedia, namun sebagian kolom tetap null dan dijelaskan pada limitations."
                    : "Primary output is available while restricted or missing sub-fields remain null and listed in limitations.",
              },
              {
                status: "TIER_RESTRICTED",
                desc:
                  locale === "id"
                    ? "Paket CoinMarketCap saat ini tidak mengizinkan endpoint tersebut (mis. OHLCV historis tanpa BYOK)."
                    : "The active CoinMarketCap key tier cannot query this endpoint (for example 365d OHLCV without BYOK).",
              },
              {
                status: "INSUFFICIENT_DATA",
                desc:
                  locale === "id"
                    ? "Jumlah sampel observasi belum cukup memenuhi syarat minimum perhitungan statistik."
                    : "Available sample count fell below the minimum statistical threshold; nothing was fabricated.",
              },
            ].map((item) => (
              <div key={item.status} className="ct-surface-card rounded-[14px] p-4">
                <span className="inline-flex rounded-full border border-border bg-card-elevated px-2.5 py-0.5 font-mono text-[11px] font-semibold text-link">
                  {item.status}
                </span>
                <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
