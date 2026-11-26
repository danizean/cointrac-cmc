"use client";

import Link from "next/link";
import { useAppPreferences } from "./app-preferences";
import { EngineStatusPill } from "./engine-status-pill";
import { CoinTracMark } from "./site-header";

export function SiteFooter() {
  const { t } = useAppPreferences();

  const product = [
    { href: "/product", label: t.footer.capabilities },
    { href: "/integrations", label: t.footer.integrations },
    { href: "/docs", label: t.footer.docs },
    { href: "/#pricing", label: t.nav.pricing },
  ];
  const developers = [
    { href: "/signup", label: t.nav.explore },
    { href: "/playground", label: t.footer.playground },
    { href: "/connect", label: t.footer.connect },
    { href: "/evidence", label: t.footer.evidence },
    { href: "/login", label: t.footer.login },
  ];

  return (
    <footer className="mt-20 border-t border-border bg-card/30">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.65fr))] lg:px-8">
        <div className="max-w-sm space-y-4">
          <Link href="/" className="inline-flex items-center gap-2.5 text-foreground">
            <CoinTracMark className="h-6 w-6 shrink-0" />
            <span className="text-base font-semibold tracking-[-0.02em]">CoinTrac</span>
          </Link>
          <p className="text-sm leading-relaxed text-muted-foreground">{t.footer.tagline}</p>
          <div className="pt-1">
            <EngineStatusPill compact />
          </div>
        </div>
        <nav aria-label={t.footer.product}>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
            {t.footer.product}
          </h2>
          <ul className="mt-3 space-y-1">
            {product.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-10 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.developers}>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
            {t.footer.developers}
          </h2>
          <ul className="mt-3 space-y-1">
            {developers.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-10 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t.footer.trust}>
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
            {t.footer.trust}
          </h2>
          <ul className="mt-3 space-y-1">
            <li>
              <Link
                href="/privacy"
                className="inline-flex min-h-10 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.footer.privacy}
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="inline-flex min-h-10 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.footer.terms}
              </Link>
            </li>
            <li>
              <a
                href="https://api.cointrac.xyz/health"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.footer.status}
              </a>
            </li>
            <li>
              <a
                href="mailto:support@cointrac.xyz"
                className="inline-flex min-h-10 items-center font-mono text-xs text-link transition-colors hover:underline"
              >
                {t.footer.contact}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 py-4 text-xs leading-relaxed text-subtle-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>{t.footer.note}</p>
          <p className="font-mono text-[11px]">
            Signal over noise · Evidence-backed quant · cointrac.xyz
          </p>
        </div>
      </div>
    </footer>
  );
}
