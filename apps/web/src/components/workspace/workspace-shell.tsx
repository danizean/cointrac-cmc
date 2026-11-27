"use client";

import {
  Activity,
  ExternalLink,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { EngineStatusPill } from "@/components/engine-status-pill";
import { CoinTracMark } from "@/components/site-header";
import { Breadcrumb } from "@/components/ui/primitives";
import { workspaceCopy } from "@/lib/workspace-copy";
import {
  breadcrumbsForWorkspacePath,
  isMarketIntelligencePath,
  isWorkspaceNavActive,
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  MARKET_SUB_ROUTES,
  WORKSPACE_GROUPS,
  WORKSPACE_NAV_ITEMS,
  type WorkspaceNavId,
} from "@/lib/workspace-navigation";
import { CommandPalette } from "./command-palette";

const NAV_ICONS: Record<WorkspaceNavId, ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  ai: Sparkles,
  market: LineChart,
  keys: KeyRound,
  connections: Plug,
  usage: Activity,
  evidence: FileCheck2,
  settings: Settings,
};

function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { locale } = useAppPreferences();
  const marketActive = isMarketIntelligencePath(pathname);

  return (
    <div className={`flex flex-col gap-6 ${collapsed ? "px-2" : "px-3"}`}>
      {WORKSPACE_GROUPS.map((group) => {
        const items = WORKSPACE_NAV_ITEMS.filter((item) => item.group === group.id);
        return (
          <div key={group.id}>
            {collapsed ? null : (
              <p className="px-2.5 pb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle-foreground">
                {group.label[locale]}
              </p>
            )}
            <nav aria-label={group.label[locale]} className="flex flex-col gap-1">
              {items.map((item) => {
                const active = isWorkspaceNavActive(item, pathname);
                const Icon = NAV_ICONS[item.id];
                const label = item.label[locale];
                return (
                  <div key={item.id} className="space-y-1">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      aria-label={label}
                      title={collapsed ? label : undefined}
                      onClick={onNavigate}
                      className={`relative flex min-h-11 sm:min-h-10 items-center rounded-[10px] border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        collapsed ? "justify-center px-0" : "gap-2.5 px-3"
                      } ${
                        active
                          ? "border-primary/40 bg-primary/12 font-semibold text-foreground"
                          : "border-transparent font-medium text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                      }`}
                    >
                      {active ? (
                        <span
                          className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                      <Icon
                        className={`h-4 w-4 shrink-0 ${active ? "text-link" : "text-subtle-foreground"}`}
                        aria-hidden="true"
                      />
                      <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
                    </Link>

                    {!collapsed && item.id === "market" && marketActive ? (
                      <ul className="ml-4 space-y-0.5 border-l border-border pl-2.5">
                        {MARKET_SUB_ROUTES.map((sub) => {
                          const subActive = pathname === sub.href;
                          return (
                            <li key={sub.href}>
                              <Link
                                href={sub.href}
                                onClick={onNavigate}
                                aria-current={subActive ? "page" : undefined}
                                className={`flex min-h-9 items-center rounded-[8px] px-2.5 text-xs transition-colors ${
                                  subActive
                                    ? "bg-muted font-semibold text-link"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                }`}
                              >
                                <span className="truncate">{sub.label[locale]}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </nav>
          </div>
        );
      })}
    </div>
  );
}

function MarketSubNav({ pathname }: { pathname: string }) {
  const { locale } = useAppPreferences();

  return (
    <div className="tg-glass-header sticky top-0 z-10 border-b border-border">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 overflow-x-auto px-4 sm:px-6 lg:px-8">
        <nav
          aria-label={locale === "id" ? "Alat Intelijen Pasar" : "Market Intelligence desks"}
          className="flex items-center gap-1 py-2"
        >
          {MARKET_SUB_ROUTES.map((route) => {
            const active = pathname === route.href;
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 sm:min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary/40 bg-primary/14 font-semibold text-link"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {route.label[locale]}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/playground"
          className="inline-flex min-h-10 sm:min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card/80 px-3.5 text-xs font-medium text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground"
        >
          <span>Playground</span>
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function WorkspaceShell({
  email,
  children,
}: {
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { locale, setLocale, toggleTheme, t } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [collapseReady, setCollapseReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const closeDrawerBtnRef = useRef<HTMLButtonElement | null>(null);

  const breadcrumbs = breadcrumbsForWorkspacePath(pathname, locale);
  const currentBreadcrumbLabel = breadcrumbs[breadcrumbs.length - 1]?.label ?? "Workspace";
  const showMarketSubNav = isMarketIntelligencePath(pathname);
  const fullBleedCanvas = pathname === "/app/ai" || pathname.startsWith("/app/ai/");

  useEffect(() => {
    // The server render stays expanded. The saved preference is applied after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is not available during SSR
    setCollapsed(readSidebarCollapsed((key) => window.localStorage.getItem(key)));
    setCollapseReady(true);
  }, []);

  useEffect(() => {
    if (!collapseReady) return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Preference stays in memory when storage is blocked.
    }
  }, [collapseReady, collapsed]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const closeIfDesktop = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener("change", closeIfDesktop);
    return () => media.removeEventListener("change", closeIfDesktop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const triggerEl = menuBtnRef.current;
    const rafId = window.requestAnimationFrame(() => closeDrawerBtnRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key === "Tab" && asideRef.current) {
        const focusables = Array.from(
          asideRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      if (triggerEl && triggerEl.getClientRects().length > 0) triggerEl.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#content"
        className="absolute left-4 top-3 z-50 -translate-y-24 rounded-[10px] bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        {copy.skip}
      </a>

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[1px] lg:hidden"
          aria-label={copy.closeMenu}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        id="workspace-sidebar"
        aria-label="Workspace navigation"
        className={`hidden h-full shrink-0 flex-col overflow-hidden border-r border-border/80 bg-card/70 motion-safe:transition-[width] motion-safe:duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-[252px]"
        }`}
      >
        <div
          className={`flex h-16 shrink-0 items-center border-b border-border/80 ${
            collapsed ? "justify-center px-2" : "justify-between px-4"
          }`}
        >
          {collapsed ? (
            <button
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={copy.expandSidebar}
              aria-expanded={false}
              aria-controls="workspace-sidebar"
              title={copy.expandSidebar}
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <>
              <Link
                href="/app"
                aria-label="CoinTrac Workspace Overview"
                className="flex min-w-0 items-center gap-2.5 text-foreground transition-opacity hover:opacity-90"
              >
                <CoinTracMark className="h-7 w-7 shrink-0" />
                <span className="truncate text-[16px] font-semibold tracking-[-0.025em] text-foreground">
                  CoinTrac
                </span>
              </Link>
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                aria-label={copy.collapseSidebar}
                aria-expanded
                aria-controls="workspace-sidebar"
                onClick={() => setCollapsed(true)}
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-4">
          <SidebarNav collapsed={collapsed} />
        </div>

        {collapsed ? (
          <div className="flex justify-center border-t border-border/80 bg-background/40 py-3">
            <Link
              href="/app/settings"
              title={email}
              aria-label={email}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/35 bg-primary/12 font-mono text-[11px] font-semibold uppercase text-link"
            >
              {(email[0] ?? "U").toUpperCase()}
            </Link>
          </div>
        ) : (
          <div className="border-t border-border/80 bg-background/40 px-4 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/12 font-mono text-[11px] font-semibold uppercase text-link">
                {(email[0] ?? "U").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-medium text-foreground" title={email}>
                  {email}
                </p>
                <p className="text-[11px] text-subtle-foreground">
                  {locale === "id" ? "Akun terverifikasi" : "Verified account"}
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {mobileOpen ? (
        <aside
          ref={asideRef}
          id="workspace-drawer"
          role="dialog"
          aria-label="Workspace navigation"
          aria-modal="true"
          className="fixed inset-y-0 left-0 z-40 flex h-dvh w-[268px] flex-col border-r border-border bg-card shadow-lg lg:hidden"
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
            <Link
              href="/app"
              aria-label="CoinTrac Workspace Overview"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2.5 text-foreground"
            >
              <CoinTracMark className="h-7 w-7 shrink-0" />
              <span className="text-[16px] font-semibold tracking-[-0.025em]">CoinTrac</span>
            </Link>
            <button
              ref={closeDrawerBtnRef}
              type="button"
              className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={copy.closeMenu}
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
          <div className="border-t border-border bg-background/40 px-4 py-3">
            <p className="truncate font-mono text-xs text-foreground">{email}</p>
          </div>
        </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={mobileOpen ? true : undefined}>
        <header className="tg-glass-header flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-4 sm:gap-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              ref={menuBtnRef}
              type="button"
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted lg:hidden"
              aria-label={copy.openMenu}
              aria-expanded={mobileOpen}
              aria-controls="workspace-drawer"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="hidden min-w-0 sm:block">
              <Breadcrumb items={breadcrumbs} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:hidden">
              {currentBreadcrumbLabel}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/app/ai"
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors ${
                pathname === "/app/ai" || pathname.startsWith("/app/ai/")
                  ? "border-primary/50 bg-primary/14 text-link"
                  : "border-border/90 bg-card/60 text-foreground hover:border-primary/40 hover:text-link"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span className="hidden sm:inline">CoinTrac AI</span>
            </Link>

            <div className="hidden md:flex">
              <EngineStatusPill compact />
            </div>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={locale === "id" ? "Cari ruang kerja (Ctrl+K)" : "Search workspace (Cmd+K)"}
              className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border/90 bg-card/60 px-3 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted/70 hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">
                {locale === "id" ? "Cari..." : "Search..."}
              </span>
              <kbd className="hidden rounded-[5px] border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-subtle-foreground sm:inline">
                ⌘K
              </kbd>
            </button>

            <div
              role="group"
              aria-label={locale === "id" ? "Bahasa" : "Language"}
              className="inline-flex h-9 items-center rounded-full border border-border/90 bg-card/60 p-0.5"
            >
              {(["en", "id"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={locale === code}
                  onClick={() => setLocale(code)}
                  className={`min-h-7 cursor-pointer rounded-full px-2.5 font-mono text-[11px] font-semibold uppercase transition-colors ${
                    locale === code
                      ? "bg-muted text-foreground"
                      : "text-subtle-foreground hover:text-foreground"
                  }`}
                >
                  {code}
                </button>
              ))}
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

            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={copy.signOut}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-destructive/45 bg-destructive-soft px-3.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{copy.signOut}</span>
              </button>
            </form>
          </div>
        </header>

        <div className={fullBleedCanvas ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto"}>
          {showMarketSubNav ? <MarketSubNav pathname={pathname} /> : null}
          <main
            id="content"
            className={
              fullBleedCanvas ? "h-full min-w-0" : "min-w-0 px-4 py-6 sm:px-6 lg:px-8"
            }
          >
            <div className={fullBleedCanvas ? "h-full w-full" : "mx-auto w-full max-w-[1440px]"}>
              {children}
            </div>
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
