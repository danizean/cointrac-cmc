"use client";

import {
  ChevronRight,
  FileSearch,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEvidenceDetail, fetchEvidenceList } from "@/lib/api";
import { formatUtc, MISSING } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/types";
import { ApiNotice } from "./api-notice";
import { useAppPreferences } from "./app-preferences";
import { CopyButton } from "./copy-button";
import { JsonViewer } from "./json-viewer";
import { DataModeBadge, FreshnessBadge } from "./status-badges";

interface EvidenceInspectorProps {
  initialRecords: EvidenceRecord[];
  initialSelected?: EvidenceRecord | null;
  initialQueryId?: string | null;
  initialError?: {
    status: number;
    message: string;
  } | null;
}

const MODE_FILTERS = [
  { value: "ALL", label: "All Modes" },
  { value: "LIVE", label: "LIVE" },
  { value: "CACHED", label: "CACHED" },
  { value: "VERIFIED_SNAPSHOT_FALLBACK", label: "FALLBACK" },
] as const;

export function EvidenceInspector({
  initialRecords,
  initialSelected = null,
  initialQueryId = null,
  initialError = null,
}: EvidenceInspectorProps) {
  const { t } = useAppPreferences();
  const [records, setRecords] = useState<EvidenceRecord[]>(initialRecords);
  const [error, setError] = useState<{ status: number; message: string } | null>(
    initialError,
  );
  const [loadingList, setLoadingList] = useState(false);

  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<string>("ALL");
  const [lookupId, setLookupId] = useState(initialQueryId ?? "");

  const [selected, setSelected] = useState<EvidenceRecord | null>(
    initialSelected,
  );
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialSelected));
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<{
    status: number;
    message: string;
  } | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  const openDetail = useCallback(async (recordOrId: EvidenceRecord | string) => {
    if (document.activeElement instanceof HTMLElement) {
      lastFocusRef.current = document.activeElement;
    }
    setDrawerOpen(true);
    setDetailError(null);

    if (typeof recordOrId !== "string") {
      setSelected(recordOrId);
      setLoadingDetail(true);
      const res = await fetchEvidenceDetail(recordOrId.evidence_id);
      setLoadingDetail(false);
      if (res.ok) {
        setSelected(res.data);
      }
      return;
    }

    setLoadingDetail(true);
    setSelected(null);
    const res = await fetchEvidenceDetail(recordOrId);
    setLoadingDetail(false);
    if (res.ok) {
      setSelected(res.data);
    } else {
      setDetailError({ status: res.status, message: res.message });
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    const previous = lastFocusRef.current;
    if (previous) {
      window.requestAnimationFrame(() => previous.focus());
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
      }
    }
    if (drawerOpen) {
      closeButtonRef.current?.focus();
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [drawerOpen, closeDrawer]);

  async function handleRefresh() {
    setLoadingList(true);
    const res = await fetchEvidenceList();
    setLoadingList(false);
    if (res.ok) {
      setRecords(res.data.records);
      setError(null);
    } else {
      setError({ status: res.status, message: res.message });
    }
  }

  async function handleLookupSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = lookupId.trim();
    if (!trimmed) return;
    await openDetail(trimmed);
  }

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((row) => {
      if (modeFilter !== "ALL" && row.data_mode !== modeFilter) return false;
      if (!q) return true;
      return (
        row.evidence_id.toLowerCase().includes(q) ||
        row.tool_name.toLowerCase().includes(q) ||
        (row.endpoints_called ?? []).some((ep) => ep.toLowerCase().includes(q))
      );
    });
  }, [records, search, modeFilter]);

  return (
    <div className="space-y-5">
      {/* Filter + Lookup Panel */}
      <div className="tg-panel space-y-4 rounded-2xl p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <label
                htmlFor="evidence-filter"
                className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t.evidence.searchLabel}
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  id="evidence-filter"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.evidence.searchPlaceholder}
                  className="w-full rounded-xl border border-border bg-card-elevated py-2 pl-9 pr-3 font-mono text-xs text-foreground"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={loadingList}
              onClick={handleRefresh}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card-elevated px-4 py-2 font-mono text-xs font-semibold text-foreground transition-colors duration-200 hover:border-primary/50 hover:bg-muted/70 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingList ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              {t.common.refresh}
            </button>
          </div>

          <form onSubmit={handleLookupSubmit} className="flex w-full min-w-0 flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label
                htmlFor="evidence-lookup"
                className="block font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {t.evidence.lookupLabel}
              </label>
              <input
                id="evidence-lookup"
                type="text"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="ev_a1b2c3d4e5"
                className="w-full min-w-0 rounded-xl border border-border bg-card-elevated px-3 py-2 font-mono text-xs text-foreground"
              />
            </div>
            <button
              type="submit"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-accent px-4 py-2 font-mono text-xs font-bold text-accent-foreground transition-opacity duration-200 hover:opacity-90"
            >
              <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
              {t.common.inspect}
            </button>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
          <div
            role="group"
            aria-label="Filter by data mode"
            className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-card-elevated p-1"
          >
            {MODE_FILTERS.map((opt) => {
              const active = modeFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setModeFilter(opt.value)}
                  className={`cursor-pointer whitespace-nowrap rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-all duration-150 ${
                    active
                      ? "bg-foreground text-background shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.value === "ALL" ? t.common.allModes : opt.label}
                </button>
              );
            })}
          </div>

          {error?.status === 401 ? null : (
            <p
              role="status"
              aria-atomic="true"
              className="font-mono text-xs text-muted-foreground"
            >
              {t.evidence.showingPrefix}{" "}
              <strong className="text-foreground">{filteredRecords.length}</strong>{" "}
              {t.evidence.of}{" "}
              <strong className="text-foreground">{records.length}</strong>{" "}
              {t.evidence.recordsSuffix}
            </p>
          )}
        </div>
      </div>

      {error && error.status !== 401 ? <ApiNotice status={error.status} message={error.message} /> : null}

      <div className="tg-panel max-w-full overflow-hidden rounded-2xl">
        {error?.status === 401 ? (
          <div className="space-y-3 p-6">
            <p className="text-sm font-semibold text-foreground">Sign in to read this account&apos;s evidence.</p>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Link href="/login?next=/evidence" className="tg-btn tg-btn-primary inline-flex">
              Sign in
            </Link>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-bold text-foreground">
              {records.length === 0
                ? t.evidence.emptyNoRecords
                : t.evidence.emptyNoMatch}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t.evidence.emptyHint}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-card-elevated/80 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">{t.evidence.colEvidenceId}</th>
                  <th className="px-4 py-3">{t.evidence.colTool}</th>
                  <th className="px-4 py-3">{t.evidence.colDataMode}</th>
                  <th className="px-4 py-3">{t.evidence.colFreshness}</th>
                  <th className="px-4 py-3">{t.evidence.colEndpoints}</th>
                  <th className="px-4 py-3 text-right">{t.evidence.colCredits}</th>
                  <th className="px-4 py-3 text-right">{t.evidence.colCreatedUtc}</th>
                  <th className="w-8 px-2 py-3">
                    <span className="sr-only">{t.common.inspect}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono tabular-nums">
                {filteredRecords.map((row) => {
                  const isSelected =
                    drawerOpen && selected?.evidence_id === row.evidence_id;
                  const endpoints = row.endpoints_called ?? [];
                  return (
                    <tr
                      key={row.evidence_id}
                      onClick={() => openDetail(row)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDetail(row);
                        }
                      }}
                      tabIndex={0}
                      className={`group cursor-pointer transition-colors duration-150 ${
                        isSelected
                          ? "bg-primary/12"
                          : "hover:bg-card-elevated/60"
                      }`}
                    >
                      <td className="px-4 py-3 font-bold text-primary">
                        {row.evidence_id}
                      </td>
                      <td className="px-4 py-3 text-foreground">
                        {row.tool_name}
                      </td>
                      <td className="px-4 py-3">
                        <DataModeBadge mode={row.data_mode} />
                      </td>
                      <td className="px-4 py-3">
                        <FreshnessBadge freshness={row.freshness} />
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground">
                        {endpoints.length > 0 ? endpoints.join(", ") : MISSING}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-foreground">
                        {row.credit_cost}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatUtc(row.created_at)}
                      </td>
                      <td className="px-2 py-3 text-right text-muted-foreground group-hover:text-primary">
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Slide-Over Provenance Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-background/70 backdrop-blur-xs"
          onClick={closeDrawer}
          role="dialog"
          aria-modal="true"
          aria-label="Evidence provenance details"
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border bg-card-elevated/80 px-6 py-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t.evidence.drawerSubtitle}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2.5">
                  <h2 className="truncate font-mono text-lg font-bold text-foreground">
                    {selected?.evidence_id ?? (lookupId || t.evidence.loadingRecord)}
                  </h2>
                  {selected && (
                    <CopyButton
                      text={selected.evidence_id}
                      label={t.evidence.copyId}
                    />
                  )}
                </div>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label={t.common.close}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {loadingDetail && !selected && (
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <Loader2
                    className="h-4 w-4 animate-spin text-primary"
                    aria-hidden="true"
                  />
                  {t.evidence.loadingRecord}
                </div>
              )}

              {detailError && (
                <ApiNotice
                  status={detailError.status}
                  message={detailError.message}
                  title="Could not load evidence record"
                />
              )}

              {selected && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/30 bg-primary/12 px-3 py-0.5 font-mono text-xs font-semibold text-primary">
                      {selected.tool_name}
                    </span>
                    <DataModeBadge mode={selected.data_mode} />
                    <FreshnessBadge freshness={selected.freshness} />
                    <span className="rounded-full border border-border bg-card-elevated px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {selected.engine_version}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-card-elevated/70 p-3.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t.evidence.createdUtc}
                      </p>
                      <p className="mt-1 font-mono text-xs font-bold text-foreground">
                        {formatUtc(selected.created_at)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-card-elevated/70 p-3.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t.playground.creditCost}
                      </p>
                      <p className="mt-1 font-mono text-sm font-bold text-accent">
                        {selected.credit_cost}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-card-elevated/70 p-3.5">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t.evidence.canonicalIds}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs font-bold text-foreground">
                        {selected.asset_cmc_ids &&
                        selected.asset_cmc_ids.length > 0
                          ? selected.asset_cmc_ids.join(", ")
                          : MISSING}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t.playground.endpointsCalled}
                    </p>
                    {(selected.endpoints_called ?? []).length === 0 ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {MISSING}
                      </p>
                    ) : (
                      <ul className="space-y-1.5 font-mono text-xs">
                        {(selected.endpoints_called ?? []).map((ep) => (
                          <li
                            key={ep}
                            className="rounded-lg border border-border bg-card-elevated/80 px-3 py-2 text-foreground"
                          >
                            {ep}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {selected.methodology && (
                    <div className="space-y-2">
                      <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t.evidence.methodology}
                      </p>
                      <JsonViewer
                        title="methodology"
                        value={selected.methodology}
                        maxHeightClass="max-h-48"
                      />
                    </div>
                  )}

                  {selected.limitations && selected.limitations.length > 0 && (
                    <div className="rounded-xl border border-accent/35 bg-accent/10 p-4">
                      <p className="font-mono text-xs font-semibold uppercase text-accent">
                        {t.evidence.recordedLimitations}
                      </p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-foreground">
                        {selected.limitations.map((item, idx) => (
                          <li key={`${idx}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t.evidence.rawExcerpt}
                    </p>
                    {loadingDetail && selected.raw_excerpt === undefined ? (
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-card-elevated/60 p-4 font-mono text-xs text-muted-foreground">
                        <Loader2
                          className="h-4 w-4 animate-spin text-primary"
                          aria-hidden="true"
                        />
                        {t.evidence.loadingRecord}
                      </div>
                    ) : (
                      <JsonViewer
                        title="raw_excerpt (API keys stripped)"
                        value={selected.raw_excerpt ?? {}}
                        maxHeightClass="max-h-80"
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
