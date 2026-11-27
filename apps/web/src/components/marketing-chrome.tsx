"use client";

import { ArrowLeft, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { useAppPreferences } from "./app-preferences";
import { SiteFooter } from "./site-footer";
import { CoinTracMark, SiteHeader } from "./site-header";
import { CommandPalette } from "./workspace/command-palette";
import { DemoLauncher } from "./demo-launcher";

const AUTH_PATHS = new Set(["/login", "/signup", "/reset-password"]);

function AuthChrome({ children }: { children: ReactNode }) {
  const { locale, setLocale, toggleTheme, t } = useAppPreferences();
  const isId = locale === "id";

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <div
        aria-hidden="true"
        className="ct-hero-glow ct-grid-backdrop pointer-events-none fixed inset-x-0 top-0 h-[440px]"
      />
      <header className="relative z-20 mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          aria-label="CoinTrac Home"
          className="flex min-h-10 items-center gap-2.5 text-foreground transition-opacity hover:opacity-90"
        >
          <CoinTracMark className="h-7 w-7 shrink-0" />
          <span className="text-[16px] font-semibold tracking-[-0.025em] text-foreground">
            CoinTrac
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={isId ? "Bahasa" : "Language"}
            className="inline-flex h-8 items-center rounded-full border border-border/90 bg-card/60 p-0.5"
          >
            {(["en", "id"] as const).map((code) => {
              const active = locale === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLocale(code)}
                  className={`min-h-6 cursor-pointer rounded-full px-2 font-mono text-[10.5px] font-semibold uppercase transition-colors ${
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
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border/90 bg-card/60 text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/70 hover:text-foreground"
          >
            <Sun className="hidden h-3.5 w-3.5 dark:block" aria-hidden="true" />
            <Moon className="h-3.5 w-3.5 dark:hidden" aria-hidden="true" />
          </button>

          <Link
            href="/"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/90 bg-card/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isId ? "Beranda" : "Home"}</span>
          </Link>
        </div>
      </header>

      <div className="relative z-10 flex flex-1 flex-col">{children}</div>

      <footer className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-subtle-foreground sm:px-6 lg:px-8">
        <p>{t.footer.note}</p>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            {t.footer.privacy}
          </Link>
          <Link href="/terms" className="transition-colors hover:text-foreground">
            {t.footer.terms}
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function MarketingChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const workspace = pathname === "/app" || pathname.startsWith("/app/");

  if (workspace) {
    return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
  }

  if (AUTH_PATHS.has(pathname)) {
    return <AuthChrome>{children}</AuthChrome>;
  }

  return (
    <>
      <Suspense fallback={<div className="tg-glass-header sticky top-0 z-30 h-16 border-b border-border" />}>
        <SiteHeader onOpenSearch={() => setSearchOpen(true)} />
      </Suspense>
      <div className="flex-1">{children}</div>
      <SiteFooter />
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <DemoLauncher />
    </>
  );
}
