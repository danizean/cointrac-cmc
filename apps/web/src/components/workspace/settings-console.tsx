"use client";

import { Check, Copy, LogOut, RefreshCw, ShieldCheck, User } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusIndicator } from "@/components/status-badges";
import {
  Button,
  Card,
  ErrorNotice,
  Input,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import {
  fetchMyProfile,
  updateMyDisplayName,
  type AuthProfilePayload,
} from "@/lib/control-plane-api";

function formatUtcTimestamp(iso: string | null | undefined): string {
  if (!iso) return "Unavailable";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export function SettingsConsole() {
  const { pushToast } = useToast();

  const [profile, setProfile] = useState<AuthProfilePayload | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadProfile = useCallback(
    async (isManual: boolean) => {
      if (isManual) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);

      const res = await fetchMyProfile();
      setLoading(false);
      setRefreshing(false);
      if (!res.ok) {
        setLoadError({ status: res.status, message: res.message });
        if (isManual) {
          pushToast(res.message, "error");
        }
        return;
      }
      setProfile(res.data);
      setDisplayName(res.data.display_name ?? "");
      if (isManual) {
        pushToast("Account profile refreshed.", "info");
      }
    },
    [pushToast],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetchMyProfile();
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError({ status: res.status, message: res.message });
        return;
      }
      setProfile(res.data);
      setDisplayName(res.data.display_name ?? "");
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaveError(null);

    const cleaned = displayName.trim();
    if (!cleaned) {
      setSaveError("Display name cannot be empty.");
      return;
    }
    if (cleaned.length > 80) {
      setSaveError("Display name must be 80 characters or fewer.");
      return;
    }

    setSaving(true);
    const res = await updateMyDisplayName(cleaned);
    setSaving(false);

    if (!res.ok) {
      setSaveError(res.message);
      pushToast(res.message, "error");
      return;
    }

    setProfile(res.data);
    setDisplayName(res.data.display_name ?? cleaned);
    pushToast("Display name updated.", "success");
  }

  async function handleCopyUserId() {
    if (!profile?.user_id) return;
    try {
      await navigator.clipboard.writeText(profile.user_id);
      setCopiedId(true);
      pushToast("Account identifier copied.", "success");
      window.setTimeout(() => setCopiedId(false), 2000);
    } catch {
      pushToast("Clipboard access unavailable.", "error");
    }
  }

  const unchanged = (profile?.display_name ?? "").trim() === displayName.trim();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your CoinTrac account and profile."
        actions={
          <Button
            variant="secondary"
            size="md"
            loading={refreshing}
            onClick={() => void loadProfile(true)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            <span>Refresh</span>
          </Button>
        }
      />

      {loadError ? (
        <ErrorNotice
          status={loadError.status}
          message={loadError.message}
          onRetry={() => void loadProfile(true)}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Profile Form */}
        <Card className="space-y-5 p-5 lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border pb-3.5">
            <User className="h-4 w-4 text-link" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Profile</h2>
          </div>

          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-10 w-36" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <Input
                id="settings-email"
                type="email"
                label="Verified email address"
                value={profile?.email ?? "Unavailable"}
                readOnly
                disabled
                helper="Email address is managed by your authentication provider."
              />

              <Input
                id="settings-display-name"
                type="text"
                label="Display name"
                maxLength={80}
                disabled={saving || Boolean(loadError)}
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (saveError) setSaveError(null);
                }}
                placeholder="Your name or handle"
                helper="1 to 80 characters. Updates only your editable display name via PATCH /v1/auth/profile."
                error={saveError}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <p className="text-xs text-subtle-foreground">
                  Account tier, role, and verification status are server-managed.
                </p>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={saving}
                  disabled={Boolean(loadError) || unchanged}
                >
                  <span>{saving ? "Saving..." : "Save changes"}</span>
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* Account Information & Session */}
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <ShieldCheck className="h-4 w-4 text-link" aria-hidden="true" />
              <h2 className="text-base font-semibold text-foreground">Account information</h2>
            </div>

            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            ) : (
              <dl className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
                  <dt className="text-muted-foreground">Email status</dt>
                  <dd>
                    {profile ? (
                      profile.email_verified ? (
                        <StatusIndicator state="CONNECTED" label="VERIFIED" />
                      ) : (
                        <StatusIndicator state="UNVERIFIED" />
                      )
                    ) : (
                      <span className="font-mono text-subtle-foreground">Unavailable</span>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
                  <dt className="text-muted-foreground">Plan tier</dt>
                  <dd className="font-mono font-semibold uppercase text-foreground">
                    {profile?.base_plan_code ?? "Unavailable"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
                  <dt className="text-muted-foreground">Account status</dt>
                  <dd className="font-mono font-semibold text-foreground">
                    {profile?.account_status ?? "Unavailable"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
                  <dt className="text-muted-foreground">Account created</dt>
                  <dd className="font-mono text-muted-foreground">
                    {formatUtcTimestamp(profile?.created_at)}
                  </dd>
                </div>
                <div className="space-y-1.5">
                  <dt className="text-muted-foreground">User ID</dt>
                  <dd className="flex items-center justify-between gap-2 rounded-[8px] border border-border bg-background/60 px-2.5 py-1.5">
                    <span className="min-w-0 truncate font-mono text-[11px] text-foreground">
                      {profile?.user_id ?? "Unavailable"}
                    </span>
                    {profile?.user_id ? (
                      <button
                        type="button"
                        onClick={() => void handleCopyUserId()}
                        aria-label="Copy user ID"
                        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-subtle-foreground hover:bg-muted hover:text-foreground"
                      >
                        {copiedId ? (
                          <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </dd>
                </div>
              </dl>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-base font-semibold text-foreground">Session</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Signed in as{" "}
              <span className="break-all font-mono text-foreground">
                {profile?.email ?? "verified account"}
              </span>
              . Signing out clears your browser session cookies immediately.
            </p>
            <form action="/auth/signout" method="post" className="pt-1">
              <Button type="submit" variant="secondary" size="md" className="w-full">
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Sign out</span>
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
