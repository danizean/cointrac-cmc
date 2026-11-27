"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { EMAIL_OTP_LENGTH, normalizeEmailOtp, sanitizeRedirectPath } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ERROR_MESSAGES: Record<string, { en: string; id: string }> = {
  auth_not_configured: {
    en: "Authentication service is not configured for this environment.",
    id: "Layanan autentikasi belum dikonfigurasi untuk environment ini.",
  },
  callback_exchange_failed: {
    en: "Authentication link could not be verified or has expired.",
    id: "Tautan autentikasi tidak dapat diverifikasi atau sudah kedaluwarsa.",
  },
  verification_link_invalid: {
    en: "Email verification or reset link is invalid or expired.",
    id: "Tautan verifikasi email atau reset kata sandi tidak valid atau kedaluwarsa.",
  },
  missing_auth_parameters: {
    en: "Invalid authentication callback parameters.",
    id: "Parameter callback autentikasi tidak valid.",
  },
  email_not_confirmed: {
    en: "Verify your email before signing in. Enter your email and the 6-digit code.",
    id: "Verifikasi email sebelum masuk. Masukkan email dan kode 6 digit.",
  },
};

export function LoginForm({
  configured,
  nextPath,
  initialError,
  signedOut,
  passwordUpdated,
}: {
  configured: boolean;
  nextPath: string;
  initialError?: string;
  signedOut?: boolean;
  passwordUpdated?: boolean;
}) {
  const router = useRouter();
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const safeNext = sanitizeRedirectPath(nextPath, "/app");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordUpdated, setShowPasswordUpdated] = useState(Boolean(passwordUpdated));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!initialError) return null;
    const mapped = ERROR_MESSAGES[initialError];
    if (mapped) return isId ? mapped.id : mapped.en;
    return isId ? "Gagal menyelesaikan proses masuk." : "Unable to complete sign in.";
  });
  const [needsVerification, setNeedsVerification] = useState(
    initialError === "email_not_confirmed",
  );
  const [otp, setOtp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const resendTimer = useRef<number | null>(null);
  const errorTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resendTimer.current !== null) window.clearTimeout(resendTimer.current);
      if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    };
  }, []);

  function clearResendStatus() {
    if (resendTimer.current !== null) {
      window.clearTimeout(resendTimer.current);
      resendTimer.current = null;
    }
    setResendStatus(null);
  }

  function showTemporaryError(message: string) {
    if (errorTimer.current !== null) window.clearTimeout(errorTimer.current);
    setError(message);
    errorTimer.current = window.setTimeout(() => {
      setError(null);
      errorTimer.current = null;
    }, 4000);
  }

  function clearTimedError() {
    if (errorTimer.current === null) return;
    window.clearTimeout(errorTimer.current);
    errorTimer.current = null;
    setError(null);
  }

  function showResendStatus(message: string) {
    if (resendTimer.current !== null) window.clearTimeout(resendTimer.current);
    setResendStatus(message);
    resendTimer.current = window.setTimeout(() => {
      setResendStatus(null);
      resendTimer.current = null;
    }, 4000);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (errorTimer.current !== null) {
      window.clearTimeout(errorTimer.current);
      errorTimer.current = null;
    }
    setError(null);
    setShowPasswordUpdated(false);
    setNeedsVerification(false);
    clearResendStatus();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setError(
        isId
          ? "Masukkan alamat email dan kata sandi Anda."
          : "Enter both your email address and password.",
      );
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
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) {
        const lower = signInError.message.toLowerCase();
        if (lower.includes("email not confirmed")) {
          setNeedsVerification(true);
          setError(
            isId
              ? "Verifikasi alamat email Anda sebelum masuk."
              : "Verify your email address before signing in.",
          );
        } else if (lower.includes("rate limit") || signInError.status === 429) {
          setError(
            isId
              ? "Terlalu banyak percobaan masuk. Tunggu beberapa menit lalu coba lagi."
              : "Too many sign-in attempts. Wait a few minutes and try again.",
          );
        } else {
          setError(
            isId
              ? "Email atau kata sandi tidak cocok."
              : "Invalid email or password.",
          );
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
    clearResendStatus();
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
      showResendStatus(
        resendErr.status === 429
          ? isId
            ? "Mohon tunggu sebelum mengirim ulang email verifikasi."
            : "Please wait before requesting another verification email."
          : resendErr.message,
      );
      return;
    }
    setOtp("");
    if (errorTimer.current !== null) {
      window.clearTimeout(errorTimer.current);
      errorTimer.current = null;
    }
    setError(null);
    showResendStatus(
      isId
        ? "Kode baru terkirim. Silakan cek kotak masuk Anda."
        : "A new code was sent. Check your inbox.",
    );
  }

  async function handleVerifyOtp() {
    const normalizedEmail = email.trim().toLowerCase();
    const token = normalizeEmailOtp(otp);
    clearResendStatus();
    if (!normalizedEmail || !token) {
      setError(isId ? "Masukkan kode 6 digit dari email." : "Enter the 6-digit code from the email.");
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token,
        type: "signup",
      });
      if (verifyError) {
        const lower = verifyError.message.toLowerCase();
        showTemporaryError(
          lower.includes("rate limit") || verifyError.status === 429
            ? isId
              ? "Terlalu banyak percobaan. Mohon tunggu beberapa menit."
              : "Too many attempts. Please wait a few minutes."
            : isId
              ? "Kode tidak valid atau sudah kedaluwarsa."
              : "That code is invalid or expired.",
        );
        return;
      }
      router.replace(safeNext);
      router.refresh();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="ct-enter space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[28px]">
          {isId ? "Masuk ke CoinTrac" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {isId
            ? "Masuk untuk mengakses workspace Market Intelligence & MCP Anda."
            : "Sign in to access your Market Intelligence & MCP workspace."}
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="ct-surface-featured rounded-[18px] p-6 sm:p-8"
        noValidate
      >
        {showPasswordUpdated && !error && (
          <div
            role="status"
            className="mb-5 flex items-start gap-2 rounded-[12px] border border-positive/30 bg-positive/10 p-3 text-xs text-foreground"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            <span>
              {isId
                ? "Kata sandi sudah diperbarui. Masuk dengan kata sandi baru."
                : "Your password was updated. Sign in with the new password."}
            </span>
          </div>
        )}

        {signedOut && !error && !showPasswordUpdated && (
          <div className="mb-5 flex items-center gap-2 rounded-[12px] border border-positive/30 bg-positive/10 p-3 text-xs text-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            <span>
              {isId ? "Anda telah keluar dari sesi." : "You have been signed out."}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 flex items-start gap-2 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {needsVerification && (
          <div className="mb-5 space-y-3">
            {resendStatus && (
              <div
                role="status"
                aria-live="polite"
                className="flex items-start gap-2 rounded-[12px] border border-positive/30 bg-positive/10 p-3.5 text-xs text-foreground"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
                <span>{resendStatus}</span>
              </div>
            )}
            <div className="space-y-2">
              <label htmlFor="login-otp" className="block text-[11px] font-semibold text-foreground">
                {isId ? "Kode 6 digit" : "6-digit code"}
              </label>
              <input
                id="login-otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={EMAIL_OTP_LENGTH}
                value={otp}
                onChange={(event) => {
                  clearTimedError();
                  clearResendStatus();
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleVerifyOtp();
                  }
                }}
                placeholder="000000"
                className="min-h-10 w-full rounded-[8px] border border-border bg-input-bg px-3 py-2 text-center font-mono tracking-[0.22em] text-foreground focus:border-primary focus:outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleVerifyOtp()}
                  disabled={verifying || normalizeEmailOtp(otp) === null}
                  className="cursor-pointer rounded-[8px] bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {verifying
                    ? isId
                      ? "Memeriksa..."
                      : "Checking..."
                    : isId
                      ? "Konfirmasi kode"
                      : "Confirm code"}
                </button>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  className="cursor-pointer rounded-[8px] border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-primary/40"
                >
                  {isId ? "Kirim ulang kode" : "Send a new code"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block text-xs font-semibold text-foreground"
            >
              {isId ? "Email kerja" : "Email address"}
            </label>
            <input
              id="login-email"
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
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="login-password"
                className="text-xs font-semibold text-foreground"
              >
                {isId ? "Kata sandi" : "Password"}
              </label>
              <Link
                href="/reset-password"
                className="inline-flex min-h-6 items-center text-xs font-medium text-link hover:underline"
              >
                {isId ? "Lupa kata sandi?" : "Forgot password?"}
              </Link>
            </div>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setShowPasswordUpdated(false);
                  setPassword(e.target.value);
                }}
                placeholder={isId ? "Masukkan kata sandi" : "Enter your password"}
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
        </div>

        <button
          type="submit"
          disabled={submitting || !configured}
          className="tg-btn tg-btn-primary ct-btn-glow mt-6 flex min-h-11 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? isId
              ? "Sedang masuk..."
              : "Signing in..."
            : isId
              ? "Lanjutkan ke Workspace"
              : "Sign in"}
        </button>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
          <span>
            {isId
              ? "Sesi terenkripsi · Verifikasi JWT sisi server"
              : "Verified session · Server-side JWT enforcement"}
          </span>
        </div>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        {isId ? "Belum punya akun? " : "Don\u2019t have an account? "}
        <Link href="/signup" className="font-semibold text-link hover:underline">
          {isId ? "Daftar gratis" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}
