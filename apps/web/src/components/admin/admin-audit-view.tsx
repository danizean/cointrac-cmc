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
import type { AIUsageLogItem, PlatformRequestLogItem } from "@/lib/control-plane-api";
import { useAdminData } from "./admin-context";
import { AdminAccessBarrier } from "./admin-guard";

type LogStreamTab = "api" | "ai";
type LogStatusFilter = "ALL" | "OK" | "CACHED" | "RATE_LIMITED" | "ERROR";
type SurfaceFilter = "ALL" | "mcp" | "rest" | "playground" | "ERROR";

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

  const [streamTab, setStreamTab] = useState<LogStreamTab>("api");
  const [statusFilter, setStatusFilter] = useState<LogStatusFilter>("ALL");
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("ALL");
  const [query, setQuery] = useState("");
  const [selectedLog, setSelectedLog] = useState<AIUsageLogItem | null>(null);
  const [selectedApiLog, setSelectedApiLog] = useState<PlatformRequestLogItem | null>(null);

  useEffect(() => {
    if (!selectedLog && !selectedApiLog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedLog(null);
        setSelectedApiLog(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedApiLog, selectedLog]);

  const logs = useMemo(() => data?.recent_logs ?? [], [data?.recent_logs]);
  const apiLogs = useMemo(() => data?.recent_api_logs ?? [], [data?.recent_api_logs]);

  const statusCounts = useMemo(() => {
    return {
      ALL: logs.length,
      OK: logs.filter((l) => l.status === "OK").length,
      CACHED: logs.filter((l) => l.status === "CACHED").length,
      RATE_LIMITED: logs.filter((l) => l.status === "RATE_LIMITED").length,
      ERROR: logs.filter((l) => l.status === "ERROR").length,
    };
  }, [logs]);

  const surfaceCounts = useMemo(() => {
    return {
      ALL: apiLogs.length,
      mcp: apiLogs.filter((l) => l.surface === "mcp").length,
      rest: apiLogs.filter((l) => l.surface === "rest").length,
      playground: apiLogs.filter((l) => l.surface === "playground").length,
      ERROR: apiLogs.filter((l) => l.status_code >= 400).length,
    };
  }, [apiLogs]);

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

  const filteredApiLogs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apiLogs.filter((l) => {
      if (surfaceFilter === "ERROR" && l.status_code < 400) return false;
      if (surfaceFilter !== "ALL" && surfaceFilter !== "ERROR" && l.surface !== surfaceFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        l.user_email ?? "",
        l.user_id,
        l.tool_name,
        l.surface,
        l.auth_mode,
        l.evidence_id ?? "",
        String(l.status_code),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [apiLogs, query, surfaceFilter]);

  const title = isId ? "Log Audit & Telemetri" : "Audit & Telemetry Logs";
  const description = isId
    ? "Inspeksi real-time lalu lintas Remote MCP / Custom GPT OAuth, REST API, serta eksekusi CoinTrac AI (100 terbaru per stream)."
    : "Live inspector for the latest 100 Remote MCP / Custom GPT OAuth, REST API, and CoinTrac AI executions.";

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

      {/* Stream Switcher: Remote MCP / REST vs CoinTrac AI */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={isId ? "Sumber telemetri" : "Telemetry stream"}>
        <button
          type="button"
          role="tab"
          aria-selected={streamTab === "api"}
          onClick={() => setStreamTab("api")}
          className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-4 font-mono text-xs font-semibold transition-colors ${
            streamTab === "api"
              ? "border-primary/50 bg-primary/14 text-link"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <span>{isId ? "Remote MCP & REST API" : "Remote MCP & REST API"}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground">
            {apiLogs.length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={streamTab === "ai"}
          onClick={() => setStreamTab("ai")}
          className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border px-4 font-mono text-xs font-semibold transition-colors ${
            streamTab === "ai"
              ? "border-primary/50 bg-primary/14 text-link"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          <span>{isId ? "CoinTrac AI (Muse Spark)" : "CoinTrac AI (Muse Spark)"}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground">
            {logs.length}
          </span>
        </button>
      </div>

      {/* Filter & Search Toolbar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {streamTab === "api" ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={isId ? "Filter surface API" : "API surface filters"}>
              {(
                [
                  { id: "ALL", label: "ALL" },
                  { id: "mcp", label: "MCP" },
                  { id: "rest", label: "REST" },
                  { id: "playground", label: "PLAYGROUND" },
                  { id: "ERROR", label: "ERRORS" },
                ] as const
              ).map((item) => {
                const active = surfaceFilter === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSurfaceFilter(item.id)}
                    className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-medium transition-colors ${
                      active
                        ? "border-primary/45 bg-primary/14 font-semibold text-link"
                        : "border-border bg-background/70 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                      {surfaceCounts[item.id]}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
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
          )}

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
                streamTab === "api"
                  ? isId
                    ? "Cari email, tool, oauth/api_key, atau evidence ID..."
                    : "Search email, tool, oauth/api_key, or evidence ID..."
                  : isId
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
        {streamTab === "api" ? (
          filteredApiLogs.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Activity className="mx-auto h-7 w-7 text-subtle-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-semibold text-foreground">
                {isId ? "Tidak ada log MCP/REST yang cocok" : "No matching MCP/REST records"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isId
                  ? "Ubah filter surface atau bersihkan kata kunci pencarian."
                  : "Change the surface filter or clear your search query."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/35 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    <th className="px-4 py-3">{isId ? "Waktu" : "Time"}</th>
                    <th className="px-4 py-3">{isId ? "Pengguna" : "User"}</th>
                    <th className="px-4 py-3">Surface / Auth</th>
                    <th className="px-4 py-3">Tool</th>
                    <th className="px-4 py-3">HTTP</th>
                    <th className="px-4 py-3 text-right">{isId ? "Kredit" : "Credits"}</th>
                    <th className="px-4 py-3 text-right">{isId ? "Latensi" : "Latency"}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono tabular-nums">
                  {filteredApiLogs.map((log) => (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedApiLog(log)}
                      className={`cursor-pointer transition-colors ${
                        selectedApiLog?.id === log.id ? "bg-primary/10" : "hover:bg-muted/40"
                      }`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-[11px] text-muted-foreground">
                        {formatTimestamp(log.created_at, locale)}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-foreground">
                        {log.user_email ?? (log.user_id ? log.user_id.slice(0, 10) : "—")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={log.surface === "mcp" ? "brand" : "neutral"}>
                            {log.surface.toUpperCase()}
                          </Badge>
                          <Badge tone={log.auth_mode === "oauth" ? "info" : "neutral"}>
                            {log.auth_mode === "oauth"
                              ? "OAuth"
                              : log.auth_mode === "api_key"
                                ? "API Key"
                                : "Session"}
                          </Badge>
                        </div>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-foreground">
                        {log.tool_name}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={log.status_code < 400 ? "positive" : "destructive"}>
                            {log.status_code}
                          </Badge>
                          {log.cache_hit ? <Badge tone="info">CACHE</Badge> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-foreground">
                        {log.credit_cost}
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
          )
        ) : filteredLogs.length === 0 ? (
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

      {/* Slide-over MCP/REST Detail Drawer */}
      {selectedApiLog ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[1px]"
          onClick={() => setSelectedApiLog(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={isId ? "Detail Log MCP & REST" : "MCP & REST Request Detail"}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={selectedApiLog.surface === "mcp" ? "brand" : "neutral"}>
                    {selectedApiLog.surface.toUpperCase()}
                  </Badge>
                  <Badge tone={selectedApiLog.auth_mode === "oauth" ? "info" : "neutral"}>
                    {selectedApiLog.auth_mode === "oauth"
                      ? "OAuth Bearer"
                      : selectedApiLog.auth_mode === "api_key"
                        ? "API Key"
                        : "Session"}
                  </Badge>
                  <Badge tone={selectedApiLog.status_code < 400 ? "positive" : "destructive"}>
                    HTTP {selectedApiLog.status_code}
                  </Badge>
                </div>
                <p className="truncate font-mono text-sm font-semibold text-foreground">
                  {selectedApiLog.user_email ?? selectedApiLog.user_id}
                </p>
                <p className="flex items-center gap-1.5 font-mono text-[11px] text-subtle-foreground">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  <span>{selectedApiLog.created_at}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedApiLog(null)}
                aria-label={isId ? "Tutup detail" : "Close detail"}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 font-mono">
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="text-[10px] uppercase tracking-wider text-subtle-foreground">Tool / Endpoint</p>
                <p className="mt-1 text-xs font-semibold text-foreground">{selectedApiLog.tool_name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">{isId ? "Kredit CMC" : "CMC Credits"}</p>
                  <p className="mt-1 text-xs font-semibold text-link">{selectedApiLog.credit_cost}</p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">{isId ? "Latensi" : "Latency"}</p>
                  <p className="mt-1 text-xs font-semibold text-foreground">{selectedApiLog.latency_ms} ms</p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">Cache Hit</p>
                  <p className="mt-1 text-xs font-semibold text-foreground">
                    {selectedApiLog.cache_hit ? "YES" : "NO"}
                  </p>
                </div>
                <div className="rounded-[10px] border border-border bg-background/60 p-3">
                  <p className="text-[10px] text-muted-foreground">API Key ID</p>
                  <p className="mt-1 truncate text-xs font-semibold text-foreground">
                    {selectedApiLog.api_key_id ?? "— (OAuth)"}
                  </p>
                </div>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="text-[10px] uppercase tracking-wider text-subtle-foreground">Evidence ID</p>
                <p className="mt-1 break-all text-xs text-foreground">
                  {selectedApiLog.evidence_id ?? "—"}
                </p>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

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
