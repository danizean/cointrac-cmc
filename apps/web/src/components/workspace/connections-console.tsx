"use client";

import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  KeyRound,
  Laptop,
  Plug,
  RefreshCw,
  Terminal,
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
  SectionHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { publicMcpUrl } from "@/lib/catalog";
import {
  fetchApiKeys,
  fetchMcpStatus,
  type ApiKeySummary,
  type McpStatusPayload,
} from "@/lib/control-plane-api";

type VerificationTier =
  | "Example configuration"
  | "Implementation supported"
  | "Configuration available";

interface ClientGuide {
  id: string;
  name: string;
  transport: string;
  status: VerificationTier;
  authMethod: string;
  notes: string;
  setupSteps: string[];
  snippet: string;
}

const LOCAL_DEV_ENDPOINT = "http://127.0.0.1:8000/mcp";

function buildLocalGuides(localHttpUrl: string): ClientGuide[] {
  return [
    {
      id: "local-antigravity",
      name: "Google Antigravity IDE",
      transport: "Local Streamable HTTP",
      status: "Example configuration",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Example for a local FastAPI process. This page does not prove that process is running. The MCP server registers 11 tools, 3 static resources, and evidence template reads.",
      setupSteps: [
        "Start the local CoinTrac Intelligence API on http://127.0.0.1:8000.",
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Add the configuration below to your Antigravity mcp_config.json and replace YOUR_COINTRAC_API_KEY.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              serverUrl: localHttpUrl,
              headers: {
                Authorization: "Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "local-cursor",
      name: "Cursor",
      transport: "Local Streamable HTTP",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Connects Cursor to your local CoinTrac MCP server over Streamable HTTP. Never commit real API keys into repository config files.",
      setupSteps: [
        "Run the local CoinTrac Intelligence API on port 8000 and create an API key in API Keys.",
        "Save the configuration below to .cursor/mcp.json and substitute YOUR_COINTRAC_API_KEY.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: localHttpUrl,
              headers: {
                Authorization: "Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "local-claude-code",
      name: "Claude Code CLI",
      transport: "Local Streamable HTTP",
      status: "Configuration available",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes: "Registers the local CoinTrac MCP endpoint via Claude Code HTTP transport.",
      setupSteps: [
        "Start the local CoinTrac Intelligence API on port 8000.",
        "Run the CLI command below, substituting YOUR_COINTRAC_API_KEY.",
      ],
      snippet: `claude mcp add --transport http cointrac ${localHttpUrl} \\\n  --header "Authorization: Bearer YOUR_COINTRAC_API_KEY"`,
    },
    {
      id: "local-claude-desktop",
      name: "Claude Desktop (stdio)",
      transport: "Local stdio process",
      status: "Configuration available",
      authMethod: "Local process environment (runs directly on your workstation)",
      notes:
        "Launches the local Python stdio entrypoint on your machine. Does not use a network or hosted remote endpoint.",
      setupSteps: [
        "Replace /ABSOLUTE/PATH/TO/REPO with the actual path to your local CoinTrac checkout.",
        "Paste into claude_desktop_config.json and restart Claude Desktop.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              command: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence/.venv/bin/python",
              args: ["-m", "app.mcp.stdio_entry"],
              cwd: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence",
              env: {
                PYTHONPATH: "/ABSOLUTE/PATH/TO/REPO/apps/intelligence",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "local-vscode",
      name: "VS Code (MCP)",
      transport: "Local Streamable HTTP",
      status: "Configuration available",
      authMethod: "Authorization: Bearer (runtime secret prompt)",
      notes: "Prompts for your CoinTrac API key at runtime instead of storing secrets on disk.",
      setupSteps: [
        "Start the local CoinTrac Intelligence API on port 8000.",
        "Add the configuration below to .vscode/mcp.json and enter your key when prompted.",
      ],
      snippet: JSON.stringify(
        {
          inputs: [
            {
              type: "promptString",
              id: "cointrac-api-key",
              description: "CoinTrac API Key",
              password: true,
            },
          ],
          servers: {
            cointrac: {
              type: "http",
              url: localHttpUrl,
              headers: {
                Authorization: "Bearer ${input:cointrac-api-key}",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "local-generic",
      name: "Generic HTTP / cURL",
      transport: "Local Streamable HTTP",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Direct JSON-RPC call to your local /mcp endpoint. Never pass API keys in URL query parameters (rejected with HTTP 400).",
      setupSteps: [
        "Start the local CoinTrac Intelligence API on port 8000.",
        "Send POST requests with Accept: application/json, text/event-stream and your Bearer API key.",
      ],
      snippet: `curl -sS -X POST "${localHttpUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -H "Authorization: Bearer YOUR_COINTRAC_API_KEY" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
    },
  ];
}

function buildRemoteGuides(remoteUrl: string): ClientGuide[] {
  return [
    {
      id: "remote-chatgpt",
      name: "ChatGPT",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY / x-cointrac-key",
      notes:
        "Connects to CoinTrac MCP over Streamable HTTP (HTTPS) with your personal CoinTrac API key or Bearer token for all 11 tools, 5 resources, and 3 prompts.",
      setupSteps: [
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Add the CoinTrac MCP URL below in ChatGPT Developer / MCP settings and supply your Bearer token.",
      ],
      snippet: JSON.stringify(
        {
          name: "CoinTrac Market Intelligence",
          url: remoteUrl,
          transport: "streamable-http",
          headers: {
            Authorization: "Bearer YOUR_COINTRAC_API_KEY",
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-claude",
      name: "Claude",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Works with Claude remote MCP over HTTPS (or Claude Code / Claude Desktop locally) using your personal CoinTrac API key.",
      setupSteps: [
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Add the remote MCP server configuration below and replace YOUR_COINTRAC_API_KEY.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: remoteUrl,
              headers: {
                Authorization: "Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-gemini",
      name: "Gemini",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "OAuth 2.1 + PKCE / Authorization: Bearer",
      notes:
        "Designed for Gemini remote MCP via HTTPS with OAuth 2.1 Authorization Code + PKCE and refresh token rotation, or API key Bearer auth.",
      setupSteps: [
        "Register CoinTrac as a remote Streamable HTTP MCP server using the HTTPS URL below.",
        "Authorize via OAuth 2.1 PKCE or pass Authorization: Bearer YOUR_COINTRAC_API_KEY.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              httpUrl: remoteUrl,
              auth: {
                type: "oauth2-pkce",
                fallbackHeader: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-hermes",
      name: "Hermes",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "x-cointrac-key / Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Connects directly to CoinTrac MCP over Streamable HTTP using x-cointrac-key or Bearer auth for all 11 MCP tools.",
      setupSteps: [
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Configure Hermes with the endpoint and header below.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: remoteUrl,
              headers: {
                "x-cointrac-key": "YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-antigravity",
      name: "Google Antigravity IDE",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Connects directly to the deployed CoinTrac Remote MCP HTTPS endpoint using your personal CoinTrac API key.",
      setupSteps: [
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Add the JSON block below to your Antigravity mcp_config.json and replace YOUR_COINTRAC_API_KEY.",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              serverUrl: remoteUrl,
              headers: {
                Authorization: "Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-cursor",
      name: "Cursor",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Uses Cursor's Streamable HTTP transport with server-side API key validation and per-account isolation.",
      setupSteps: [
        "Create a personal CoinTrac API key in API Keys (/app/keys).",
        "Save the configuration below to .cursor/mcp.json (never commit live keys).",
      ],
      snippet: JSON.stringify(
        {
          mcpServers: {
            cointrac: {
              url: remoteUrl,
              headers: {
                Authorization: "Bearer YOUR_COINTRAC_API_KEY",
              },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "remote-generic",
      name: "Generic HTTP / cURL",
      transport: "Remote Streamable HTTP (HTTPS)",
      status: "Implementation supported",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes: "Standard Streamable HTTP JSON-RPC endpoint accepting /mcp without redirects.",
      setupSteps: [
        "POST JSON-RPC requests with Accept: application/json, text/event-stream.",
        "Send your CoinTrac API key via Authorization: Bearer (never in query strings).",
      ],
      snippet: `curl -sS -X POST "${remoteUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "Accept: application/json, text/event-stream" \\\n  -H "Authorization: Bearer YOUR_COINTRAC_API_KEY" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
    },
  ];
}

function tierTone(status: VerificationTier): "positive" | "brand" | "neutral" {
  if (status === "Example configuration") return "neutral";
  if (status === "Implementation supported") return "brand";
  return "neutral";
}

function GuidePanel({
  guides,
  selectedId,
  onSelect,
  copiedKey,
  onCopy,
  ariaLabel,
  isId,
}: {
  guides: ClientGuide[];
  selectedId: string;
  onSelect: (id: string) => void;
  copiedKey: string | null;
  onCopy: (id: string, value: string, label: string) => void;
  ariaLabel: string;
  isId: boolean;
}) {
  const selected = guides.find((g) => g.id === selectedId) ?? guides[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="flex flex-col gap-1.5" role="tablist" aria-label={ariaLabel}>
        {guides.map((guide) => {
          const active = guide.id === selected.id;
          return (
            <button
              key={guide.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(guide.id)}
              className={`flex min-h-12 cursor-pointer flex-col items-start gap-0.5 rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
                active
                  ? "border-primary/50 bg-card text-foreground shadow-[0_0_20px_-10px_rgba(6,182,212,0.4)]"
                  : "border-border bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-semibold">
                {guide.transport.toLowerCase().includes("stdio") ? (
                  <Terminal className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden="true" />
                ) : (
                  <Plug className="h-3.5 w-3.5 shrink-0 text-link" aria-hidden="true" />
                )}
                <span>{guide.name}</span>
              </span>
              <span className="font-mono text-[11px] text-subtle-foreground">
                {guide.transport}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="min-w-0 space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">{selected.name}</h3>
            <p className="mt-0.5 font-mono text-xs text-subtle-foreground">{selected.transport}</p>
          </div>
          <Badge tone={tierTone(selected.status)}>{selected.status}</Badge>
        </div>

        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-[10px] border border-border bg-background/60 p-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Autentikasi" : "Authentication"}
            </dt>
            <dd className="mt-1 break-words font-mono text-foreground">{selected.authMethod}</dd>
          </div>
          <div className="rounded-[10px] border border-border bg-background/60 p-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              {isId ? "Catatan" : "Notes"}
            </dt>
            <dd className="mt-1 leading-relaxed text-muted-foreground">{selected.notes}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            {isId ? "Langkah penyiapan" : "Setup steps"}
          </h4>
          <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            {selected.setupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
              {isId ? "Cuplikan konfigurasi" : "Configuration snippet"}
            </h4>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCopy(selected.id, selected.snippet, `${selected.name} snippet`)}
            >
              {copiedKey === selected.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                  <span>{isId ? "Disalin" : "Copied"}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isId ? "Salin konfigurasi" : "Copy snippet"}</span>
                </>
              )}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-[10px] border border-border bg-code-bg p-4 font-mono text-xs leading-relaxed text-foreground">
            <code>{selected.snippet}</code>
          </pre>
        </div>
      </Card>
    </div>
  );
}

export function ConnectionsConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const { pushToast } = useToast();
  const configuredLocalUrl = publicMcpUrl();
  const localHttpUrl = LOCAL_DEV_ENDPOINT;
  const localGuides = buildLocalGuides(localHttpUrl);

  const [mcpStatus, setMcpStatus] = useState<McpStatusPayload | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [activeKeyCount, setActiveKeyCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<{ status: number; message: string } | null>(null);
  const [keysError, setKeysError] = useState<{ status: number; message: string } | null>(null);

  const [selectedLocalId, setSelectedLocalId] = useState(localGuides[0].id);
  const [selectedRemoteId, setSelectedRemoteId] = useState("remote-chatgpt");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loadAll = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);
      setStatusError(null);
      setKeysError(null);

      const [statusRes, keysRes] = await Promise.all([fetchMcpStatus(), fetchApiKeys()]);
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
      const [statusRes, keysRes] = await Promise.all([fetchMcpStatus(), fetchApiKeys()]);
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

  const activeKeys = keys.filter((k) => k.is_active);
  const remoteDeployed = Boolean(mcpStatus?.remote_deployed && mcpStatus.remote_url);
  const remoteGuides = buildRemoteGuides(
    remoteDeployed && mcpStatus?.remote_url ? mcpStatus.remote_url : configuredLocalUrl,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title={isId ? "Koneksi MCP" : "MCP Connections"}
        description={
          isId
            ? "Hubungkan agen AI dan klien MCP (Antigravity, Cursor, Claude, VS Code) ke CoinTrac Market Intelligence."
            : "Connect CoinTrac Market Intelligence to compatible AI agents and MCP clients."
        }
        actions={
          <Button
            variant="primary"
            size="md"
            loading={refreshing}
            onClick={() => void loadAll(true)}
            className="ct-btn-glow"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>{isId ? "Perbarui status" : "Refresh status"}</span>
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

      {/* Live Infrastructure & Key Readiness Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="ct-surface-featured flex flex-col justify-between gap-2.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">MCP Server</span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : statusError ? (
              <StatusIndicator state="ERROR" />
            ) : (
              <StatusIndicator state="CONNECTED" label="LOCAL READY" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-9 w-full" />
          ) : mcpStatus ? (
            <div>
              <p className="text-sm font-semibold text-foreground">
                Streamable HTTP ({mcpStatus.stateless_http ? "Stateless" : "Stateful"})
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-subtle-foreground">
                Protocol {mcpStatus.protocol_version} · {mcpStatus.contracts.tools} tools ·{" "}
                {mcpStatus.contracts.static_resources + mcpStatus.contracts.resource_templates}{" "}
                resources · {mcpStatus.contracts.prompts} prompts
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {isId ? "Tidak tersedia" : "Unavailable"}
            </p>
          )}
        </Card>

        <Card className="flex flex-col justify-between gap-2.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">Hosted Remote MCP</span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : statusError ? (
              <StatusIndicator state="UNVERIFIED" />
            ) : remoteDeployed ? (
              <StatusIndicator state="CONNECTED" label="DEPLOYED" />
            ) : (
              <StatusIndicator state="NOT_DEPLOYED" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <div>
              <p className="truncate font-mono text-sm font-semibold text-foreground">
                {remoteDeployed && mcpStatus?.remote_url
                  ? mcpStatus.remote_url
                  : isId
                    ? "Belum di-deploy"
                    : "Not deployed"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {remoteDeployed
                  ? isId
                    ? "Endpoint HTTPS publik aktif."
                    : "Public HTTPS endpoint active."
                  : isId
                    ? "Belum ada host HTTPS publik yang disediakan."
                    : "No public HTTPS host provisioned yet."}
              </p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col justify-between gap-2.5 p-4 sm:col-span-2 lg:col-span-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>{isId ? "Kunci API CoinTrac" : "CoinTrac API Keys"}</span>
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
            <Skeleton className="h-9 w-full" />
          ) : keysError ? (
            <p className="text-xs text-destructive">{keysError.message}</p>
          ) : (
            <div>
              <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
                {activeKeyCount ?? 0}{" "}
                {isId
                  ? "kunci aktif"
                  : `active key${activeKeyCount === 1 ? "" : "s"}`}
              </p>
              {activeKeys.length > 0 ? (
                <p className="mt-0.5 truncate font-mono text-[11px] text-subtle-foreground">
                  {activeKeys
                    .slice(0, 2)
                    .map((k) => `${k.label} (${k.key_prefix}…)`)
                    .join(", ")}
                </p>
              ) : (
                <Link
                  href="/app/keys"
                  className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-link hover:underline"
                >
                  <span>{isId ? "Buat Kunci API CoinTrac" : "Create a CoinTrac API Key"}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* SECTION 1: LOCAL MCP */}
      <section aria-labelledby="local-mcp-heading" className="space-y-4">
        <SectionHeader
          id="local-mcp-heading"
          title={isId ? "1. Local MCP (Komputer Lokal)" : "1. Local MCP (Developer Workstation)"}
          description={
            isId
              ? "Berjalan di lingkungan lokal Anda melalui CoinTrac Intelligence API atau Python stdio. Tidak di-host secara publik."
              : "Runs inside your own environment via the local CoinTrac Intelligence API or Python stdio entrypoint. Not publicly hosted."
          }
          action={<Badge tone="brand">LOCAL DEVELOPMENT</Badge>}
        />

        <Card className="ct-surface-featured flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-link">
              <Laptop className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Endpoint pengembangan lokal" : "Local development endpoint"}
                </p>
                <Badge tone="neutral">NOT PUBLICLY HOSTED</Badge>
              </div>
              <code className="mt-1 block break-all font-mono text-sm font-semibold text-foreground">
                {localHttpUrl}
              </code>
              <p className="mt-1 text-xs text-muted-foreground">
                {isId ? "Gunakan header " : "Authenticate HTTP requests with "}
                <code className="font-mono text-foreground">
                  Authorization: Bearer YOUR_COINTRAC_API_KEY
                </code>
                {isId
                  ? ". Kunci API yang sudah ada tetap kompatibel."
                  : ". Existing API keys remain compatible."}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void copyText("local-url", localHttpUrl, "local MCP endpoint")}
          >
            {copiedKey === "local-url" ? (
              <>
                <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                <span>{isId ? "Disalin" : "Copied URL"}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isId ? "Salin endpoint" : "Copy endpoint"}</span>
              </>
            )}
          </Button>
        </Card>

        <GuidePanel
          guides={localGuides}
          selectedId={selectedLocalId}
          onSelect={setSelectedLocalId}
          copiedKey={copiedKey}
          onCopy={(id, value, label) => void copyText(id, value, label)}
          ariaLabel="Local MCP client setup guides"
          isId={isId}
        />
      </section>

      {/* SECTION 2: REMOTE MCP */}
      <section aria-labelledby="remote-mcp-heading" className="space-y-4">
        <SectionHeader
          id="remote-mcp-heading"
          title={isId ? "2. Remote MCP (Endpoint Publik)" : "2. Remote MCP (Hosted Network Endpoint)"}
          description={
            isId
              ? "Hubungkan klien MCP cloud atau jarak jauh melalui HTTPS setelah deployment publik tersedia."
              : "Connect cloud or remote MCP clients over HTTPS once a public CoinTrac MCP deployment is provisioned."
          }
          action={
            remoteDeployed ? (
              <StatusIndicator state="CONNECTED" label="DEPLOYED" />
            ) : (
              <StatusIndicator state="NOT_DEPLOYED" label={isId ? "Belum di-deploy" : "Not deployed"} />
            )
          }
        />

        {remoteDeployed && mcpStatus?.remote_url ? (
          <>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-link">
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                    {isId ? "Endpoint HTTPS publik" : "Hosted HTTPS endpoint"}
                  </p>
                  <code className="mt-1 block break-all font-mono text-sm font-semibold text-foreground">
                    {mcpStatus.remote_url}
                  </code>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  void copyText("remote-url", mcpStatus.remote_url ?? "", "remote MCP endpoint")
                }
              >
                {copiedKey === "remote-url" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                    <span>{isId ? "Disalin" : "Copied URL"}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isId ? "Salin endpoint" : "Copy endpoint"}</span>
                  </>
                )}
              </Button>
            </Card>
            <GuidePanel
              guides={remoteGuides}
              selectedId={selectedRemoteId}
              onSelect={setSelectedRemoteId}
              copiedKey={copiedKey}
              onCopy={(id, value, label) => void copyText(id, value, label)}
              ariaLabel="Remote MCP client setup guides"
              isId={isId}
            />
          </>
        ) : (
          <Card className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-warning/40 bg-warning-soft text-warning">
                <Cloud className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1.5">
                <h3 className="text-sm font-semibold text-foreground">
                  {isId ? "Hosted Remote MCP: Belum di-deploy" : "Hosted Remote MCP: Not deployed"}
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {isId
                    ? "Belum ada host HTTPS Remote MCP publik di lingkungan ini. CoinTrac tidak menampilkan URL palsu sampai deployment publik dikonfigurasi melalui "
                    : "No public HTTPS Remote MCP host is deployed in this environment. CoinTrac does not display a fabricated public URL until a real hosted deployment is configured via "}
                  <code className="font-mono text-foreground">REMOTE_MCP_PUBLIC_URL</code>.
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Kesiapan protokol backend" : "Backend protocol readiness"}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>Stateless Streamable HTTP transport at /mcp (11 tools, 5 resources, 3 prompts)</li>
                  <li>OAuth 2.1 Authorization Code + PKCE &amp; SHA-256 API key validation</li>
                  <li>DNS-rebinding Host/Origin allowlist &amp; per-account isolation</li>
                </ul>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  {isId ? "Klien yang didukung & akses" : "Supported clients & access"}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>ChatGPT, Claude, Gemini, and Hermes over Streamable HTTP</li>
                  <li>
                    {isId
                      ? "Lihat katalog lengkap di halaman "
                      : "View the full catalog on "}
                    <Link href="/integrations" className="font-semibold text-link hover:underline">
                      /integrations
                    </Link>{" "}
                    {isId ? "atau panduan di " : "or setup snippets at "}
                    <Link href="/connect" className="font-semibold text-link hover:underline">
                      /connect
                    </Link>
                  </li>
                  <li>
                    {isId
                      ? "Gunakan Local MCP di atas untuk pengembangan lokal saat ini"
                      : "Use Local MCP above for workstation development today"}
                  </li>
                </ul>
              </div>
            </div>
            <GuidePanel
              guides={remoteGuides}
              selectedId={selectedRemoteId}
              onSelect={setSelectedRemoteId}
              copiedKey={copiedKey}
              onCopy={(id, value, label) => void copyText(id, value, label)}
              ariaLabel="Remote MCP client setup guides"
              isId={isId}
            />
          </Card>
        )}
      </section>
    </div>
  );
}
