"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import {
  buildWorkspaceCommands,
  filterWorkspaceCommands,
  type CommandItem,
} from "@/lib/workspace-navigation";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale } = useAppPreferences();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const allCommands = useMemo(() => buildWorkspaceCommands(locale), [locale]);
  const filtered = useMemo(
    () => filterWorkspaceCommands(allCommands, query),
    [allCommands, query],
  );

  const clampedIndex =
    filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  const closePalette = useCallback(() => {
    onOpenChange(false);
    setQuery("");
    setActiveIndex(0);
  }, [onOpenChange]);

  const navigateTo = useCallback(
    (item: CommandItem) => {
      closePalette();
      router.push(item.href);
    },
    [closePalette, router],
  );

  useEffect(() => {
    const onGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          closePalette();
        } else {
          onOpenChange(true);
        }
        return;
      }
      if (
        !open &&
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [open, onOpenChange, closePalette]);

  useEffect(() => {
    if (!open) return;
    const prevFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openedPath = window.location.pathname;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());

    const onDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePalette();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
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
    window.addEventListener("keydown", onDialogKeyDown);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("keydown", onDialogKeyDown);
      if (prevFocused && window.location.pathname === openedPath && prevFocused.isConnected) {
        prevFocused.focus();
      }
    };
  }, [open, closePalette]);

  useEffect(() => {
    if (!open || clampedIndex < 0 || !filtered[clampedIndex]) return;
    const activeEl = document.getElementById(`cmd-${filtered[clampedIndex].id}`);
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [open, clampedIndex, filtered]);

  if (!open) return null;

  const grouped: Array<{ section: CommandItem["section"]; items: CommandItem[] }> = [];
  for (const item of filtered) {
    let bucket = grouped.find((g) => g.section === item.section);
    if (!bucket) {
      bucket = { section: item.section, items: [] };
      grouped.push(bucket);
    }
    bucket.items.push(item);
  }

  let flatCursor = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-[12vh]"
      onClick={closePalette}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={locale === "id" ? "Pencarian cepat ruang kerja" : "Workspace quick search"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-[18px] border border-border-strong bg-card shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-subtle-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closePalette();
              } else if (e.key === "ArrowDown" && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => (prev + 1) % filtered.length);
              } else if (e.key === "ArrowUp" && filtered.length > 0) {
                e.preventDefault();
                setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
              } else if (e.key === "Enter" && clampedIndex >= 0 && filtered[clampedIndex]) {
                e.preventDefault();
                navigateTo(filtered[clampedIndex]);
              }
            }}
            placeholder={
              locale === "id"
                ? "Cari halaman, API Keys, MCP, Evidence, atau Market Intelligence..."
                : "Jump to Overview, Market Intelligence, API Keys, MCP, Usage, Evidence..."
            }
            aria-label={locale === "id" ? "Cari perintah" : "Search commands"}
            aria-controls="workspace-command-list"
            aria-activedescendant={
              clampedIndex >= 0 && filtered[clampedIndex]
                ? `cmd-${filtered[clampedIndex].id}`
                : undefined
            }
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={closePalette}
            aria-label="Close search"
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-subtle-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          id="workspace-command-list"
          role="listbox"
          aria-label="Workspace destinations"
          className="flex-1 overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-foreground">
                {locale === "id" ? "Tidak ada tujuan yang cocok" : "No matching destinations"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "id"
                  ? "Coba kata kunci seperti keys, mcp, usage, evidence, atau market."
                  : "Try searching for keys, mcp, usage, evidence, anomalies, or settings."}
              </p>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.section} className="mb-2 last:mb-0">
                <p className="px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {group.section}
                </p>
                {group.items.map((item) => {
                  flatCursor += 1;
                  const idx = flatCursor;
                  const active = idx === clampedIndex;
                  const isCurrentRoute = pathname === item.href;
                  return (
                    <button
                      key={item.id}
                      id={`cmd-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => navigateTo(item)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                        active
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {item.title}
                          </p>
                          {isCurrentRoute ? (
                            <span className="rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-link">
                              {locale === "id" ? "Aktif" : "Current"}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                      </div>
                      <ArrowRight
                        className={`h-3.5 w-3.5 shrink-0 ${active ? "text-link" : "text-subtle-foreground"}`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-card-elevated/60 px-4 py-2 text-[11px] text-subtle-foreground">
          <div className="flex items-center gap-3 font-mono">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
          <span className="font-mono">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
