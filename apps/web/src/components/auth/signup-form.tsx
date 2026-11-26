"use client";

import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Mail,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { validatePasswordStrength } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SignupForm({ configured }: { configured: boolean }) {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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
      setError(
        isId ? "Masukkan alamat email yang valid." : "Enter a valid email address.",
      );
      return;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      setError(
        strength.reason ??
          (isId
            ? "Kata sandi belum memenuhi syarat keamanan."
            : "Password does not meet security requirements."),
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(isId ? "Konfirmasi kata sandi tidak cocok." : "Passwords do not match.");
      return;
    }

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError(
        isId
          ? "Layanan autentikasi belum dikonfigurasi untuk environment ini."
          : "Authentication service is not configured for this environment.",
      );
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
          setError(
            isId
              ? "Terlalu banyak percobaan pendaftaran. Mohon tunggu beberapa menit."
              : "Too many signup attempts. Please wait a few minutes and try again.",
          );
        } else if (
          lower.includes("already registered") ||
          lower.includes("already exists")
        ) {
          setError(
            isId
              ? "Akun dengan email ini sudah terdaftar. Silakan masuk atau reset kata sandi."
              : "An account with this email already exists. Sign in or reset your password.",
          );
        } else {
          setError(signUpError.message);
        }
        return;
      }

      if (
        data.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        setError(
          isId
            ? "Akun dengan email ini sudah terdaftar. Silakan masuk atau reset kata sandi."
            : "An account with this email already exists. Sign in or reset your password.",
        );
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
          ? isId
            ? "Mohon tunggu sebelum meminta email verifikasi lagi."
            : "Please wait before requesting another verification email."
          : resendError.message,
      );
      return;
    }
    setResendNote(
      isId
        ? "Email verifikasi terkirim. Periksa kotak masuk atau folder spam Anda."
        : "Verification email sent. Check your inbox and spam folder.",
    );
  }

  if (pendingEmail) {
    return (
      <div className="ct-surface-featured ct-enter rounded-[18px] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-positive/30 bg-positive/10 text-positive">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {isId ? "Periksa kotak masuk Anda" : "Verify your email"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {isId ? "Tautan verifikasi dikirim ke " : "We sent a verification link to "}
              <span className="font-mono text-foreground">{pendingEmail}</span>.{" "}
              {isId
                ? "Konfirmasi email untuk membuka workspace CoinTrac Anda."
                : "Confirm your email to access your CoinTrac workspace."}
            </p>
          </div>
        </div>

        {resendNote && (
          <p className="mt-4 rounded-[12px] border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-foreground">
            {resendNote}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleResend}
            className="tg-btn tg-btn-secondary inline-flex cursor-pointer text-xs"
          >
            {isId ? "Kirim ulang email" : "Resend verification email"}
          </button>
          <Link href="/login" className="tg-btn tg-btn-primary ct-btn-glow inline-flex text-xs">
            {isId ? "Lanjut masuk" : "Continue to sign in"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ct-enter space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[28px]">
          {isId ? "Buat akun CoinTrac" : "Create your account"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {isId
            ? "Mulai pakai Market Intelligence API & server MCP tanpa kartu kredit."
            : "Start building with deterministic crypto intelligence and MCP tools."}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="ct-surface-featured rounded-[18px] p-6 sm:p-8"
        noValidate
      >
        {!configured && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-[12px] border border-accent/40 bg-accent/10 p-3.5 text-xs text-foreground"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <span>
              {isId
                ? "Kredensial autentikasi publik Supabase belum dikonfigurasi pada environment ini."
                : "Supabase public authentication credentials are not configured in this environment yet."}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2.5 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="signup-email"
              className="mb-1.5 block text-xs font-semibold text-foreground"
            >
              {isId ? "Email kerja" : "Email address"}
            </label>
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="min-h-11 w-full rounded-[10px] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="signup-password"
              className="mb-1.5 block text-xs font-semibold text-foreground"
            >
              {isId ? "Kata sandi" : "Password"}
            </label>
            <div className="relative">
              <input
                id="signup-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isId
                    ? "Min. 12 karakter (A-Z, a-z, 0-9)"
                    : "Minimum 12 chars (A-Z, a-z, 0-9)"
                }
                className="min-h-11 w-full rounded-[10px] border border-border bg-input-bg py-2.5 pl-3.5 pr-11 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={
                  showPassword
                    ? isId
                      ? "Sembunyikan kata sandi"
                      : "Hide password"
                    : isId
                      ? "Tampilkan kata sandi"
                      : "Show password"
                }
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="signup-confirm-password"
              className="mb-1.5 block text-xs font-semibold text-foreground"
            >
              {isId ? "Konfirmasi kata sandi" : "Confirm password"}
            </label>
            <div className="relative">
              <input
                id="signup-confirm-password"
                name="confirmPassword"
                type={showConfirm ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={isId ? "Ulangi kata sandi Anda" : "Repeat your password"}
                className="min-h-11 w-full rounded-[10px] border border-border bg-input-bg py-2.5 pl-3.5 pr-11 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((prev) => !prev)}
                aria-label={
                  showConfirm
                    ? isId
                      ? "Sembunyikan konfirmasi"
                      : "Hide confirmation password"
                    : isId
                      ? "Tampilkan konfirmasi"
                      : "Show confirmation password"
                }
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || !configured}
          className="tg-btn tg-btn-primary ct-btn-glow mt-6 flex min-h-11 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? isId
              ? "Membuat akun..."
              : "Creating account..."
            : isId
              ? "Buat Akun"
              : "Create account"}
        </button>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-positive" aria-hidden="true" />
          <span>
            {isId
              ? "Paket Free permanen · Tanpa kartu pembayaran"
              : "Free tier included · No payment card required"}
          </span>
        </div>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        {isId ? "Sudah punya akun? " : "Already have an account? "}
        <Link href="/login" className="font-semibold text-link hover:underline">
          {isId ? "Masuk" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}
