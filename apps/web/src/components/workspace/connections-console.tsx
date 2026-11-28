"use client";

import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  KeyRound,
  Laptop,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { StatusIndicator } from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { publicMcpUrl } from "@/lib/catalog";
import {
  fetchApiKeys,
  fetchMcpStatus,
  fetchUsage,
  type ApiKeySummary,
  type McpStatusPayload,
  type UsagePayload,
} from "@/lib/control-plane-api";

type TransportMode = "local" | "remote";
type ClientPresetId = "universal" | "web" | "cli" | "curl";

interface ClientPreset {
  id: ClientPresetId;
  label: string;
  subtitle: string;
  auth: string;
  snippet: string;
}

const LOCAL_DEV_ENDPOINT = "http://127.0.0.1:8000/mcp";

function buildPresets(endpointUrl: string, mode: TransportMode, isId: boolean): ClientPreset[] {
  const universalJson = JSON.stringify(
    {
      mcpServers: {
        cointrac: {
          url: endpointUrl,
          headers: {
            Authorization: "Bearer YOUR_COINTRAC_API_KEY",
          },
        },
      },
    },
    null,
    2,
  );

  const webJson = JSON.stringify(
    {
      name: "CoinTrac Market Intelligence",
      url: endpointUrl,
      transport: "streamable-http",
      auth: {
        header: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
        oauth2: "OAuth 2.1 + PKCE",
      },
    },
    null,
    2,
  );

  const cliSnippet = `claude mcp add --transport http cointrac ${endpointUrl} \\\n  --header "Authorization: Bearer YOUR_COINTRAC_API_KEY"`;

  const curlSnippet =
    mode === "local"
      ? `# Streamable HTTP JSON-RPC test\ncurl -sS -X POST "${endpointUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -H "Authorization: Bearer YOUR_COINTRAC_API_KEY" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'\n\n# Or local Python stdio:\n# command: /PATH/TO/REPO/apps/intelligence/.venv/bin/python -m app.mcp.stdio_entry`
      : `curl -sS -X POST "${endpointUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -H "Authorization: Bearer YOUR_COINTRAC_API_KEY" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

  return [
    {
      id: "universal",
      label: "IDE & Agent JSON",
      subtitle: "Antigravity · Cursor · Claude · Hermes · VS Code",
      auth: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      snippet: universalJson,
    },
    {
      id: "web",
      label: "ChatGPT / Gemini",
      subtitle: isId ? "Konektor web / OAuth 2.1 PKCE" : "Web connector / OAuth 2.1 PKCE",
      auth: "OAuth 2.1 + PKCE atau Bearer token",
      snippet: webJson,
    },
    {
      id: "cli",
      label: "Claude Code CLI",
      subtitle: isId ? "Perintah terminal satu baris" : "Single-line CLI setup",
      auth: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      snippet: cliSnippet,
    },
    {
      id: "curl",
      label: mode === "local" ? "cURL / stdio" : "cURL",
      subtitle: isId ? "Uji langsung JSON-RPC & fallback" : "Direct JSON-RPC verification",
      auth: "Authorization: Bearer (never query string)",
      snippet: curlSnippet,
    },
  ];
}

export function ConnectionsConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();

  const [mcpStatus, setMcpStatus] = useState<McpStatusPayload | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [activeKeyCount, setActiveKeyCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<{ status: number; message: string } | null>(null);
  const [keysError, setKeysError] = useState<{ status: number; message: string } | null>(null);

  const [mode, setMode] = useState<TransportMode>("remote");
  const [presetId, setPresetId] = useState<ClientPresetId>("universal");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadAll = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);
      setStatusError(null);
      setKeysError(null);

      const [statusRes, keysRes, usageRes] = await Promise.all([
        fetchMcpStatus(),
        fetchApiKeys(),
        fetchUsage(),
      ]);
      setLoading(false);
      setRefreshing(false);

      if (statusRes.ok) {
        setMcpStatus(statusRes.data);
      } else {
        setMcpStatus(null);
        setStatusError({ status: statusRes.status, message: statusRes.message });
      }
      if (keysRes.ok) {
        setKeys(keysRes.data.keys);
        setActiveKeyCount(keysRes.data.active_count);
      } else {
        setActiveKeyCount(null);
        setKeysError({ status: keysRes.status, message: keysRes.message });
      }
      if (usageRes.ok) {
        setUsage(usageRes.data);
      }

      if (isManual) {
        if (!statusRes.ok || !keysRes.ok) {
          pushToast("Connection status refresh completed with errors.", "error");
        } else {
          pushToast("MCP connection status refreshed.", "info");
        }
      }
    },
    [pushToast],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [statusRes, keysRes, usageRes] = await Promise.all([
        fetchMcpStatus(),
        fetchApiKeys(),
        fetchUsage(),
      ]);
      if (!active) return;
      setLoading(false);
      if (statusRes.ok) {
        setMcpStatus(statusRes.data);
      } else {
        setStatusError({ status: statusRes.status, message: statusRes.message });
      }
      if (keysRes.ok) {
        setKeys(keysRes.data.keys);
        setActiveKeyCount(keysRes.data.active_count);
      } else {
        setKeysError({ status: keysRes.status, message: keysRes.message });
      }
      if (usageRes.ok) {
        setUsage(usageRes.data);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function copyText(id: string, value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(id);
      pushToast(`Copied ${label}.`, "success");
      window.setTimeout(() => setCopiedKey((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      setCopiedKey(null);
      pushToast("Clipboard access unavailable. Copy the text manually.", "error");
    }
  }

  const remoteDeployed = Boolean(mcpStatus?.remote_deployed && mcpStatus.remote_url);
  const endpointUrl =
    mode === "remote"
      ? remoteDeployed && mcpStatus?.remote_url
        ? mcpStatus.remote_url
        : publicMcpUrl()
      : LOCAL_DEV_ENDPOINT;
  const presets = buildPresets(endpointUrl, mode, isId);
  const selectedPreset = presets.find((p) => p.id === presetId) ?? presets[0];
  const activeKeys = keys.filter((k) => k.is_active);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isId ? "Koneksi MCP" : "MCP Connections"}
        description={
          isId
            ? "Satu endpoint MCP untuk menghubungkan IDE maupun agen AI Anda dengan kunci API pribadi."
            : "One MCP endpoint to connect your IDE or AI client using your CoinTrac API key."
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={refreshing}
            onClick={() => void loadAll(true)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isId ? "Muat ulang" : "Refresh"}</span>
          </Button>
        }
      />

      {statusError ? (
        <ErrorNotice
          status={statusError.status}
          message={statusError.message}
          onRetry={() => void loadAll(true)}
        />
      ) : null}

      {/* Compact 3-column Readiness Summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">MCP Server</span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : statusError ? (
              <StatusIndicator state="ERROR" />
            ) : (
              <StatusIndicator state="CONNECTED" label="READY" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-5 w-full" />
          ) : mcpStatus ? (
            <p className="font-mono text-[11px] text-subtle-foreground">
              {mcpStatus.contracts.tools} tools ·{" "}
              {mcpStatus.contracts.static_resources + mcpStatus.contracts.resource_templates}{" "}
              resources · {mcpStatus.contracts.prompts} prompts
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{isId ? "Tidak tersedia" : "Unavailable"}</p>
          )}
        </Card>

        <Card className="p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Hosted HTTPS</span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : remoteDeployed ? (
              <StatusIndicator state="CONNECTED" label="DEPLOYED" />
            ) : (
              <StatusIndicator state="NOT_DEPLOYED" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-5 w-full" />
          ) : (
            <div className="space-y-1">
              <p className="truncate font-mono text-xs text-muted-foreground">
                {remoteDeployed && mcpStatus?.remote_url
                  ? mcpStatus.remote_url
                  : isId
                    ? "Pakai Local MCP untuk dev"
                    : "Use Local MCP for dev"}
              </p>
              {usage ? (
                <Link
                  href="/app/usage"
                  className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-link hover:underline"
                >
                  <span>
                    {usage.tool_quota.calls_by_surface.mcp ?? 0} {isId ? "panggilan MCP tercatat (OAuth & Key)" : "MCP calls tracked (OAuth & Key)"}
                  </span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          )}
        </Card>

        <Card className="p-4 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              {isId ? "Kunci API" : "API Keys"}
            </span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : keysError ? (
              <StatusIndicator state="ERROR" />
            ) : (activeKeyCount ?? 0) > 0 ? (
              <StatusIndicator state="CONFIGURED" />
            ) : (
              <StatusIndicator state="NOT_CONFIGURED" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-5 w-full" />
          ) : activeKeys.length > 0 ? (
            <p className="truncate font-mono text-xs text-foreground">
              {activeKeyCount} {isId ? "aktif" : "active"} · {activeKeys[0].key_prefix}…
            </p>
          ) : (
            <Link
              href="/app/keys"
              className="inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline"
            >
              <span>{isId ? "Buat Kunci API" : "Create API Key"}</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </Card>
      </div>

      {/* Unified Quick Setup Card */}
      <Card className="p-5 space-y-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                {isId ? "Konfigurasi Cepat" : "Quick Setup"}
              </h2>
              {mode === "remote" && !remoteDeployed ? (
                <Badge tone="warning">
                  {isId ? "Preview URL (Belum deploy)" : "Preview URL (Not deployed)"}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {isId
                ? "1. Buat key di /app/keys  ·  2. Pilih mode & format klien  ·  3. Tempel snippet ke aplikasi AI Anda."
                : "1. Create a key at /app/keys  ·  2. Pick environment & format  ·  3. Paste into your AI client."}
            </p>
          </div>

          <div
            role="group"
            aria-label={isId ? "Mode endpoint MCP" : "MCP endpoint mode"}
            className="inline-flex shrink-0 rounded-[10px] border border-border bg-card-elevated p-1"
          >
            <button
              type="button"
              onClick={() => setMode("local")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === "local"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
              Local
            </button>
            <button
              type="button"
              onClick={() => setMode("remote")}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === "remote"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
              Remote
            </button>
          </div>
        </div>

        {/* Active Endpoint Copy Bar */}
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-card-elevated px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <code className="break-all font-mono text-xs font-semibold text-foreground">
            {endpointUrl}
          </code>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void copyText("endpoint-url", endpointUrl, "MCP endpoint URL")}
          >
            {copiedKey === "endpoint-url" ? (
              <>
                <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                <span>{isId ? "Disalin" : "Copied"}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isId ? "Salin URL" : "Copy URL"}</span>
              </>
            )}
          </Button>
        </div>

        {/* 4 Compact Client Format Tabs */}
        <div
          role="tablist"
          aria-label={isId ? "Format klien MCP" : "MCP client format"}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {presets.map((item) => {
            const selected = item.id === selectedPreset.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPresetId(item.id)}
                className={`cursor-pointer rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                <span className="block text-xs font-semibold">{item.label}</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-subtle-foreground">
                  {item.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Single Snippet Box */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {selectedPreset.subtitle} · <span className="text-foreground">{selectedPreset.auth}</span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void copyText(selectedPreset.id, selectedPreset.snippet, `${selectedPreset.label} snippet`)
              }
            >
              {copiedKey === selectedPreset.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                  <span>{isId ? "Disalin" : "Copied"}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isId ? "Salin snippet" : "Copy snippet"}</span>
                </>
              )}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-[10px] border border-border bg-code-bg p-4 font-mono text-xs leading-relaxed text-foreground">
            <code>{selectedPreset.snippet}</code>
          </pre>
        </div>
      </Card>
    </div>
  );
}
