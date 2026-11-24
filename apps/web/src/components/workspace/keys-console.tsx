"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { StatusIndicator } from "@/components/status-badges";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  InfoTip,
  Input,
  PageHeader,
  SectionHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  type ApiKeySummary,
} from "@/lib/control-plane-api";

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function KeysConsole() {
  const { pushToast } = useToast();

  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [maxKeys, setMaxKeys] = useState(5);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);

  // Create key modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Copy-once secret reveal modal (kept strictly in React state; never persisted to browser storage)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [revealedLabel, setRevealedLabel] = useState("");
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Revoke confirmation modal state
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const loadKeys = useCallback(
    async (isManual: boolean) => {
      if (isManual) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setLoadError(null);
      const res = await fetchApiKeys();
      setLoading(false);
      setRefreshing(false);
      if (!res.ok) {
        setLoadError({ status: res.status, message: res.message });
        if (isManual) {
          pushToast(res.message, "error");
        }
        return;
      }
      setKeys(res.data.keys);
      setActiveCount(res.data.active_count);
      setMaxKeys(res.data.max_active_keys);
      if (isManual) {
        pushToast("API key list refreshed.", "info");
      }
    },
    [pushToast],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetchApiKeys();
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError({ status: res.status, message: res.message });
        return;
      }
      setKeys(res.data.keys);
      setActiveCount(res.data.active_count);
      setMaxKeys(res.data.max_active_keys);
    })();
    return () => {
      active = false;
    };
  }, []);

  const revokedCount = useMemo(
    () => keys.filter((k) => !k.is_active || k.revoked_at !== null).length,
    [keys],
  );

  const rateLimitPerMin = useMemo(() => {
    const active = keys.find((k) => k.is_active);
    return active?.rate_limit_per_min ?? keys[0]?.rate_limit_per_min ?? null;
  }, [keys]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreateError(null);
    const cleaned = label.trim();
    if (!cleaned) {
      setCreateError("Enter a descriptive name for this API key.");
      return;
    }
    if (cleaned.length > 64) {
      setCreateError("API key name must be 64 characters or fewer.");
      return;
    }

    setCreating(true);
    const res = await createApiKey(cleaned);
    setCreating(false);
    if (!res.ok) {
      setCreateError(res.message);
      return;
    }

    setLabel("");
    setCreateOpen(false);
    setRevealedSecret(res.data.api_key);
    setRevealedLabel(res.data.key.label);
    setCopied(false);
    setAcknowledged(false);
    pushToast(`Created API key "${res.data.key.label}". Copy the secret now.`, "success");

    // Refresh authoritative key list from backend
    const listRes = await fetchApiKeys();
    if (listRes.ok) {
      setKeys(listRes.data.keys);
      setActiveCount(listRes.data.active_count);
      setMaxKeys(listRes.data.max_active_keys);
    } else {
      setKeys((prev) => [res.data.key, ...prev]);
      setActiveCount((prev) => prev + 1);
    }
  }

  async function handleCopySecret() {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard.writeText(revealedSecret);
      setCopied(true);
      pushToast("API key copied to clipboard.", "success");
    } catch {
      setCopied(false);
      pushToast("Clipboard access unavailable. Select and copy the key manually.", "error");
    }
  }

  function closeRevealModal() {
    if (!acknowledged) return;
    setRevealedSecret(null);
    setRevealedLabel("");
    setCopied(false);
    setAcknowledged(false);
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget || revoking) return;
    setRevoking(true);
    setRevokeError(null);
    const targetLabel = revokeTarget.label;
    const res = await revokeApiKey(revokeTarget.id);
    setRevoking(false);
    if (!res.ok) {
      setRevokeError(res.message);
      return;
    }
    setRevokeTarget(null);
    pushToast(`Revoked API key "${targetLabel}".`, "success");

    // Reload authoritative list from backend
    const listRes = await fetchApiKeys();
    if (listRes.ok) {
      setKeys(listRes.data.keys);
      setActiveCount(listRes.data.active_count);
      setMaxKeys(listRes.data.max_active_keys);
    } else {
      setKeys((prev) => prev.map((k) => (k.id === res.data.key.id ? res.data.key : k)));
      setActiveCount((prev) => Math.max(0, prev - 1));
    }
  }

  const limitReached = activeCount >= maxKeys;

  return (
    <div className="space-y-8">
      <PageHeader
        title="API Keys"
        description="Create, inspect, and revoke personal CoinTrac API keys for MCP clients and REST integrations. Keys are SHA-256 hashed on the server and shown in plaintext strictly once upon creation."
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={refreshing}
              onClick={() => void loadKeys(true)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              <span>Refresh</span>
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={loading || limitReached}
              onClick={() => {
                setCreateError(null);
                setLabel("");
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Create API Key</span>
            </Button>
          </>
        }
      />

      {/* Compact Account Key Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="flex flex-col justify-between gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <KeyRound className="h-4 w-4 text-link" aria-hidden="true" />
              <span>Active keys</span>
            </span>
            {loading ? (
              <StatusIndicator state="LOADING" />
            ) : loadError ? (
              <StatusIndicator state="ERROR" />
            ) : activeCount > 0 ? (
              <StatusIndicator state="CONFIGURED" />
            ) : (
              <StatusIndicator state="NOT_CONFIGURED" />
            )}
          </div>
          {loading ? (
            <Skeleton className="h-8 w-32" />
          ) : loadError ? (
            <p className="text-sm text-muted-foreground">
              Active and revoked counts are unavailable until the key list loads.
            </p>
          ) : (
            <div>
              <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                {activeCount} / {maxKeys} active
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {revokedCount > 0
                  ? `${revokedCount} revoked key${revokedCount === 1 ? "" : "s"} retained for audit history.`
                  : "No revoked keys on this account."}
              </p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col justify-between gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-link" aria-hidden="true" />
              <span>Permissions &amp; rate window</span>
              <InfoTip
                label="About API key identity, permissions, and usage"
                text="Each key identifies a client or machine under your account and inherits your account-level access. All keys share one per-account rate window; creating extra keys does not multiply quota. Key presence alone does not verify that a client has authenticated."
              />
            </span>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {rateLimitPerMin !== null
                ? `${rateLimitPerMin} req / min (shared)`
                : "Shared per-account window"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Account-scoped MCP &amp; REST access; extra keys share your account limit.
            </p>
          </div>
        </Card>

        <Card className="flex flex-col justify-between gap-2 p-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs font-semibold text-muted-foreground">Next step</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Authenticate requests with{" "}
            <code className="font-mono text-foreground">Authorization: Bearer</code> in your MCP
            client or scripts.
          </p>
          <div>
            <Link
              href="/app/connections"
              className="inline-flex min-h-8 items-center gap-1 rounded-[8px] px-1 text-xs font-semibold text-link hover:bg-muted/60 hover:underline"
            >
              <span>Open MCP Connections</span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </Card>
      </div>

      {limitReached && !loading ? (
        <div
          role="status"
          className="rounded-[12px] border border-warning/40 bg-warning-soft px-4 py-3 text-xs text-foreground"
        >
          Active API key limit reached ({activeCount} / {maxKeys}). Revoke an unused key before
          creating a new one.
        </div>
      ) : null}

      {loadError ? (
        <ErrorNotice
          status={loadError.status}
          message={loadError.message}
          onRetry={() => void loadKeys(true)}
        />
      ) : null}

      {/* Key Inventory */}
      <section aria-labelledby="keys-list-heading" className="space-y-4">
        <SectionHeader
          id="keys-list-heading"
          title="Your API keys"
          description="Raw secrets are never retrievable after creation. Revoked keys remain visible as immutable audit records."
        />

        {loading ? (
          <Card className="space-y-3 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </Card>
        ) : !loadError && keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
            title="No API keys yet"
            description="Create a personal CoinTrac API key to authenticate local MCP clients or REST API requests under your account."
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setCreateError(null);
                  setLabel("");
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create API Key</span>
              </Button>
            }
          />
        ) : keys.length > 0 ? (
          <>
            {/* Desktop Table */}
            <Card className="hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-3">Key name</th>
                      <th className="px-4 py-3">Identifier</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Rate limit</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Last used</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {keys.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3.5 text-sm font-medium text-foreground">
                          {item.label}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {item.masked_key}
                        </td>
                        <td className="px-4 py-3.5">
                          {item.is_active ? (
                            <StatusIndicator state="CONNECTED" label="ACTIVE" />
                          ) : (
                            <StatusIndicator state="DISCONNECTED" label="REVOKED" />
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono tabular-nums text-muted-foreground">
                          {item.rate_limit_per_min} req/min
                        </td>
                        <td className="px-4 py-3.5 font-mono tabular-nums text-muted-foreground">
                          {formatTimestamp(item.created_at)}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-subtle-foreground">
                          {item.last_used_at ? formatTimestamp(item.last_used_at) : "Unavailable"}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {item.is_active ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => {
                                setRevokeError(null);
                                setRevokeTarget(item);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Revoke</span>
                            </Button>
                          ) : (
                            <span className="font-mono text-[11px] text-subtle-foreground">
                              {item.revoked_at
                                ? `Revoked ${formatTimestamp(item.revoked_at)}`
                                : "Revoked"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile Card List */}
            <div className="space-y-3 md:hidden">
              {keys.map((item) => (
                <Card key={item.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                        {item.masked_key}
                      </p>
                    </div>
                    {item.is_active ? (
                      <StatusIndicator state="CONNECTED" label="ACTIVE" />
                    ) : (
                      <StatusIndicator state="DISCONNECTED" label="REVOKED" />
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                    <div>
                      <dt className="text-[11px] text-subtle-foreground">Created</dt>
                      <dd className="mt-0.5 font-mono text-[11px] text-foreground">
                        {formatTimestamp(item.created_at)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-subtle-foreground">Last used</dt>
                      <dd className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {item.last_used_at ? formatTimestamp(item.last_used_at) : "Unavailable"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-subtle-foreground">Rate window</dt>
                      <dd className="mt-0.5 font-mono text-[11px] text-foreground">
                        {item.rate_limit_per_min} req/min
                      </dd>
                    </div>
                    {item.revoked_at ? (
                      <div>
                        <dt className="text-[11px] text-subtle-foreground">Revoked at</dt>
                        <dd className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          {formatTimestamp(item.revoked_at)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {item.is_active ? (
                    <div className="pt-1">
                      <Button
                        variant="danger"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setRevokeError(null);
                          setRevokeTarget(item);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Revoke key</span>
                      </Button>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {/* Create Key Modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="Create CoinTrac API Key"
        description="Name this key after the client or machine that will use it. All keys inherit your account permissions and share your account rate window."
      >
        <form onSubmit={handleCreate} className="space-y-4" noValidate>
          <Input
            id="create-key-label"
            label="API key name"
            maxLength={64}
            required
            autoFocus
            disabled={creating}
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (createError) setCreateError(null);
            }}
            placeholder="e.g. Antigravity Local or Cursor Workstation"
            helper="1 to 64 characters. Identifies this credential in your key list."
            error={createError}
          />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="md"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={creating}>
              <span>{creating ? "Generating..." : "Generate API Key"}</span>
            </Button>
          </div>
        </form>
      </Modal>

      {/* One-Time Secret Reveal Modal */}
      <Modal
        open={Boolean(revealedSecret)}
        onClose={closeRevealModal}
        allowBackdropClose={false}
        title={`Copy your new API key (${revealedLabel})`}
        description="Store this secret securely now. CoinTrac hashes keys with SHA-256 and cannot display the plaintext value again after you close this dialog."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-[10px] border border-warning/40 bg-warning-soft p-3 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              This key is displayed <strong>strictly once</strong> and is never saved in browser
              storage or retrievable later.
            </span>
          </div>

          <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-code-bg p-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
              {revealedSecret}
            </code>
            <Button variant="secondary" size="sm" onClick={() => void handleCopySecret()}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy key</span>
                </>
              )}
            </Button>
          </div>

          <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span>I have copied and stored this API key securely.</span>
          </label>

          <div className="flex justify-end pt-1">
            <Button
              variant="primary"
              size="md"
              disabled={!acknowledged}
              onClick={closeRevealModal}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* Revoke Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => {
          if (!revoking) setRevokeTarget(null);
        }}
        onConfirm={() => void handleConfirmRevoke()}
        title={revokeTarget ? `Revoke "${revokeTarget.label}"?` : "Revoke API key?"}
        description={
          revokeTarget
            ? `Revocation is immediate and permanent. Any MCP client or script authenticating with ${revokeTarget.masked_key} will stop authenticating (HTTP 401) on its next request.`
            : ""
        }
        confirmLabel={revoking ? "Revoking..." : "Revoke API key"}
        cancelLabel="Cancel"
        destructive
        loading={revoking}
        error={revokeError}
      />
    </div>
  );
}
