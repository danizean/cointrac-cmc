"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { validatePasswordStrength } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignupForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResendNote(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      setError(strength.reason ?? "Password does not meet security requirements.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Authentication service is not configured for this environment.");
      return;
    }

    setSubmitting(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/app`;
      // Security: Never submit plan, role, or entitlement claims in user_metadata.
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (signUpError) {
        const lower = signUpError.message.toLowerCase();
        if (lower.includes("rate limit") || signUpError.status === 429) {
          setError("Too many signup attempts. Please wait a few minutes and try again.");
        } else if (lower.includes("already registered") || lower.includes("already exists")) {
          setError("An account with this email already exists. Sign in or reset your password.");
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // Supabase returns an empty identities array when an already-registered email signs up
      // while email confirmation is enabled (anti-enumeration behavior).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError("An account with this email already exists. Sign in or reset your password.");
        return;
      }

      setPendingEmail(normalizedEmail);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail) return;
    setResendNote(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: pendingEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    });
    if (resendError) {
      setResendNote(
        resendError.status === 429
          ? "Please wait before requesting another verification email."
          : resendError.message,
      );
      return;
    }
    setResendNote("Verification email sent. Check your inbox and spam folder.");
  }

  if (pendingEmail) {
    return (
      <div className="tg-panel rounded-2xl p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-positive/30 bg-positive/10 text-positive">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-foreground">Verify your email</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              We sent a verification link to{" "}
              <span className="font-mono text-foreground">{pendingEmail}</span>. Confirm your email
              before accessing your CoinTrac workspace.
            </p>
          </div>
        </div>

        {resendNote && (
          <p className="mt-4 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground">
            {resendNote}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleResend}
            className="cursor-pointer rounded-xl border border-border bg-card-elevated px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/40"
          >
            Resend verification email
          </button>
          <Link
            href="/login"
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Continue to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="tg-panel rounded-2xl p-6 sm:p-8" noValidate>
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Create your CoinTrac account
          </h1>
          <p className="text-xs text-muted-foreground">
            Public signup · Email verification required · No payment card required
          </p>
        </div>
      </div>

      {!configured && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-accent/40 bg-accent/10 p-3.5 text-xs text-foreground"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            Supabase public authentication credentials are not configured in this environment yet.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-xs font-semibold text-foreground">
            Email address
          </label>
          <input
            id="signup-email"
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
          <label
            htmlFor="signup-password"
            className="mb-1.5 block text-xs font-semibold text-foreground"
          >
            Password
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 12 chars (A-Z, a-z, 0-9)"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div>
          <label
            htmlFor="signup-confirm-password"
            className="mb-1.5 block text-xs font-semibold text-foreground"
          >
            Confirm password
          </label>
          <input
            id="signup-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
        <span>Permanent Free base plan provisioned securely on the server after verification.</span>
      </div>

      <button
        type="submit"
        disabled={submitting || !configured}
        className="mt-5 w-full cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Creating account..." : "Create account"}
      </button>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
