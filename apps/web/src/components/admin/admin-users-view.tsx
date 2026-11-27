"use client";

import {
  Check,
  Copy,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { Badge, Button, Card, ErrorNotice, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  resetAdminUserLimits,
  updateAdminUserLimits,
  updateAdminUserRole,
  type AdminAIUserRow,
} from "@/lib/control-plane-api";
import { useAdminData } from "./admin-context";
import { AdminAccessBarrier } from "./admin-guard";

type SegmentFilter = "all" | "admins" | "paused" | "custom" | "active_today";

interface UserDraft {
  ai_enabled: boolean;
  rate_limit_per_min: string;
  daily_requests_limit: string;
  daily_tokens_limit: string;
  notes: string;
}

const INPUT =
  "mt-1 min-h-10 w-full rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

function toIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function hasCustomPolicy(u: AdminAIUserRow): boolean {
  return (
    !u.ai_enabled ||
    u.rate_limit_per_min !== null ||
    u.daily_requests_limit !== null ||
    u.daily_tokens_limit !== null ||
    Boolean(u.notes)
  );
}

function buildDraftFromUser(u: AdminAIUserRow): UserDraft {
  return {
    ai_enabled: u.ai_enabled,
    rate_limit_per_min: u.rate_limit_per_min !== null ? String(u.rate_limit_per_min) : "",
    daily_requests_limit:
      u.daily_requests_limit !== null ? String(u.daily_requests_limit) : "",
    daily_tokens_limit: u.daily_tokens_limit !== null ? String(u.daily_tokens_limit) : "",
    notes: u.notes ?? "",
  };
}

export function AdminUsersView() {
  const searchParams = useSearchParams();
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();
  const { data, loading, refreshing, error, refresh } = useAdminData();

  const [query, setQuery] = useState(() => searchParams.get("search") ?? "");
  const [segment, setSegment] = useState<SegmentFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "reset" | "role" | null>(null);
  const [confirmRoleChange, setConfirmRoleChange] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  const selectedUser = useMemo(
    () => (data?.users ?? []).find((u) => u.user_id === selectedUserId) ?? null,
    [data?.users, selectedUserId],
  );

  useEffect(() => {
    if (!selectedUserId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedUserId(null);
        setDraft(null);
        setConfirmRoleChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedUserId]);

  const segmentCounts = useMemo(() => {
    const list = data?.users ?? [];
    return {
      all: list.length,
      admins: list.filter((u) => u.platform_role === "super_admin").length,
      paused: list.filter((u) => !u.ai_enabled).length,
      custom: list.filter((u) => hasCustomPolicy(u)).length,
      active_today: list.filter((u) => u.used_today_requests > 0).length,
    };
  }, [data?.users]);

  const filteredUsers = useMemo(() => {
    const list = data?.users ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((u) => {
      if (segment === "admins" && u.platform_role !== "super_admin") return false;
      if (segment === "paused" && u.ai_enabled) return false;
      if (segment === "custom" && !hasCustomPolicy(u)) return false;
      if (segment === "active_today" && u.used_today_requests === 0) return false;
      if (!q) return true;
      return (
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q) ||
        u.user_id.toLowerCase().includes(q)
      );
    });
  }, [data?.users, query, segment]);

  const title = isId ? "Pengguna & Kuota AI" : "Users & Quotas";
  const description = isId
    ? "Inspeksi direktori akun, pantau pemakaian kuota harian, terapkan preset rate limit per pengguna, dan kelola hak Super Admin."
    : "Browse registered accounts, inspect daily quota burn, override per-user rate limits, and manage Super Admin roles.";

  if ((loading && !data) || (error && !data)) {
    return <AdminAccessBarrier title={title} description={description} />;
  }
  if (!data) return null;

  const { config } = data;

  function openInspector(user: AdminAIUserRow) {
    setSelectedUserId(user.user_id);
    setDraft(buildDraftFromUser(user));
    setConfirmRoleChange(false);
    setCopiedUid(false);
  }

  function closeInspector() {
    setSelectedUserId(null);
    setDraft(null);
    setConfirmRoleChange(false);
  }

  async function handleSaveLimits() {
    if (!selectedUser || !draft) return;
    setBusyAction("save");
    const res = await updateAdminUserLimits(selectedUser.user_id, {
      ai_enabled: draft.ai_enabled,
      rate_limit_per_min: toIntOrNull(draft.rate_limit_per_min),
      daily_requests_limit: toIntOrNull(draft.daily_requests_limit),
      daily_tokens_limit: toIntOrNull(draft.daily_tokens_limit),
      notes: draft.notes.trim() || null,
    });
    setBusyAction(null);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    pushToast(
      isId
        ? `Kebijakan AI untuk ${selectedUser.email ?? selectedUser.user_id} disimpan.`
        : "User quota policy saved.",
      "success",
    );
    await refresh();
  }

  async function handleResetLimits() {
    if (!selectedUser) return;
    setBusyAction("reset");
    const res = await resetAdminUserLimits(selectedUser.user_id);
    setBusyAction(null);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    setDraft({
      ai_enabled: true,
      rate_limit_per_min: "",
      daily_requests_limit: "",
      daily_tokens_limit: "",
      notes: "",
    });
    pushToast(isId ? "Limit user dikembalikan ke default global." : "User policy reset to global defaults.", "info");
    await refresh();
  }

  async function handleConfirmedRoleToggle() {
    if (!selectedUser) return;
    const nextRole = selectedUser.platform_role === "super_admin" ? "user" : "super_admin";
    setBusyAction("role");
    const res = await updateAdminUserRole(selectedUser.user_id, nextRole);
    setBusyAction(null);
    setConfirmRoleChange(false);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    pushToast(
      isId ? `Role diperbarui ke ${nextRole}.` : `Platform role updated to ${nextRole}.`,
      "success",
    );
    await refresh();
  }

  async function handleCopyUid(uid: string) {
    try {
      await navigator.clipboard.writeText(uid);
      setCopiedUid(true);
      window.setTimeout(() => setCopiedUid(false), 1800);
    } catch {
      // Ignore clipboard error in restricted context
    }
  }

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
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={isId ? "Filter pengguna" : "User filters"}>
            {(
              [
                { id: "all", labelEn: "All", labelId: "Semua" },
                { id: "admins", labelEn: "Super Admins", labelId: "Super Admin" },
                { id: "active_today", labelEn: "Active Today", labelId: "Aktif Hari Ini" },
                { id: "custom", labelEn: "Custom Limits", labelId: "Limit Kustom" },
                { id: "paused", labelEn: "AI Paused", labelId: "AI Dijeda" },
              ] as const
            ).map((item) => {
              const active = segment === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSegment(item.id)}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-mono text-xs font-medium transition-colors ${
                    active
                      ? "border-primary/45 bg-primary/14 font-semibold text-link"
                      : "border-border bg-background/70 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>{isId ? item.labelId : item.labelEn}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                    {segmentCounts[item.id]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:max-w-xs">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isId ? "Cari email, nama, atau UUID..." : "Search email, name, or UUID..."}
              aria-label={isId ? "Cari pengguna" : "Search users"}
              className="min-h-10 w-full rounded-[10px] border border-border bg-input-bg py-2 pr-3 pl-9 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Enterprise Accounts Table */}
      <Card className="overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-foreground">
              {isId ? "Tidak ada pengguna yang cocok" : "No matching accounts"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isId
                ? "Ubah filter segmen atau bersihkan kata kunci pencarian."
                : "Adjust the segment filter or clear the search query."}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/35 font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    <th className="px-4 py-3">{isId ? "Akun" : "Account"}</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">{isId ? "Status AI" : "AI Access"}</th>
                    <th className="px-4 py-3">{isId ? "Pemakaian Hari Ini" : "Today Usage"}</th>
                    <th className="px-4 py-3">{isId ? "Kebijakan Limit" : "Rate Policy"}</th>
                    <th className="px-4 py-3 text-right">{isId ? "Est. 30h" : "30d Spend"}</th>
                    <th className="px-4 py-3 text-right">{isId ? "Aksi" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredUsers.map((u) => {
                    const reqLimit = Math.max(1, u.effective_daily_requests_limit);
                    const reqPct = Math.min(100, Math.round((u.used_today_requests / reqLimit) * 100));
                    const custom = hasCustomPolicy(u);
                    const isSelected = selectedUserId === u.user_id;

                    return (
                      <tr
                        key={u.user_id}
                        onClick={() => openInspector(u)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? "bg-primary/10" : "hover:bg-muted/40"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold text-foreground">
                              {u.email ?? u.user_id}
                            </p>
                            <p className="truncate text-[11px] text-subtle-foreground">
                              {u.display_name || `${u.user_id.slice(0, 8)}...`} · {u.base_plan_code}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={u.platform_role === "super_admin" ? "brand" : "neutral"}>
                            {u.platform_role === "super_admin" ? "super_admin" : "user"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={u.ai_enabled ? "positive" : "destructive"}>
                            {u.ai_enabled ? (isId ? "Aktif" : "Active") : isId ? "Dijeda" : "Paused"}
                          </Badge>
                        </td>
                        <td className="min-w-[170px] px-4 py-3 font-mono tabular-nums">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-foreground">
                              {u.used_today_requests} / {u.effective_daily_requests_limit} req
                            </span>
                            <span className="text-subtle-foreground">{reqPct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${
                                reqPct >= 90 ? "bg-warning" : "bg-primary"
                              }`}
                              style={{ width: `${reqPct}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] text-subtle-foreground">
                            {u.used_today_tokens.toLocaleString()} /{" "}
                            {u.effective_daily_tokens_limit.toLocaleString()} tok
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          <div className="flex items-center gap-1.5">
                            <Badge tone={custom ? "info" : "neutral"}>
                              {custom ? (isId ? "Kustom" : "Custom") : "Default"}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {u.effective_rate_limit_per_min}/m
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                          ${u.estimated_cost_30d_usd.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openInspector(u);
                            }}
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{isId ? "Kelola" : "Manage"}</span>
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="divide-y divide-border md:hidden">
              {filteredUsers.map((u) => (
                <button
                  key={u.user_id}
                  type="button"
                  onClick={() => openInspector(u)}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left hover:bg-muted/40"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-xs font-semibold text-foreground">
                        {u.email ?? u.user_id.slice(0, 12)}
                      </span>
                      <Badge tone={u.platform_role === "super_admin" ? "brand" : "neutral"}>
                        {u.platform_role}
                      </Badge>
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {u.used_today_requests}/{u.effective_daily_requests_limit} req ·{" "}
                      {u.effective_rate_limit_per_min}/m · ${u.estimated_cost_30d_usd.toFixed(4)}
                    </p>
                  </div>
                  <Badge tone={u.ai_enabled ? "positive" : "destructive"}>
                    {u.ai_enabled ? "ON" : "OFF"}
                  </Badge>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Right Slide-over Inspector Drawer */}
      {selectedUser && draft ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[1px]"
          onClick={closeInspector}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={isId ? "Inspektor Kuota Pengguna" : "User Quota Inspector"}
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={selectedUser.platform_role === "super_admin" ? "brand" : "neutral"}>
                    {selectedUser.platform_role}
                  </Badge>
                  <Badge tone={draft.ai_enabled ? "positive" : "destructive"}>
                    {draft.ai_enabled ? (isId ? "AI Aktif" : "AI Enabled") : isId ? "AI Dijeda" : "AI Paused"}
                  </Badge>
                </div>
                <h2 className="truncate font-mono text-sm font-semibold text-foreground">
                  {selectedUser.email ?? selectedUser.user_id}
                </h2>
                <button
                  type="button"
                  onClick={() => void handleCopyUid(selectedUser.user_id)}
                  className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-subtle-foreground hover:text-foreground"
                >
                  <span>ID: {selectedUser.user_id.slice(0, 14)}...</span>
                  {copiedUid ? (
                    <Check className="h-3 w-3 text-positive" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={closeInspector}
                aria-label={isId ? "Tutup panel" : "Close inspector"}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {/* Live Consumption Snapshot */}
              <div className="rounded-[12px] border border-border bg-background/60 p-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Konsumsi Tercatat" : "Observed Usage"}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 font-mono">
                  <div>
                    <p className="text-[10px] text-muted-foreground">{isId ? "Hari Ini" : "Today"}</p>
                    <p className="text-xs font-semibold text-foreground">
                      {selectedUser.used_today_requests}/{selectedUser.effective_daily_requests_limit}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Token 30d</p>
                    <p className="text-xs font-semibold text-foreground">
                      {selectedUser.used_30d_tokens.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">{isId ? "Biaya 30h" : "30d Cost"}</p>
                    <p className="text-xs font-semibold text-link">
                      ${selectedUser.estimated_cost_30d_usd.toFixed(4)}
                    </p>
                  </div>
                </div>
              </div>

              {/* 1-Click Presets */}
              <div className="space-y-2">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Preset Kebijakan Cepat" : "Quick Policy Presets"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: "Free Safe (10/m · 50/d)",
                      apply: {
                        ai_enabled: true,
                        rate_limit_per_min: "10",
                        daily_requests_limit: "50",
                        daily_tokens_limit: "150000",
                      },
                    },
                    {
                      label: "Pro Analyst (20/m · 200/d)",
                      apply: {
                        ai_enabled: true,
                        rate_limit_per_min: "20",
                        daily_requests_limit: "200",
                        daily_tokens_limit: "500000",
                      },
                    },
                    {
                      label: "Power Desk (40/m · 500/d)",
                      apply: {
                        ai_enabled: true,
                        rate_limit_per_min: "40",
                        daily_requests_limit: "500",
                        daily_tokens_limit: "1500000",
                      },
                    },
                    {
                      label: isId ? "Jeda Akses AI" : "Suspend AI",
                      apply: { ai_enabled: false },
                    },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setDraft((prev) => (prev ? { ...prev, ...preset.apply } : prev))}
                      className="cursor-pointer rounded-[10px] border border-border bg-background/70 px-3 py-2 text-left font-mono text-[11px] font-medium text-foreground transition-colors hover:border-primary/45 hover:bg-primary/10"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Access Toggle */}
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[12px] border border-border bg-background/60 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {isId ? "Izinkan Akses CoinTrac AI" : "Allow CoinTrac AI Access"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isId
                      ? "Matikan untuk menghentikan seluruh permintaan AI akun ini."
                      : "Disable to immediately block AI calls for this account."}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.ai_enabled}
                  onChange={(e) => setDraft({ ...draft, ai_enabled: e.target.checked })}
                  className="h-4 w-4 accent-primary"
                />
              </label>

              {/* Numeric Quota Inputs */}
              <div className="space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  {isId ? "Rate Limit per Menit (kosong = default global)" : "Requests / Min (blank = global default)"}
                  <input
                    type="number"
                    min={1}
                    max={240}
                    placeholder={String(config.default_rate_limit_per_min)}
                    className={INPUT}
                    value={draft.rate_limit_per_min}
                    onChange={(e) => setDraft({ ...draft, rate_limit_per_min: e.target.value })}
                  />
                </label>

                <label className="block text-xs font-medium text-muted-foreground">
                  {isId ? "Kuota Permintaan Harian" : "Daily Requests Limit"}
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    placeholder={String(config.default_daily_requests)}
                    className={INPUT}
                    value={draft.daily_requests_limit}
                    onChange={(e) => setDraft({ ...draft, daily_requests_limit: e.target.value })}
                  />
                </label>

                <label className="block text-xs font-medium text-muted-foreground">
                  {isId ? "Kuota Token Harian" : "Daily Tokens Limit"}
                  <input
                    type="number"
                    min={1000}
                    max={10000000}
                    placeholder={String(config.default_daily_tokens)}
                    className={INPUT}
                    value={draft.daily_tokens_limit}
                    onChange={(e) => setDraft({ ...draft, daily_tokens_limit: e.target.value })}
                  />
                </label>

                <label className="block text-xs font-medium text-muted-foreground">
                  {isId ? "Catatan Internal Admin" : "Admin Note"}
                  <input
                    className={INPUT}
                    value={draft.notes}
                    placeholder={isId ? "Misal: Paket VIP hackathon..." : "e.g. Institutional pilot account..."}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  />
                </label>
              </div>

              {/* Role Governance (Safe 2-step confirmation) */}
              <div className="space-y-2 rounded-[12px] border border-border bg-background/60 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {isId ? "Hak Akses Platform" : "Platform Role Governance"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedUser.platform_role === "super_admin"
                        ? isId
                          ? "Akun ini memiliki akses penuh ke Console Super Admin."
                          : "This account has full Super Admin privileges."
                        : isId
                          ? "Akun standar hanya mengakses workspace trading & API user."
                          : "Standard user account without Super Admin access."}
                    </p>
                  </div>
                </div>

                {!confirmRoleChange ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => setConfirmRoleChange(true)}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {selectedUser.platform_role === "super_admin"
                        ? isId
                          ? "Turunkan ke User Biasa"
                          : "Demote to Standard User"
                        : isId
                          ? "Angkat Jadi Super Admin"
                          : "Promote to Super Admin"}
                    </span>
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-[10px] border border-warning/40 bg-warning-soft/30 p-3">
                    <p className="flex items-start gap-1.5 text-[11px] font-medium text-foreground">
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span>
                        {selectedUser.platform_role === "super_admin"
                          ? isId
                            ? "Yakin mencabut akses Super Admin dari akun ini?"
                            : "Confirm removing Super Admin access from this account?"
                          : isId
                            ? "Yakin memberi akses penuh Super Admin Console ke akun ini?"
                            : "Confirm granting full Super Admin Console access to this account?"}
                      </span>
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={busyAction === "role"}
                        onClick={() => void handleConfirmedRoleToggle()}
                      >
                        {isId ? "Konfirmasi Perubahan Role" : "Confirm Role Change"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busyAction !== null}
                        onClick={() => setConfirmRoleChange(false)}
                      >
                        {isId ? "Batal" : "Cancel"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background/50 px-5 py-3.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={busyAction === "reset"}
                disabled={busyAction !== null}
                onClick={() => void handleResetLimits()}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isId ? "Reset Default" : "Reset Defaults"}</span>
              </Button>

              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={busyAction === "save"}
                disabled={busyAction !== null}
                onClick={() => void handleSaveLimits()}
                className="ct-btn-glow"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isId ? "Simpan Kebijakan" : "Save Policy"}</span>
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
