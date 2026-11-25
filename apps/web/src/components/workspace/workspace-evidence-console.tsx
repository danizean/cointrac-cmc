"use client";

import {
  Check,
  ChevronRight,
  Copy,
  FileCheck2,
  FileSearch,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { CopyButton } from "@/components/copy-button";
import { JsonViewer } from "@/components/json-viewer";
import { DataModeBadge, FreshnessBadge } from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { fetchEvidenceDetail, fetchEvidenceList } from "@/lib/api";
import { formatUtc } from "@/lib/format";
import type { EvidenceRecord } from "@/lib/types";

type DateRangeFilter = "all" | "24h" | "7d" | "30d";

const MODE_OPTIONS = [
  { value: "ALL", label: "All modes" },
  { value: "LIVE", label: "LIVE" },
  { value: "CACHED", label: "CACHED" },
  { value: "VERIFIED_SNAPSHOT_FALLBACK", label: "SNAPSHOT" },
  { value: "UNAVAILABLE", label: "UNAVAILABLE" },
] as const;

const DATE_OPTIONS: Array<{ value: DateRangeFilter; label: string }> = [
  { value: "all", label: "All retrieved" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function WorkspaceEvidenceConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();
  const searchParams = useSearchParams();
  const initialQueryId = (searchParams.get("id") ?? "").trim();

  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<{ status: number; message: string } | null>(null);

  const [search, setSearch] = useState("");
  const [toolFilter, setToolFilter] = useState("ALL");
  const [modeFilter, setModeFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<DateRangeFilter>("all");
  const [lookupId, setLookupId] = useState(initialQueryId);

  const [selected, setSelected] = useState<EvidenceRecord | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialQueryId));
  const [loadingDetail, setLoadingDetail] = useState(Boolean(initialQueryId));
  const [detailError, setDetailError] = useState<{ status: number; message: string } | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [referenceNowMs, setReferenceNowMs] = useState<number | null>(null);

  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const loadList = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoadingList(true);
      setListError(null);

      const res = await fetchEvidenceList();
      setLoadingList(false);
      setRefreshing(false);
      setReferenceNowMs(Date.now());
      if (res.ok) {
        setRecords(res.data.records);
        if (isManual) {
          pushToast("Evidence records refreshed.", "info");
        }
      } else {
        setListError({ status: res.status, message: res.message });
        if (isManual) {
          pushToast(res.message, "error");
        }
      }
    },
    [pushToast],
  );

  const openDetail = useCallback(async (recordOrId: EvidenceRecord | string) => {
    setDrawerOpen(true);
    setDetailError(null);
    setCopiedJson(false);

    if (typeof recordOrId !== "string") {
      setSelected(recordOrId);
      setLoadingDetail(true);
      const res = await fetchEvidenceDetail(recordOrId.evidence_id);
      setLoadingDetail(false);
      if (res.ok) {
        setSelected(res.data);
      } else {
        setDetailError({ status: res.status, message: res.message });
      }
      return;
    }

    setSelected(null);
    setLoadingDetail(true);
    const res = await fetchEvidenceDetail(recordOrId);
    setLoadingDetail(false);
    if (res.ok) {
      setSelected(res.data);
    } else {
      setDetailError({ status: res.status, message: res.message });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetchEvidenceList();
      if (!active) return;
      setLoadingList(false);
      setReferenceNowMs(Date.now());
      if (res.ok) {
        setRecords(res.data.records);
      } else {
        setListError({ status: res.status, message: res.message });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!initialQueryId) return;
    let active = true;
    void (async () => {
      const res = await fetchEvidenceDetail(initialQueryId);
      if (!active) return;
      setLoadingDetail(false);
      if (res.ok) {
        setSelected(res.data);
      } else {
        setDetailError({ status: res.status, message: res.message });
      }
    })();
    return () => {
      active = false;
    };
  }, [initialQueryId]);

  // Accessible focus management, Tab trap, Escape close, and focus restoration for detail drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const previousFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const rafId = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
        return;
      }
      if (event.key === "Tab" && drawerRef.current) {
        const focusables = Array.from(
          drawerRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      if (previousFocused && previousFocused.isConnected) {
        previousFocused.focus();
      }
    };
  }, [drawerOpen]);

  async function handleLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = lookupId.trim();
    if (!trimmed) return;
    await openDetail(trimmed);
  }

  async function handleCopyRawJson() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
      setCopiedJson(true);
      pushToast("Evidence JSON copied to clipboard.", "success");
      window.setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      setCopiedJson(false);
      pushToast("Clipboard access unavailable.", "error");
    }
  }

  const toolNames = useMemo(() => {
    const unique = new Set(records.map((r) => r.tool_name));
    return Array.from(unique).sort();
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoffMs =
      referenceNowMs === null
        ? null
        : dateFilter === "24h"
          ? referenceNowMs - 86_400_000
          : dateFilter === "7d"
            ? referenceNowMs - 7 * 86_400_000
            : dateFilter === "30d"
              ? referenceNowMs - 30 * 86_400_000
              : null;

    return records.filter((row) => {
      if (toolFilter !== "ALL" && row.tool_name !== toolFilter) return false;
      if (modeFilter !== "ALL" && row.data_mode !== modeFilter) return false;
      if (cutoffMs !== null) {
        const ts = Date.parse(row.created_at);
        if (Number.isFinite(ts) && ts < cutoffMs) return false;
      }
      if (!q) return true;
      const assetsStr = (row.asset_cmc_ids ?? []).join(",");
      return (
        row.evidence_id.toLowerCase().includes(q) ||
        row.tool_name.toLowerCase().includes(q) ||
        assetsStr.includes(q) ||
        (row.endpoints_called ?? []).some((ep) => ep.toLowerCase().includes(q))
      );
    });
  }, [records, search, toolFilter, modeFilter, dateFilter, referenceNowMs]);

  const hasActiveFilters =
    Boolean(search.trim()) || toolFilter !== "ALL" || modeFilter !== "ALL" || dateFilter !== "all";

  return (
    <div className="space-y-6">
      <PageHeader
        title={isId ? "Riwayat Bukti" : "Evidence"}
        description={
          isId
            ? "Periksa sumber data, stempel waktu, dan jejak asal setiap hasil intelijen CoinTrac."
            : "Inspect the source, timestamp, and provenance of intelligence returned by CoinTrac."
        }
        actions={
          <Button
            variant="primary"
            size="md"
            loading={refreshing}
            onClick={() => void loadList(true)}
            className="ct-btn-glow"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />

      {/* Filter & Direct ID Lookup Bar */}
      <Card className="ct-surface-featured space-y-4 p-5">
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Input
              id="ws-evidence-search"
              type="search"
              label={isId ? "Cari catatan bukti" : "Filter retrieved records"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ev_..., analyze_asset, 1, /v1/..."
            />
          </div>

          <div className="lg:col-span-3">
            <Select
              id="ws-evidence-tool"
              label={isId ? "Alat" : "Tool"}
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
            >
              <option value="ALL">{isId ? "Semua alat" : "All tools"}</option>
              {toolNames.map((tool) => (
                <option key={tool} value={tool}>
                  {tool}
                </option>
              ))}
            </Select>
          </div>

          <form onSubmit={handleLookupSubmit} className="flex items-end gap-2 lg:col-span-5">
            <div className="min-w-0 flex-1">
              <Input
                id="ws-evidence-lookup"
                type="text"
                label={isId ? "Cari ID bukti langsung" : "Direct evidence ID lookup"}
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                placeholder="ev_a1b2c3d4e5"
              />
            </div>
            <Button type="submit" variant="primary" size="md" className="shrink-0">
              <FileSearch className="h-4 w-4" aria-hidden="true" />
              <span>{isId ? "Periksa" : "Inspect"}</span>
            </Button>
          </form>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="group"
              aria-label="Filter by data mode"
              className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-background p-1"
            >
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={modeFilter === opt.value}
                  onClick={() => setModeFilter(opt.value)}
                  className={`min-h-7 cursor-pointer rounded-full px-3 font-mono text-[11px] font-semibold transition-colors ${
                    modeFilter === opt.value
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.value === "ALL" && isId ? "Semua mode" : opt.label}
                </button>
              ))}
            </div>

            <div
              role="group"
              aria-label="Filter by date range"
              className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-background p-1"
            >
              {DATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={dateFilter === opt.value}
                  onClick={() => setDateFilter(opt.value)}
                  className={`min-h-7 cursor-pointer rounded-full px-3 font-mono text-[11px] font-semibold transition-colors ${
                    dateFilter === opt.value
                      ? "bg-primary text-white shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.value === "all" && isId ? "Semua" : opt.label}
                </button>
              ))}
            </div>
          </div>

          {loadingList || listError ? (
            <p className="font-mono text-xs text-subtle-foreground">
              {listError
                ? isId
                  ? "Jumlah catatan tidak tersedia sampai daftar bukti dimuat."
                  : "Record counts are unavailable until the evidence list loads."
                : isId
                  ? "Memeriksa catatan bukti terbaru."
                  : "Checking recent evidence records."}
            </p>
          ) : (
            <p className="font-mono text-xs text-subtle-foreground">
              {isId ? "Menampilkan " : "Showing "}
              <strong className="text-foreground">{filteredRecords.length}</strong>{" "}
              {isId ? "dari " : "of "}
              <strong className="text-foreground">{records.length}</strong>{" "}
              {isId ? "catatan terbaru" : "recent records (up to 50 returned by list API)"}
            </p>
          )}
        </div>
      </Card>

      {listError ? (
        <ErrorNotice
          status={listError.status}
          message={listError.message}
          onRetry={() => void loadList(true)}
        />
      ) : null}

      {/* Evidence List */}
      {loadingList ? (
        <Card className="space-y-3 p-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </Card>
      ) : !listError && filteredRecords.length === 0 ? (
        <EmptyState
          icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />}
          title={
            records.length === 0
              ? isId
                ? "Belum ada catatan bukti"
                : "No evidence records yet"
              : isId
                ? "Tidak ada bukti yang cocok dengan filter"
                : "No evidence matches your filters"
          }
          description={
            records.length === 0
              ? isId
                ? "Jalankan analisis di workspace atau melalui CoinTrac MCP untuk membuat catatan bukti."
                : "Run any Market Intelligence tool in the workspace or via CoinTrac MCP to generate a tenant-scoped evidence record."
              : isId
                ? "Ubah kata kunci pencarian, alat, mode data, atau rentang waktu."
                : "Adjust your search query, tool selection, data mode, or time window."
          }
          action={
            hasActiveFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setToolFilter("ALL");
                  setModeFilter("ALL");
                  setDateFilter("all");
                }}
              >
                {isId ? "Reset filter" : "Reset filters"}
              </Button>
            ) : undefined
          }
        />
      ) : filteredRecords.length > 0 ? (
        <>
          {/* Desktop Table */}
          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    <th className="px-4 py-3">{isId ? "ID Bukti" : "Evidence ID"}</th>
                    <th className="px-4 py-3">{isId ? "Alat" : "Tool"}</th>
                    <th className="px-4 py-3">{isId ? "Aset (CMC ID)" : "Assets (CMC ID)"}</th>
                    <th className="px-4 py-3">{isId ? "Mode data" : "Data mode"}</th>
                    <th className="px-4 py-3">{isId ? "Kesegaran" : "Freshness"}</th>
                    <th className="px-4 py-3 text-right">{isId ? "Kredit CMC" : "CMC credits"}</th>
                    <th className="px-4 py-3 text-right">{isId ? "Diambil (UTC)" : "Collected (UTC)"}</th>
                    <th className="w-8 px-2 py-3">
                      <span className="sr-only">Inspect</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono tabular-nums">
                  {filteredRecords.map((row) => {
                    const isSelected = drawerOpen && selected?.evidence_id === row.evidence_id;
                    const ids = row.asset_cmc_ids ?? [];
                    return (
                      <tr
                        key={row.evidence_id}
                        tabIndex={0}
                        onClick={() => void openDetail(row)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void openDetail(row);
                          }
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold text-link">{row.evidence_id}</td>
                        <td className="px-4 py-3 text-foreground">{row.tool_name}</td>
                        <td className="max-w-[160px] truncate px-4 py-3 text-muted-foreground">
                          {ids.length > 0 ? ids.join(", ") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <DataModeBadge mode={row.data_mode} />
                        </td>
                        <td className="px-4 py-3">
                          <FreshnessBadge freshness={row.freshness} />
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">{row.credit_cost}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {formatUtc(row.created_at)}
                        </td>
                        <td className="px-2 py-3 text-right text-subtle-foreground">
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile Card List */}
          <div className="space-y-3 md:hidden">
            {filteredRecords.map((row) => (
              <button
                key={row.evidence_id}
                type="button"
                onClick={() => void openDetail(row)}
                className="flex w-full cursor-pointer flex-col gap-2.5 rounded-[14px] border border-border bg-card p-4 text-left transition-colors hover:border-border-strong hover:bg-card-elevated"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-link">
                    {row.evidence_id}
                  </span>
                  <span className="font-mono text-xs text-foreground">{row.tool_name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <DataModeBadge mode={row.data_mode} />
                  <FreshnessBadge freshness={row.freshness} />
                </div>
                <p className="font-mono text-[11px] text-subtle-foreground">
                  {formatUtc(row.created_at)} · {row.credit_cost} CMC credit
                  {row.credit_cost === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {/* Accessible Evidence Detail Drawer */}
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/65"
          onClick={() => setDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="CoinTrac evidence details"
        >
          <div
            ref={drawerRef}
            className="flex h-full w-full max-w-2xl flex-col border-l border-border-strong bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  CoinTrac Evidence Provenance
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-mono text-base font-semibold text-foreground">
                    {selected?.evidence_id ?? (lookupId || "Loading...")}
                  </h2>
                  {selected ? (
                    <>
                      <CopyButton text={selected.evidence_id} label="Copy ID" />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleCopyRawJson()}
                      >
                        {copiedJson ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                            <span>JSON copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Copy JSON</span>
                          </>
                        )}
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close evidence drawer"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {loadingDetail && !selected ? (
                <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-link" aria-hidden="true" />
                  <span>Loading evidence record...</span>
                </div>
              ) : null}

              {detailError ? (
                <ErrorNotice status={detailError.status} message={detailError.message} />
              ) : null}

              {selected ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{selected.tool_name}</Badge>
                    <DataModeBadge mode={selected.data_mode} />
                    <FreshnessBadge freshness={selected.freshness} />
                    <Badge tone="neutral">{selected.engine_version || "Not provided"}</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                        Collected (UTC)
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold text-foreground">
                        {formatUtc(selected.created_at)}
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                        CMC credit cost
                      </p>
                      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {selected.credit_cost}
                      </p>
                    </div>
                    <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                      <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                        Canonical CMC IDs
                      </p>
                      <p className="mt-1 truncate font-mono text-xs font-semibold text-foreground">
                        {selected.asset_cmc_ids && selected.asset_cmc_ids.length > 0
                          ? selected.asset_cmc_ids.join(", ")
                          : "Not provided"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                      Upstream source endpoints called
                    </p>
                    {(selected.endpoints_called ?? []).length === 0 ? (
                      <p className="font-mono text-xs text-muted-foreground">Not provided</p>
                    ) : (
                      <ul className="space-y-1.5 font-mono text-xs">
                        {(selected.endpoints_called ?? []).map((ep) => (
                          <li
                            key={ep}
                            className="break-all rounded-[8px] border border-border bg-background/60 px-3 py-2 text-foreground"
                          >
                            {ep}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {selected.limitations && selected.limitations.length > 0 ? (
                    <div className="rounded-[10px] border border-warning/40 bg-warning-soft p-4">
                      <p className="font-mono text-[11px] font-semibold uppercase text-warning">
                        Recorded limitations
                      </p>
                      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-foreground">
                        {selected.limitations.map((item, idx) => (
                          <li key={`${idx}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                      Methodology metadata
                    </p>
                    {selected.methodology ? (
                      <JsonViewer
                        title="methodology"
                        value={selected.methodology}
                        maxHeightClass="max-h-48"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {loadingDetail ? "Loading methodology..." : "Not provided for this record."}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                      Sanitized response excerpt
                    </p>
                    {loadingDetail && selected.raw_excerpt === undefined ? (
                      <div className="flex items-center gap-2 rounded-[10px] border border-border bg-background/60 p-4 font-mono text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-link" aria-hidden="true" />
                        <span>Loading full evidence payload...</span>
                      </div>
                    ) : selected.raw_excerpt ? (
                      <JsonViewer
                        title="raw_excerpt (credentials stripped)"
                        value={selected.raw_excerpt}
                        maxHeightClass="max-h-80"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No raw excerpt payload was stored for this record.
                      </p>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
