"use client";

import {
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
} from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { StatusIndicator } from "@/components/status-badges";
import { Badge, Button, Card, ErrorNotice, PageHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { updateAdminAiConfig, type AIRuntimeConfigPayload } from "@/lib/control-plane-api";
import { useAdminData } from "./admin-context";
import { AdminAccessBarrier } from "./admin-guard";

interface RuntimeDraft {
  enabled: boolean;
  model: string;
  base_url: string;
  api_key_secret: string;
  default_rate_limit_per_min: string;
  default_daily_requests: string;
  default_daily_tokens: string;
  max_tool_rounds: string;
  max_output_tokens: string;
  temperature: string;
  response_cache_ttl_seconds: string;
  system_directive: string;
}

const INPUT =
  "mt-1 min-h-10 w-full rounded-[10px] border border-border bg-input-bg px-3 py-2 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none";

function draftFromConfig(c: AIRuntimeConfigPayload): RuntimeDraft {
  return {
    enabled: c.enabled,
    model: c.model,
    base_url: c.base_url,
    api_key_secret: "",
    default_rate_limit_per_min: String(c.default_rate_limit_per_min),
    default_daily_requests: String(c.default_daily_requests),
    default_daily_tokens: String(c.default_daily_tokens),
    max_tool_rounds: String(c.max_tool_rounds),
    max_output_tokens: String(c.max_output_tokens),
    temperature: String(c.temperature),
    response_cache_ttl_seconds: String(c.response_cache_ttl_seconds),
    system_directive: c.system_directive,
  };
}

export function AdminRuntimeView() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();
  const { data, loading, refreshing, error, refresh } = useAdminData();

  const [edits, setEdits] = useState<Partial<RuntimeDraft> | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const title = isId ? "Mesin AI & Kebijakan Global" : "AI Runtime & Global Policy";
  const description = isId
    ? "Kendali penuh Muse Spark 1.3: kill switch global, rotasi API key aman, batas default user, cache TTL, dan instruksi sistem."
    : "Full Muse Spark 1.3 governance: global kill switch, write-only API key rotation, default guardrails, cache TTL, and system directive.";

  if ((loading && !data) || (error && !data)) {
    return <AdminAccessBarrier title={title} description={description} />;
  }
  if (!data) return null;

  const base = draftFromConfig(data.config);
  const form: RuntimeDraft = { ...base, ...(edits ?? {}) };
  const isDirty = edits !== null && Object.keys(edits).length > 0;

  function patchForm(next: Partial<RuntimeDraft>) {
    setEdits((prev) => ({ ...(prev ?? {}), ...next }));
  }

  async function handleSave(clearKey = false) {
    setSaving(true);
    const res = await updateAdminAiConfig({
      enabled: form.enabled,
      model: form.model.trim() || "muse-spark-1.3",
      base_url: form.base_url.trim() || "https://api.meta.ai/v1",
      ...(clearKey
        ? { clear_api_key_secret: true }
        : form.api_key_secret.trim()
          ? { api_key_secret: form.api_key_secret.trim() }
          : {}),
      default_rate_limit_per_min: Number(form.default_rate_limit_per_min) || 10,
      default_daily_requests: Number(form.default_daily_requests) || 50,
      default_daily_tokens: Number(form.default_daily_tokens) || 150000,
      max_tool_rounds: Number(form.max_tool_rounds) || 4,
      max_output_tokens: Number(form.max_output_tokens) || 900,
      temperature: Number(form.temperature),
      response_cache_ttl_seconds: Number(form.response_cache_ttl_seconds),
      system_directive: form.system_directive,
    });
    setSaving(false);
    if (!res.ok) {
      pushToast(res.message, "error");
      return;
    }
    setEdits(null);
    pushToast(
      clearKey
        ? isId
          ? "Key DB dihapus; kembali memakai .env server."
          : "DB key cleared; using server .env fallback."
        : isId
          ? "Konfigurasi runtime AI tersimpan."
          : "AI runtime configuration updated.",
      "success",
    );
    await refresh();
  }

  // Conservative upper-bound estimate per 1M tokens at Muse Spark 1.3 rates ($1.25 in / $4.25 out, ~75/25 split ~ $2.00/M blended)
  const parsedDailyTokens = Math.max(1000, Number(form.default_daily_tokens) || 150000);
  const estMaxDailySpendPerUserUsd = (parsedDailyTokens / 1_000_000) * 2.0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isDirty ? (
              <Button
                type="button"
                variant="secondary"
                size="md"
                disabled={saving}
                onClick={() => setEdits(null)}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>{isId ? "Batalkan Draft" : "Discard"}</span>
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="md"
                loading={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                <span>{isId ? "Muat ulang" : "Refresh"}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="md"
              loading={saving}
              onClick={() => void handleSave(false)}
              className="ct-btn-glow"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              <span>{isId ? "Simpan Perubahan" : "Save Changes"}</span>
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorNotice status={error.status} message={error.message} onRetry={() => void refresh()} />
      ) : null}

      {/* Global Kill Switch Banner */}
      <Card
        className={`p-5 ${
          form.enabled
            ? "ct-surface-featured"
            : "border-destructive/50 bg-destructive-soft/25"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border ${
                form.enabled
                  ? "border-positive/35 bg-positive-soft text-positive"
                  : "border-destructive/40 bg-destructive-soft text-destructive"
              }`}
            >
              <Power className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {isId ? "Global Circuit Breaker (CoinTrac AI)" : "Global Circuit Breaker (CoinTrac AI)"}
                </h2>
                <StatusIndicator
                  state={form.enabled ? "CONNECTED" : "STANDBY"}
                  label={form.enabled ? (isId ? "AKTIF" : "ENABLED") : isId ? "DIJEDA" : "PAUSED"}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {form.enabled
                  ? isId
                    ? "Semua pengguna dengan kuota aktif dapat menjalankan analisis Muse Spark 1.3."
                    : "Authenticated users within quota can invoke Muse Spark 1.3 market analysis."
                  : isId
                    ? "Mode darurat aktif: seluruh endpoint chat CoinTrac AI untuk user ditolak hingga diaktifkan kembali."
                    : "Emergency pause active: user AI endpoints reject new inference requests until re-enabled."}
              </p>
            </div>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border-strong bg-background px-4 py-2 text-xs font-semibold text-foreground">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => patchForm({ enabled: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            <span>{form.enabled ? (isId ? "AI Aktif" : "AI Online") : isId ? "Dijeda Global" : "Globally Paused"}</span>
          </label>
        </div>
      </Card>

      {/* Structured 2-Column Governance Grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Card 1: Provider & Credentials */}
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3.5">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-link" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">
                {isId ? "Provider & Kredensial Muse" : "Muse Provider & Credentials"}
              </h3>
            </div>
            <Badge tone={data.config.api_key_configured ? "positive" : "warning"}>
              {data.config.api_key_configured
                ? `${data.config.api_key_source.toUpperCase()} · ${data.config.api_key_hint ?? "***"}`
                : isId
                  ? "Key Kosong"
                  : "No Key"}
            </Badge>
          </div>

          <div className="space-y-3.5">
            <label className="block text-xs font-medium text-muted-foreground">
              Model ID
              <input
                className={INPUT}
                value={form.model}
                onChange={(e) => patchForm({ model: e.target.value })}
              />
            </label>

            <label className="block text-xs font-medium text-muted-foreground">
              Base URL
              <input
                className={INPUT}
                value={form.base_url}
                onChange={(e) => patchForm({ base_url: e.target.value })}
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-muted-foreground">
                {isId
                  ? "Set / Ganti Muse API Key (Write-Only, tidak pernah ditampilkan ulang)"
                  : "Set / Replace Muse API Key (Write-Only, never echoed back)"}
                <div className="relative mt-1">
                  <input
                    type={showSecret ? "text" : "password"}
                    autoComplete="off"
                    className="min-h-10 w-full rounded-[10px] border border-border bg-input-bg py-2 pr-10 pl-3 font-mono text-xs text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
                    value={form.api_key_secret}
                    onChange={(e) => patchForm({ api_key_secret: e.target.value })}
                    placeholder={data.config.api_key_hint ?? "Paste dev.meta.ai API key..."}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((prev) => !prev)}
                    aria-label={showSecret ? "Hide key" : "Show key"}
                    className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[6px] text-subtle-foreground hover:bg-muted hover:text-foreground"
                  >
                    {showSecret ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </label>
              {data.config.api_key_source === "db" ? (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={saving}
                    onClick={() => void handleSave(true)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isId ? "Hapus Key DB (Kembali ke .env)" : "Clear DB Key (Fallback .env)"}</span>
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </Card>

        {/* Card 2: Default Per-User Guardrails */}
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3.5">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-link" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-foreground">
                {isId ? "Batas Kuota Default Per Pengguna" : "Default Per-User Quota Guardrails"}
              </h3>
            </div>
            <Badge tone="neutral">Global Fallback</Badge>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Rate Limit (req / menit)" : "Rate Limit (req / minute)"}
              <input
                type="number"
                min={1}
                max={240}
                className={INPUT}
                value={form.default_rate_limit_per_min}
                onChange={(e) => patchForm({ default_rate_limit_per_min: e.target.value })}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground">
              {isId ? "Kuota Permintaan Harian" : "Daily Requests Quota"}
              <input
                type="number"
                min={1}
                max={10000}
                className={INPUT}
                value={form.default_daily_requests}
                onChange={(e) => patchForm({ default_daily_requests: e.target.value })}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground sm:col-span-2">
              {isId ? "Batas Token Harian / User" : "Daily Token Cap / User"}
              <input
                type="number"
                min={1000}
                max={10000000}
                className={INPUT}
                value={form.default_daily_tokens}
                onChange={(e) => patchForm({ default_daily_tokens: e.target.value })}
              />
            </label>
          </div>

          <div className="rounded-[10px] border border-border bg-background/60 px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
            {isId ? "Simulasi batas biaya maksimum / user / hari" : "Estimated max daily exposure per standard user"}:{" "}
            <span className="font-semibold text-link">
              ~${estMaxDailySpendPerUserUsd.toFixed(3)} USD
            </span>{" "}
            <span className="text-subtle-foreground">(blended Muse Spark 1.3 rate)</span>
          </div>
        </Card>
      </div>

      {/* Card 3: Inference Tuning, Cache & Admin System Directive */}
      <Card className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-link" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {isId ? "Tuning Inferensi, Cache & Instruksi Sistem" : "Inference Tuning, Caching & System Directive"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {isId
                  ? "Atur kedalaman pemanggilan tool CoinMarketCap dan lamanya response cache."
                  : "Balance latency, multi-step tool depth, and zero-token cache hit savings."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              {
                label: isId ? "Hemat & Cepat" : "Fast & Lean",
                values: {
                  max_tool_rounds: "2",
                  max_output_tokens: "600",
                  temperature: "0.1",
                  response_cache_ttl_seconds: "180",
                },
              },
              {
                label: isId ? "Seimbang (Rekomendasi)" : "Balanced (Recommended)",
                values: {
                  max_tool_rounds: "4",
                  max_output_tokens: "900",
                  temperature: "0.2",
                  response_cache_ttl_seconds: "120",
                },
              },
              {
                label: isId ? "Riset Mendalam" : "Deep Research",
                values: {
                  max_tool_rounds: "6",
                  max_output_tokens: "1400",
                  temperature: "0.25",
                  response_cache_ttl_seconds: "90",
                },
              },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => patchForm(preset.values)}
                className="cursor-pointer rounded-full border border-border bg-background/80 px-3 py-1 font-mono text-[11px] font-medium text-foreground transition-colors hover:border-primary/45 hover:text-link"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-medium text-muted-foreground">
            Max Tool Rounds (1–8)
            <input
              type="number"
              min={1}
              max={8}
              className={INPUT}
              value={form.max_tool_rounds}
              onChange={(e) => patchForm({ max_tool_rounds: e.target.value })}
            />
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            Max Output Tokens (128–4096)
            <input
              type="number"
              min={128}
              max={4096}
              className={INPUT}
              value={form.max_output_tokens}
              onChange={(e) => patchForm({ max_output_tokens: e.target.value })}
            />
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            Response Cache TTL (sec)
            <input
              type="number"
              min={0}
              max={3600}
              className={INPUT}
              value={form.response_cache_ttl_seconds}
              onChange={(e) => patchForm({ response_cache_ttl_seconds: e.target.value })}
            />
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            Temperature ({form.temperature})
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              className={INPUT}
              value={form.temperature}
              onChange={(e) => patchForm({ temperature: e.target.value })}
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-muted-foreground">
          {isId ? "Instruksi Tambahan Super Admin (Opsional)" : "Super Admin System Directive (Optional)"}
          <textarea
            rows={3}
            className={INPUT}
            value={form.system_directive}
            onChange={(e) => patchForm({ system_directive: e.target.value })}
            placeholder={
              isId
                ? "Contoh: Selalu cantumkan perbandingan kekuatan relatif 7d terhadap BTC saat menganalisis altcoin."
                : "Example: Always include 7d relative strength vs BTC when analyzing altcoins."
            }
          />
        </label>
      </Card>
    </div>
  );
}
