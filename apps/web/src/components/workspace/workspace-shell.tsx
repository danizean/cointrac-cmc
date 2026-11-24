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
  Sun,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useAppPreferences } from "@/components/app-preferences";
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
            <nav aria-label={group.label[locale]} className="flex flex-col gap-0.5">
              {items.map((item) => {
                const active = isWorkspaceNavActive(item, pathname);
                const Icon = NAV_ICONS[item.id];
                const label = item.label[locale];
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={label}
                    title={collapsed ? label : undefined}
                    onClick={onNavigate}
                    className={`relative flex min-h-10 items-center rounded-[10px] text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
                    } ${
                      active
                        ? "bg-muted font-semibold text-foreground"
                        : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
    <div className="sticky top-0 z-10 border-b border-border bg-card">
      <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 overflow-x-auto px-4 sm:px-6 lg:px-8">
        <nav
          aria-label={locale === "id" ? "Alat Intelijen Pasar" : "Market Intelligence tools"}
          className="flex items-center gap-1 py-2"
        >
          {MARKET_SUB_ROUTES.map((route) => {
            const active = pathname === route.href;
            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-[8px] px-3 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary/14 font-semibold text-link"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {route.label[locale]}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/playground"
          className="inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-[8px] border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
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
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          aria-label={copy.closeMenu}
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        id="workspace-sidebar"
        aria-label="Workspace navigation"
        className={`hidden h-full shrink-0 flex-col border-r border-border bg-card motion-safe:transition-[width] motion-safe:duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-[248px]"
        }`}
      >
        <div className={`flex h-14 shrink-0 items-center border-b border-border ${collapsed ? "justify-center px-2" : "justify-between px-4"}`}>
          {collapsed ? (
            <Link href="/app" aria-label="CoinTrac Workspace Overview" className="flex h-10 w-10 items-center justify-center">
              <Image src="/brand/cointrac-symbol.png" alt="" width={28} height={28} className="h-7 w-7" />
            </Link>
          ) : (
            <Link href="/app" aria-label="CoinTrac Workspace Overview" className="flex min-w-0 items-center">
              <span className="inline-flex items-center rounded-[8px] bg-[#080B12] px-2 py-1">
                <Image
                  src="/brand/cointrac-wordmark.png"
                  alt="CoinTrac"
                  width={132}
                  height={24}
                  className="h-6 w-auto object-contain"
                />
              </span>
            </Link>
          )}
          {collapsed ? null : (
            <button
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={copy.collapseSidebar}
              aria-expanded
              aria-controls="workspace-sidebar"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <SidebarNav collapsed={collapsed} />
        </div>
        {collapsed ? (
          <div className="flex justify-center border-t border-border py-3">
            <button
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={copy.expandSidebar}
              aria-expanded={false}
              aria-controls="workspace-sidebar"
              title={copy.expandSidebar}
              onClick={() => setCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="border-t border-border px-4 py-3">
            <p className="truncate font-mono text-xs text-foreground" title={email}>
              {email}
            </p>
            <p className="mt-0.5 text-[11px] text-subtle-foreground">
              {locale === "id" ? "Sesi terverifikasi · 10 MCP tools" : "Verified session · 10 MCP tools"}
            </p>
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
          className="fixed inset-y-0 left-0 z-40 flex h-dvh w-[248px] flex-col border-r border-border bg-card lg:hidden"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <Link href="/app" aria-label="CoinTrac Workspace Overview" onClick={() => setMobileOpen(false)}>
              <span className="inline-flex items-center rounded-[8px] bg-[#080B12] px-2 py-1">
                <Image
                  src="/brand/cointrac-wordmark.png"
                  alt="CoinTrac"
                  width={132}
                  height={24}
                  className="h-6 w-auto object-contain"
                />
              </span>
            </Link>
            <button
              ref={closeDrawerBtnRef}
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-label={copy.closeMenu}
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-4">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={mobileOpen ? true : undefined}>
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4 sm:gap-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <button
              ref={menuBtnRef}
              type="button"
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted lg:hidden"
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

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label={locale === "id" ? "Cari ruang kerja (Ctrl+K)" : "Search workspace (Cmd+K)"}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground sm:px-3"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">
                {locale === "id" ? "Cari..." : "Search..."}
              </span>
              <kbd className="hidden rounded-[5px] border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-subtle-foreground sm:inline">
                ⌘K
              </kbd>
            </button>

            <div
              role="group"
              aria-label={locale === "id" ? "Bahasa" : "Language"}
              className="inline-flex h-10 items-center rounded-[10px] border border-border bg-card p-0.5"
            >
              {(["en", "id"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={locale === code}
                  onClick={() => setLocale(code)}
                  className={`h-8 cursor-pointer rounded-[7px] px-2 font-mono text-[11px] font-semibold uppercase transition-colors ${
                    locale === code
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
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
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground hover:bg-muted"
            >
              <Sun className="hidden h-4 w-4 dark:block" aria-hidden="true" />
              <Moon className="h-4 w-4 dark:hidden" aria-hidden="true" />
            </button>

            <form action="/auth/signout" method="post">
              <button
                type="submit"
                aria-label={copy.signOut}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-3"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{copy.signOut}</span>
              </button>
            </form>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showMarketSubNav ? <MarketSubNav pathname={pathname} /> : null}
          <main id="content" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1320px]">{children}</div>
          </main>
        </div>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
