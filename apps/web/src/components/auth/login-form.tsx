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
import { useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { sanitizeRedirectPath } from "@/lib/auth-redirect";
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
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const safeNext = sanitizeRedirectPath(nextPath, "/app");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!initialError) return null;
    const mapped = ERROR_MESSAGES[initialError];
    if (mapped) return isId ? mapped.id : mapped.en;
    return isId ? "Gagal menyelesaikan proses masuk." : "Unable to complete sign in.";
  });
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendStatus(null);

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
          ? isId
            ? "Mohon tunggu sebelum mengirim ulang email verifikasi."
            : "Please wait before requesting another verification email."
          : resendErr.message,
      );
      return;
    }
    setResendStatus(
      isId
        ? "Email verifikasi terkirim. Silakan cek kotak masuk Anda."
        : "Verification email sent. Check your inbox.",
    );
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
        {signedOut && !error && (
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
            className="mb-5 flex flex-col gap-2 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{error}</span>
            </div>
            {needsVerification && (
              <button
                type="button"
                onClick={handleResendVerification}
                className="w-fit cursor-pointer rounded-[8px] border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-primary/40"
              >
                {isId ? "Kirim ulang email verifikasi" : "Resend verification email"}
              </button>
            )}
            {resendStatus && (
              <span className="text-[11px] text-muted-foreground">{resendStatus}</span>
            )}
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
                onChange={(e) => setPassword(e.target.value)}
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
