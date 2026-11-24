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
  | "Live connection verified"
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
      status: "Live connection verified",
      authMethod: "Authorization: Bearer YOUR_COINTRAC_API_KEY",
      notes:
        "Verified live against local FastAPI on port 8000 (10 tools, 3 static resources, and evidence template reads).",
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
  if (status === "Live connection verified") return "positive";
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
}: {
  guides: ClientGuide[];
  selectedId: string;
  onSelect: (id: string) => void;
  copiedKey: string | null;
  onCopy: (id: string, value: string, label: string) => void;
  ariaLabel: string;
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
                  ? "border-primary/50 bg-card text-foreground"
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
              Authentication
            </dt>
            <dd className="mt-1 break-words font-mono text-foreground">{selected.authMethod}</dd>
          </div>
          <div className="rounded-[10px] border border-border bg-background/60 p-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
              Notes
            </dt>
            <dd className="mt-1 leading-relaxed text-muted-foreground">{selected.notes}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
            Setup steps
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
              Configuration snippet
            </h4>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onCopy(selected.id, selected.snippet, `${selected.name} snippet`)}
            >
              {copiedKey === selected.id ? (
                <>
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy snippet</span>
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
  const { pushToast } = useToast();
  const configuredLocalUrl = publicMcpUrl();
  const localHttpUrl = configuredLocalUrl.includes("localhost")
    ? LOCAL_DEV_ENDPOINT
    : configuredLocalUrl;
  const localGuides = buildLocalGuides(localHttpUrl);

  const [mcpStatus, setMcpStatus] = useState<McpStatusPayload | null>(null);
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [activeKeyCount, setActiveKeyCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState<{ status: number; message: string } | null>(null);
  const [keysError, setKeysError] = useState<{ status: number; message: string } | null>(null);

  const [selectedLocalId, setSelectedLocalId] = useState(localGuides[0].id);
  const [selectedRemoteId, setSelectedRemoteId] = useState("remote-antigravity");
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
  const remoteGuides =
    remoteDeployed && mcpStatus?.remote_url ? buildRemoteGuides(mcpStatus.remote_url) : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="MCP Connections"
        description="Connect CoinTrac Market Intelligence to compatible AI agents and MCP clients."
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={refreshing}
            onClick={() => void loadAll(true)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Refresh status</span>
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
        <Card className="flex flex-col justify-between gap-2.5 p-4">
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
            <p className="text-xs text-muted-foreground">Unavailable</p>
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
                {remoteDeployed && mcpStatus?.remote_url ? mcpStatus.remote_url : "Not deployed"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {remoteDeployed
                  ? "Public HTTPS endpoint active."
                  : "No public HTTPS host provisioned yet."}
              </p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col justify-between gap-2.5 p-4 sm:col-span-2 lg:col-span-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 text-link" aria-hidden="true" />
              <span>CoinTrac API Keys</span>
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
                {activeKeyCount ?? 0} active key{activeKeyCount === 1 ? "" : "s"}
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
                  <span>Create a CoinTrac API Key</span>
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
          title="1. Local MCP (Developer Workstation)"
          description="Runs inside your own environment via the local CoinTrac Intelligence API or Python stdio entrypoint. Not publicly hosted."
          action={<Badge tone="brand">LOCAL DEVELOPMENT</Badge>}
        />

        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-link">
              <Laptop className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                  Local development endpoint
                </p>
                <Badge tone="neutral">NOT PUBLICLY HOSTED</Badge>
              </div>
              <code className="mt-1 block break-all font-mono text-sm font-semibold text-foreground">
                {localHttpUrl}
              </code>
              <p className="mt-1 text-xs text-muted-foreground">
                Authenticate HTTP requests with{" "}
                <code className="font-mono text-foreground">
                  Authorization: Bearer YOUR_COINTRAC_API_KEY
                </code>
                . Existing API keys remain compatible.
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
                <span>Copied URL</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy endpoint</span>
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
        />
      </section>

      {/* SECTION 2: REMOTE MCP */}
      <section aria-labelledby="remote-mcp-heading" className="space-y-4">
        <SectionHeader
          id="remote-mcp-heading"
          title="2. Remote MCP (Hosted Network Endpoint)"
          description="Connect cloud or remote MCP clients over HTTPS once a public CoinTrac MCP deployment is provisioned."
          action={
            remoteDeployed ? (
              <StatusIndicator state="CONNECTED" label="DEPLOYED" />
            ) : (
              <StatusIndicator state="NOT_DEPLOYED" label="Not deployed" />
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
                    Hosted HTTPS endpoint
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
                    <span>Copied URL</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Copy endpoint</span>
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
                  Hosted Remote MCP: Not deployed
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No public HTTPS Remote MCP host is deployed in this environment. CoinTrac does not
                  display a fabricated public URL until a real hosted deployment is configured via{" "}
                  <code className="font-mono text-foreground">REMOTE_MCP_PUBLIC_URL</code>.
                </p>
              </div>
            </div>

            <div className="grid gap-3 text-xs sm:grid-cols-2">
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  Backend protocol readiness
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>Stateless Streamable HTTP transport at /mcp</li>
                  <li>SHA-256 API key validation and per-account isolation</li>
                  <li>DNS-rebinding Host/Origin allowlist enforcement</li>
                </ul>
              </div>
              <div className="rounded-[10px] border border-border bg-background/60 p-3.5">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  Required before public remote access
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                  <li>Provision an HTTPS host with streaming enabled and set allowlists</li>
                  <li>
                    Cloud MCP clients may require OAuth 2.1 Dynamic Client Registration (future
                    deployment requirement; not currently enabled)
                  </li>
                  <li>Use Local MCP above for workstation development today</li>
                </ul>
              </div>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
