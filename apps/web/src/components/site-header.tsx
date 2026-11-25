"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Menu, Moon, Search, Sun, X } from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "./app-preferences";

const NAV = [
  { href: "/product", key: "capabilities" },
  { href: "/integrations", key: "integrations" },
  { href: "/docs", key: "docs" },
  { href: "/playground", key: "playground" },
] as const;

export function CoinTracMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect width="28" height="28" rx="7" fill="#1769FF" />
      <path
        d="M19.5 10.2C18.3 8.85 16.55 8 14.5 8C10.9 8 8 10.7 8 14C8 17.3 10.9 20 14.5 20C16.6 20 18.4 19.1 19.6 17.65"
        stroke="#FFFFFF"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <circle cx="19.5" cy="14" r="2" fill="#FFFFFF" />
    </svg>
  );
}

export function SiteHeader({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const pathname = usePathname();
  const { locale, t, toggleTheme, setLocale } = useAppPreferences();
  const [mobileOpen, setMobileOpen] = useState(false);

  const labels = {
    capabilities: t.nav.capabilities,
    integrations: t.nav.integrations,
    docs: t.nav.docs,
    playground: t.nav.playground,
  };

  return (
    <header className="tg-glass-header sticky top-0 z-30 border-b border-border/70">
      <a
        href="#content"
        className="absolute left-4 top-3 z-50 -translate-y-24 rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white focus:translate-y-0"
      >
        {t.nav.skipToContent}
      </a>
      <div className="mx-auto grid h-16 max-w-[1240px] grid-cols-[auto_1fr_auto] items-center gap-6 px-4 sm:px-6 lg:px-8">
        {/* Left: Brand */}
        <Link
          href="/"
          aria-label="CoinTrac"
          className="flex min-h-10 items-center gap-2.5 text-foreground transition-opacity hover:opacity-90"
        >
          <CoinTracMark className="h-7 w-7 shrink-0" />
          <span className="text-[16px] font-semibold tracking-[-0.025em] text-foreground">
            CoinTrac
          </span>
        </Link>

        {/* Center: Clean Navigation */}
        <nav
          aria-label="Primary"
          className="hidden items-center justify-center gap-1 lg:flex"
        >
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-9 items-center rounded-full px-4 text-[13.5px] font-medium transition-colors ${
                  active
                    ? "bg-muted/70 text-foreground"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                {labels[item.key]}
              </Link>
            );
          })}
        </nav>

        {/* Right: Utilities + Sign In */}
        <div className="flex items-center justify-end gap-2.5">
          {onOpenSearch ? (
            <button
              type="button"
              onClick={onOpenSearch}
              aria-label={locale === "id" ? "Cari (Ctrl+K)" : "Quick search (Cmd+K)"}
              className="inline-flex h-9 cursor-pointer items-center gap-2.5 rounded-full border border-border/90 bg-card/60 px-3 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/70 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden text-[12px] xl:inline">
                {locale === "id" ? "Cari" : "Search"}
              </span>
              <kbd className="hidden rounded-[5px] border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-subtle-foreground xl:inline">
                ⌘K
              </kbd>
            </button>
          ) : null}

          <div
            role="group"
            aria-label={locale === "id" ? "Bahasa" : "Language"}
            className="hidden h-9 items-center rounded-full border border-border/90 bg-card/60 p-0.5 sm:inline-flex"
          >
            {(["en", "id"] as const).map((code) => {
              const active = locale === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLocale(code)}
                  className={`min-h-7 cursor-pointer rounded-full px-2.5 font-mono text-[11px] font-semibold uppercase transition-colors ${
                    active
                      ? "bg-muted text-foreground"
                      : "text-subtle-foreground hover:text-foreground"
                  }`}
                >
                  {code}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t.nav.toggleTheme}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border/90 bg-card/60 text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/70 hover:text-foreground"
          >
            <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
            <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
          </button>

          <Link
            href="/login"
            className="hidden h-9 items-center gap-1.5 rounded-full border border-border-strong bg-card px-4 text-[13.5px] font-semibold text-foreground shadow-sm transition-colors hover:bg-muted sm:inline-flex"
          >
            <span>{t.nav.signIn}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label={t.nav.toggleMenu}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground lg:hidden"
          >
            {mobileOpen ? (
              <X className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Menu className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-card px-4 py-4 lg:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="flex min-h-11 items-center rounded-[10px] px-3 text-sm font-medium text-foreground hover:bg-muted"
              >
                {labels[item.key]}
              </Link>
            ))}
            <div className="mt-3 border-t border-border pt-3">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="tg-btn tg-btn-secondary inline-flex w-full"
              >
                {t.nav.signIn}
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
