"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { validatePasswordStrength } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ResetPasswordForm({
  configured,
  mode,
}: {
  configured: boolean;
  mode: "request" | "update";
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDoneMessage(null);

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Authentication service is not configured for this environment.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery&next=${encodeURIComponent("/reset-password?mode=update")}`,
      });
      if (resetError && resetError.status === 429) {
        setError("Too many reset requests. Wait a few minutes before trying again.");
        return;
      }
      // Generic response prevents email enumeration
      setDoneMessage(
        "If an account exists for that email address, a password reset link has been sent.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDoneMessage(null);

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
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDoneMessage("Your password has been updated. You can now continue to your workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={mode === "update" ? handleUpdatePassword : handleRequestReset}
      className="tg-panel rounded-2xl p-6 sm:p-8"
      noValidate
    >
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/30 bg-primary/15 text-primary">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {mode === "update" ? "Set a new password" : "Reset your password"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {mode === "update"
              ? "Choose a strong new password (minimum 12 characters)."
              : "Enter your account email to receive a secure recovery link."}
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {doneMessage && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-positive/30 bg-positive/10 p-3.5 text-xs text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
          <span>{doneMessage}</span>
        </div>
      )}

      {mode === "update" ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold text-foreground">
              New password
            </label>
            <input
              id="new-password"
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
              htmlFor="confirm-new-password"
              className="mb-1.5 block text-xs font-semibold text-foreground"
            >
              Confirm new password
            </label>
            <input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your new password"
              className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="reset-email" className="mb-1.5 block text-xs font-semibold text-foreground">
            Email address
          </label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !configured}
        className="mt-6 w-full cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Submitting..."
          : mode === "update"
            ? "Update password"
            : "Send reset link"}
      </button>

      <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
        <Link href="/login" className="font-semibold text-primary hover:underline">
          Back to sign in
        </Link>
        {mode === "update" && doneMessage && (
          <Link href="/app" className="font-semibold text-positive hover:underline">
            Go to /app
          </Link>
        )}
      </div>
    </form>
  );
}
