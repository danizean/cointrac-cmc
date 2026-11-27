"use client";

import {
  ArrowRight,
  Search,
  ShieldCheck,
  Zap,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import {
  buildAdminCommands,
  filterAdminCommands,
  type AdminCommandItem,
} from "@/lib/admin-navigation";

const SECTION_ICON: Record<AdminCommandItem["section"], ComponentType<{ className?: string }>> = {
  "Control Plane": ShieldCheck,
  "Quick Actions": Zap,
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function AdminCommandPalette({
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

  const allCommands = useMemo(() => buildAdminCommands(locale), [locale]);
  const filtered = useMemo(
    () => filterAdminCommands(allCommands, query),
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
    (item: AdminCommandItem) => {
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

  if (!open) return null;

  const grouped: Array<{ section: AdminCommandItem["section"]; items: AdminCommandItem[] }> = [];
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pt-[10vh] backdrop-blur-[2px]"
      onClick={closePalette}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={locale === "id" ? "Pencarian Super Admin" : "Super Admin command palette"}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[72vh] w-full max-w-xl flex-col overflow-hidden rounded-[18px] border border-border-strong bg-card shadow-lg"
      >
        <div className="flex items-center gap-2.5 border-b border-border bg-input-bg px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-link" aria-hidden="true" />
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
                ? "Cari menu admin, kuota user, kill switch Muse, atau log audit..."
                : "Search admin views, user quotas, Muse kill switch, or audit logs..."
            }
            aria-label={locale === "id" ? "Cari perintah admin" : "Search admin commands"}
            aria-controls="admin-command-list"
            aria-activedescendant={
              clampedIndex >= 0 && filtered[clampedIndex]
                ? `admin-cmd-${filtered[clampedIndex].id}`
                : undefined
            }
            className="min-h-9 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none"
          />
          <button
            type="button"
            onClick={closePalette}
            aria-label="Close search"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[8px] text-subtle-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div
          id="admin-command-list"
          role="listbox"
          aria-label={locale === "id" ? "Daftar menu admin" : "Admin destinations"}
          className="flex-1 overflow-y-auto p-2"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-foreground">
                {locale === "id" ? "Tidak ada perintah admin yang cocok" : "No matching admin actions"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {locale === "id"
                  ? "Coba ketik overview, users, quota, kill switch, runtime, atau audit."
                  : "Try searching overview, users, quota, kill switch, runtime, or audit."}
              </p>
            </div>
          ) : (
            grouped.map((group) => {
              const SectionIcon = SECTION_ICON[group.section];
              return (
                <div key={group.section} className="mb-2.5 last:mb-0">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle-foreground">
                    <SectionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{group.section}</span>
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      flatCursor += 1;
                      const isSelected = flatCursor === clampedIndex;
                      const isCurrent = pathname === item.href;
                      return (
                        <button
                          key={item.id}
                          id={`admin-cmd-${item.id}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => navigateTo(item)}
                          className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                            isSelected ? "bg-primary/14 text-foreground" : "text-foreground hover:bg-muted"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.title}</p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                              {item.subtitle}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {isCurrent ? (
                              <span className="rounded-full border border-primary/35 bg-primary/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-link">
                                {locale === "id" ? "Aktif" : "Current"}
                              </span>
                            ) : null}
                            <ArrowRight className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden="true" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
