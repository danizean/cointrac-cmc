"use client";

import Link from "next/link";
import { TOOL_CATALOG } from "@/lib/catalog";
import { MARKETING } from "@/lib/marketing-copy";
import { useAppPreferences } from "../app-preferences";

export function DocsView() {
  const { locale } = useAppPreferences();
  const copy = MARKETING[locale].docs;

  return (
    <main id="content" className="mx-auto w-full max-w-[1200px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-link">{copy.eyebrow}</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1>
      <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">{copy.lede}</p>

      <section id="api" className="mt-12 scroll-mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">REST</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{copy.apiIntro}</p>
        <div className="mt-6 overflow-x-auto rounded-[14px] border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Path</th>
                <th className="px-4 py-3 font-medium">Tool</th>
              </tr>
            </thead>
            <tbody>
              {TOOL_CATALOG.map((tool) => (
                <tr key={tool.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-primary">{tool.method}</td>
                  <td className="px-4 py-3 font-mono text-xs">{tool.restPath}</td>
                  <td className="px-4 py-3">{tool.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-14 space-y-12">
        {copy.sections.map((section) => (
          <section key={section.title} className="border-t border-border pt-8">
            <h2 className="text-2xl font-semibold tracking-tight">{section.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{section.body}</p>
            <ul className="mt-4 flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
              {section.links.map((link) => (
                <li key={link.href + link.label}>
                  <Link href={link.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.source}
            </h3>
            <ul className="mt-2 space-y-1">
              {section.sources.map((source) => (
                <li key={source} className="font-mono text-xs break-all text-foreground">
                  {source}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
