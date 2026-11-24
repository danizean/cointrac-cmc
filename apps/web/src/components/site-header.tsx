"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "./app-preferences";

const NAV = [
  { href: "/capabilities", key: "capabilities" },
  { href: "/docs", key: "docs" },
  { href: "/integrations", key: "integrations" },
  { href: "/#pricing", key: "pricing" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { locale, t, toggleTheme, setLocale } = useAppPreferences();
  const [mobileOpen, setMobileOpen] = useState(false);

  const labels = {
    capabilities: t.nav.capabilities,
    integrations: t.nav.integrations,
    docs: t.nav.docs,
    pricing: t.nav.pricing,
  };

  return (
    <header className="tg-glass-header sticky top-0 z-30 border-b border-border">
      <a
        href="#content"
        className="absolute left-4 top-3 z-50 -translate-y-24 rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-white focus:translate-y-0"
      >
        {t.nav.skipToContent}
      </a>
      <div className="mx-auto flex h-16 max-w-[1120px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="CoinTrac" className="flex min-h-11 items-center text-foreground">
          <span className="inline-flex items-center rounded-[10px] bg-[#080B12] px-2.5 py-1.5">
            <Image
              src="/brand/cointrac-wordmark.png"
              alt="CoinTrac"
              width={150}
              height={28}
              priority
              className="h-7 w-auto object-contain"
            />
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-11 items-center px-3 text-sm font-medium ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[item.key]}
                {active ? (
                  <span className="absolute inset-x-3 bottom-2 h-0.5 bg-primary" aria-hidden="true" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/signup" className="tg-btn tg-btn-primary hidden lg:inline-flex">
            {t.nav.explore}
          </Link>
          <Link
            href="/login"
            className="hidden min-h-11 items-center px-2 text-sm font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
          >
            {t.nav.signIn}
          </Link>
          <div
            role="group"
            aria-label={locale === "id" ? "Bahasa" : "Language"}
            className="inline-flex h-11 items-center rounded-[10px] border border-border bg-card p-0.5"
          >
            {(["en", "id"] as const).map((code) => {
              const active = locale === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLocale(code)}
                  className={`min-h-10 cursor-pointer rounded-[8px] px-2.5 font-mono text-[11px] font-semibold uppercase ${
                    active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
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
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted"
          >
            <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
            <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label={t.nav.toggleMenu}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground lg:hidden"
          >
            {mobileOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <nav aria-label="Mobile" className="border-t border-border px-4 py-3 lg:hidden sm:px-6">
          <div className="mx-auto flex max-w-[1120px] flex-col">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center text-sm font-medium ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {labels[item.key]}
                </Link>
              );
            })}
            <Link
              href="/signup"
              onClick={() => setMobileOpen(false)}
              className="tg-btn tg-btn-primary mt-2 inline-flex"
            >
              {t.nav.explore}
            </Link>
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="flex min-h-11 items-center text-sm font-medium text-muted-foreground sm:hidden"
            >
              {t.nav.signIn}
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
