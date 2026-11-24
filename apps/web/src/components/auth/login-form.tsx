"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { sanitizeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ERROR_MESSAGES: Record<string, string> = {
  auth_not_configured: "Authentication service is not configured for this environment.",
  callback_exchange_failed: "Authentication link could not be verified or has expired.",
  verification_link_invalid: "Email verification or reset link is invalid or expired.",
  missing_auth_parameters: "Invalid authentication callback parameters.",
};

export function LoginForm({
  configured,
  nextPath,
  initialError,
  signedOut,
}: {
  configured: boolean;
  nextPath: string;
  initialError?: string;
  signedOut?: boolean;
}) {
  const router = useRouter();
  const safeNext = sanitizeRedirectPath(nextPath, "/app");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "Unable to complete sign in.") : null,
  );
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendStatus(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError("Enter both your email address and password.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Authentication service is not configured for this environment.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) {
        const lower = signInError.message.toLowerCase();
        if (lower.includes("email not confirmed")) {
          setNeedsVerification(true);
          setError("Verify your email address before signing in.");
        } else if (lower.includes("rate limit") || signInError.status === 429) {
          setError("Too many sign-in attempts. Wait a few minutes and try again.");
        } else {
          // Generic invalid credentials message to prevent account enumeration
          setError("Invalid email or password.");
        }
        return;
      }

      router.replace(safeNext);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendVerification() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error: resendErr } = await supabase.auth.resend({
      type: "signup",
      email: normalizedEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    });
    if (resendErr) {
      setResendStatus(
        resendErr.status === 429
          ? "Please wait before requesting another verification email."
          : resendErr.message,
      );
      return;
    }
    setResendStatus("Verification email sent. Check your inbox.");
  }

  return (
    <form onSubmit={handleSubmit} className="tg-panel rounded-2xl p-6 sm:p-8" noValidate>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
          <Lock className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Sign in to CoinTrac</h1>
          <p className="text-xs text-muted-foreground">
            Verified email session required for workspace access
          </p>
        </div>
      </div>

      {signedOut && !error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-positive/30 bg-positive/10 p-3 text-xs text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
          <span>You have been signed out.</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-5 flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{error}</span>
          </div>
          {needsVerification && (
            <button
              type="button"
              onClick={handleResendVerification}
              className="w-fit cursor-pointer rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-primary/40"
            >
              Resend verification email
            </button>
          )}
          {resendStatus && <span className="text-[11px] text-muted-foreground">{resendStatus}</span>}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold text-foreground">
            Email address
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="text-xs font-semibold text-foreground">
              Password
            </label>
            <Link href="/reset-password" className="text-xs text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !configured}
        className="mt-6 w-full cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Signing in..." : "Sign in"}
      </button>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        New to CoinTrac?{" "}
        <Link href="/signup" className="font-semibold text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
