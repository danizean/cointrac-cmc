import { LogOut, MailWarning } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { ResendVerificationButton } from "@/components/auth/resend-verification-button";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getVerifiedServerIdentity } from "@/lib/supabase/server";

async function AuthenticatedGate({ children }: { children: ReactNode }) {
  const { configured, user, emailVerified } = await getVerifiedServerIdentity();

  if (!configured) {
    redirect("/login?error=auth_not_configured");
  }
  if (!user) {
    redirect("/login");
  }

  if (!emailVerified) {
    return (
      <main id="content" className="mx-auto max-w-xl px-4 py-14">
        <div className="tg-panel rounded-2xl p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 text-accent">
              <MailWarning className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-foreground">Email verification required</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Your session is signed in as{" "}
                <span className="font-mono text-foreground">{user.email ?? "unknown"}</span>, but
                your email address has not been verified yet. Confirm your email before accessing
                CoinTrac workspace routes.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            {user.email ? <ResendVerificationButton email={user.email} /> : <span />}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card-elevated px-3.5 py-2 text-xs font-semibold text-foreground hover:border-destructive/40"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  return <WorkspaceShell email={user.email ?? ""}>{children}</WorkspaceShell>;
}

export default function ProtectedAppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main id="content" className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <div className="tg-panel h-48 animate-pulse rounded-2xl p-6" aria-busy="true" />
        </main>
      }
    >
      <AuthenticatedGate>{children}</AuthenticatedGate>
    </Suspense>
  );
}
