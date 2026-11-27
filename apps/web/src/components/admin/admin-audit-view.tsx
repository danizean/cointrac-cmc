"use client";

import {
  Activity,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Badge, Button, Card, ErrorNotice, PageHeader } from "@/components/ui/primitives";
import type { AIUsageLogItem } from "@/lib/control-plane-api";
import { useAdminData } from "./admin-context";
import { AdminAccessBarrier } from "./admin-guard";

type LogStatusFilter = "ALL" | "OK" | "CACHED" | "RATE_LIMITED" | "ERROR";

function formatTimestamp(iso: string, locale: "en" | "id"): string {
  try {
    return new Date(iso).toLocaleString(locale === "id" ? "id-ID" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusTone(status: string): "positive" | "info" | "warning" | "destructive" | "neutral" {
  if (status === "OK") return "positive";
  if (status === "CACHED") return "info";
  if (status === "RATE_LIMITED") return "warning";
  if (status === "ERROR") return "destructive";
  return "neutral";
}

export function AdminAuditView() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { data, loading, refreshing, error, refresh } = useAdminData();

  const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<AIUsageLogItem | null>(null);

  useEffect(() => {
    if (!selectedLog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedLog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLog]);

  const logs = useMemo(() => data?.recent_logs ?? [], [data?.recent_logs]);

  const statusCounts = useMemo(() => {
    return {
      ALL: logs.length,
      OK: logs.filter((l) => l.status === "OK").length,
      CACHED: logs.filter((l) => l.status === "CACHED").length,
      RATE_LIMITED: logs.filter((l) => l.status === "RATE_LIMITED").length,
      ERROR: logs.filter((l) => l.status === "ERROR").length,
    };
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (statusFilter !== "ALL" && l.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        l.user_email ?? "",
        l.user_id,
        l.prompt_summary,
        l.status,
        l.error_code ?? "",
        ...l.tools_called,
        ...l.evidence_ids,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, query, statusFilter]);

  const title = isId ? "Log Audit & Telemetri" : "Audit & Telemetry Logs";
  const description = isId
    ? "Inspeksi lengkap 100 aktivitas terbaru CoinTrac AI: pemanggilan tool, evidence ID, konsumsi token, latensi, dan blokir limit."
    : "Full inspector for the latest 100 CoinTrac AI executions: tool provenance, evidence IDs, token burn, latency, and rate-limit events.";

  if ((loading && !data) || (error && !data)) {
    return <AdminAccessBarrier title={title} description={description} />;
  }
  if (!data) return null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button variant="primary" size="md" loading={refreshing} onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />

      {error ? (
        <ErrorNotice status={error.status} message={error.message} onRetry={() => void refresh()} />
      ) : null}

      {/* Filter & Search Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={isId ? "Filter status log" : "Log status filters"}>
            {(["ALL", "OK", "CACHED", "RATE_LIMITED", "ERROR"] as const).map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-medium transition-colors ${
                    active
                      ? "border-primary/45 bg-primary/14 font-semibold text-link"
                      : "border-border bg-background/70 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{status}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                    {statusCounts[status]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isId
                  ? "Cari email, prompt, tool, atau evidence ID..."
                  : "Search email, prompt, tool, or evidence ID..."
              }
              aria-label={isId ? "Cari log audit" : "Search audit logs"}
              className="min-h-10 w-full rounded-[10px] border border-border bg-input-bg py-2 pr-3 pl-9 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Audit Log Table */}
      <Card className="overflow-hidden">
        {filteredLogs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Activity className="mx-auto h-7 w-7 text-subtle-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-foreground">
              {isId ? "Tidak ada log yang cocok" : "No matching audit records"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isId
                ? "Ubah filter status atau bersihkan kata kunci pencarian."
                : "Change the status filter or clear your search query."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/35 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  <th className="px-4 py-3">{isId ? "Waktu" : "Time"}</th>
                  <th className="px-4 py-3">{isId ? "Pengguna" : "User"}</th>
                  <th className="px-4 py-3">Prompt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Tools</th>
                  <th className="px-4 py-3 text-right">Tokens</th>
                  <th className="px-4 py-3 text-right">{isId ? "Latensi" : "Latency"}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono tabular-nums">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className={`cursor-pointer transition-colors ${
                      selectedLog?.id === log.id ? "bg-primary/10" : "hover:bg-muted/40"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[11px] text-muted-foreground">
                      {formatTimestamp(log.created_at, locale)}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3 text-foreground">
                      {log.user_email ?? log.user_id.slice(0, 10)}
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-3 font-sans text-foreground">
                      {log.prompt_summary || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(log.status)}>{log.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {log.tools_called.length > 0 ? `${log.tools_called.length} tools` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      {log.total_tokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {log.latency_ms} ms
                    </td>
                    <td className="px-4 py-3 text-right text-subtle-foreground">
                      <ChevronRight className="inline h-3.5 w-3.5" aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Slide-over Audit Detail Drawer */}
      {selectedLog ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[1px]"
          onClick={() => setSelectedLog(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={isId ? "Detail Log Audit AI" : "AI Audit Log Detail"}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(selectedLog.status)}>{selectedLog.status}</Badge>
                  {selectedLog.cache_hit ? <Badge tone="info">CACHE HIT</Badge> : null}
                </div>
                <p className="truncate font-mono text-sm font-semibold text-foreground">
                  {selectedLog.user_email ?? selectedLog.user_id}
                </p>
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-subtle-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{selectedLog.created_at}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                aria-label={isId ? "Tutup detail" : "Close detail"}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Ringkasan Prompt" : "Prompt Summary"}
                </p>
                <p className="mt-1.5 rounded-[12px] border border-border bg-background/60 p-3.5 text-xs leading-relaxed text-foreground">
                  {selectedLog.prompt_summary || "—"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">Model</p>
                  <p className="mt-1 truncate text-xs font-semibold text-foreground">
                    {selectedLog.model}
                  </p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">{isId ? "Latensi" : "Latency"}</p>
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {selectedLog.latency_ms} ms
                  </p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">Total Tokens</p>
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {selectedLog.total_tokens.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">{isId ? "Est. Biaya" : "Est. Cost"}</p>
                  <p className="mt-1 text-xs font-semibold text-link">
                    ${selectedLog.estimated_cost_usd.toFixed(6)}
                  </p>
                </div>
              </div>

              {selectedLog.error_code ? (
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-destructive">
                    Error Code
                  </p>
                  <p className="mt-1 rounded-[10px] border border-destructive/40 bg-destructive-soft/40 p-3 font-mono text-xs text-destructive">
                    {selectedLog.error_code}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isId ? "Tool Intelligence Dipanggil" : "Tools Invoked"}</span>
                </p>
                {selectedLog.tools_called.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {isId ? "Tidak ada tool dipanggil." : "No tools called."}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedLog.tools_called.map((tool, i) => (
                      <Badge key={`${tool}-${i}`} tone="brand">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Evidence IDs ({selectedLog.evidence_ids.length})
                </p>
                {selectedLog.evidence_ids.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">—</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 font-mono text-[11px]">
                    {selectedLog.evidence_ids.map((eid) => (
                      <li
                        key={eid}
                        className="rounded-[8px] border border-border bg-background/60 px-3 py-2 text-foreground"
                      >
                        {eid}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
