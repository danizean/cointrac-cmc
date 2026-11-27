"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Mail,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { EMAIL_OTP_LENGTH, normalizeEmailOtp, passwordFailureCopy, validatePasswordStrength } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const OTP_NOTICE_MS = 4000;

type OtpNotice = { tone: "error" | "success"; message: string };

export function SignupForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpNotice, setOtpNotice] = useState<OtpNotice | null>(null);
  const otpNoticeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (otpNoticeTimer.current !== null) window.clearTimeout(otpNoticeTimer.current);
    };
  }, []);

  function clearOtpNotice() {
    if (otpNoticeTimer.current !== null) {
      window.clearTimeout(otpNoticeTimer.current);
      otpNoticeTimer.current = null;
    }
    setOtpNotice(null);
  }

  function showOtpNotice(notice: OtpNotice) {
    if (otpNoticeTimer.current !== null) window.clearTimeout(otpNoticeTimer.current);
    setOtpNotice(notice);
    otpNoticeTimer.current = window.setTimeout(() => {
      setOtpNotice(null);
      otpNoticeTimer.current = null;
    }, OTP_NOTICE_MS);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    clearOtpNotice();

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
        passwordFailureCopy(
          strength.code,
          isId,
        ),
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
          setError(
            isId
              ? "Pendaftaran belum bisa diselesaikan. Coba lagi sebentar lagi."
              : "The account could not be created. Please try again in a moment.",
          );
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

      if (data.session) {
        router.replace("/app");
        router.refresh();
        return;
      }

      setOtp("");
      setPendingEmail(normalizedEmail);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingEmail) return;
    clearOtpNotice();
    const token = normalizeEmailOtp(otp);
    if (!token) {
      showOtpNotice({
        tone: "error",
        message: isId ? "Masukkan kode 6 digit dari email." : "Enter the 6-digit code from the email.",
      });
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      showOtpNotice({
        tone: "error",
        message: isId
          ? "Layanan autentikasi belum dikonfigurasi untuk environment ini."
          : "Authentication service is not configured for this environment.",
      });
      return;
    }
    setVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "signup",
      });
      if (verifyError) {
        const lower = verifyError.message.toLowerCase();
        if (lower.includes("rate limit") || verifyError.status === 429) {
          showOtpNotice({
            tone: "error",
            message: isId
              ? "Terlalu banyak percobaan. Mohon tunggu beberapa menit."
              : "Too many attempts. Please wait a few minutes.",
          });
        } else if (lower.includes("expired") || lower.includes("invalid")) {
          showOtpNotice({
            tone: "error",
            message: isId
              ? "Kode tidak valid atau sudah kedaluwarsa. Kirim ulang kode, lalu coba lagi."
              : "That code is invalid or expired. Send a new code and try again.",
          });
        } else {
          showOtpNotice({
            tone: "error",
            message: isId
              ? "Kode belum bisa dikonfirmasi. Coba lagi atau buka tautan di email."
              : "The code could not be confirmed. Try again or open the link in the email.",
          });
        }
        return;
      }
      router.replace("/app");
      router.refresh();
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail) return;
    clearOtpNotice();
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
      showOtpNotice({
        tone: "error",
        message:
          resendError.status === 429
            ? isId
              ? "Mohon tunggu sebelum meminta email verifikasi lagi."
              : "Please wait before requesting another verification email."
            : resendError.message,
      });
      return;
    }
    setOtp("");
    showOtpNotice({
      tone: "success",
      message: isId
        ? "Kode baru terkirim. Periksa kotak masuk atau folder spam Anda."
        : "A new code was sent. Check your inbox and spam folder.",
    });
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
              {isId ? "Masukkan kode email" : "Enter your email code"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {isId ? "Kode 6 digit dikirim ke " : "A 6-digit code was sent to "}
              <span className="font-mono text-foreground">{pendingEmail}</span>.{" "}
              {isId
                ? "Tautan di email yang sama juga tetap membuka akun."
                : "The link in the same email still confirms the account."}
            </p>
          </div>
        </div>

        {otpNotice && (
          <div
            role={otpNotice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              otpNotice.tone === "error"
                ? "mt-4 flex items-start gap-2.5 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
                : "mt-4 flex items-start gap-2.5 rounded-[12px] border border-positive/30 bg-positive/10 p-3.5 text-xs text-foreground"
            }
          >
            {otpNotice.tone === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            )}
            <span>{otpNotice.message}</span>
          </div>
        )}

        <form onSubmit={handleVerify} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="signup-otp" className="mb-1.5 block text-xs font-semibold text-foreground">
              {isId ? "Kode verifikasi" : "Verification code"}
            </label>
            <input
              id="signup-otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={EMAIL_OTP_LENGTH}
              required
              value={otp}
              onChange={(event) => {
                clearOtpNotice();
                setOtp(event.target.value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH));
              }}
              placeholder="000000"
              className="min-h-11 w-full rounded-[10px] border border-border bg-input-bg px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.22em] text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={verifying || normalizeEmailOtp(otp) === null}
            className="tg-btn tg-btn-primary ct-btn-glow flex min-h-11 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying
              ? isId
                ? "Memeriksa kode..."
                : "Checking code..."
              : isId
                ? "Konfirmasi kode"
                : "Confirm code"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleResend}
            className="tg-btn tg-btn-secondary inline-flex cursor-pointer text-xs"
          >
            {isId ? "Kirim ulang kode" : "Send a new code"}
          </button>
          <Link href="/login" className="text-xs font-semibold text-link hover:underline">
            {isId ? "Sudah punya akun? Masuk" : "Already confirmed? Sign in"}
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
