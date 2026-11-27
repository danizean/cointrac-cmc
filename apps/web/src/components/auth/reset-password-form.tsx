"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { EMAIL_OTP_LENGTH, normalizeEmailOtp, passwordFailureCopy, validatePasswordStrength } from "@/lib/auth-redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const NOTICE_MS = 4000;

type Notice = { tone: "error" | "success"; message: string };

export function ResetPasswordForm({
  configured,
  mode,
}: {
  configured: boolean;
  mode: "request" | "update";
}) {
  const router = useRouter();
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const [email, setEmail] = useState("");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [verified, setVerified] = useState(mode === "update");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);
  const justVerified = useRef(false);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!verified || justVerified.current) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled || data.user) return;
      document.cookie = "ct_recovery=; Path=/; Max-Age=0; SameSite=Lax";
      setVerified(false);
    });
    return () => {
      cancelled = true;
    };
  }, [verified]);

  function clearNotice() {
    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    setNotice(null);
  }

  function showNotice(next: Notice) {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice(next);
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, NOTICE_MS);
  }

  function recoveryRedirect() {
    return `${window.location.origin}/auth/callback?type=recovery&next=${encodeURIComponent("/reset-password?mode=update")}`;
  }

  async function handleRequestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    clearNotice();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError(isId ? "Masukkan alamat email yang valid." : "Enter a valid email address.");
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
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: recoveryRedirect(),
      });
      if (resetError) {
        setError(
          resetError.status === 429
            ? isId
              ? "Terlalu banyak permintaan reset. Mohon tunggu beberapa menit."
              : "Too many reset requests. Wait a few minutes before trying again."
            : isId
              ? "Kode reset belum terkirim. Coba lagi sebentar lagi."
              : "The reset code could not be sent. Please try again in a moment.",
        );
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
    clearNotice();
    const token = normalizeEmailOtp(otp);
    if (!token) {
      showNotice({
        tone: "error",
        message: isId ? "Masukkan kode 6 digit dari email." : "Enter the 6-digit code from the email.",
      });
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    setVerifying(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token,
        type: "recovery",
      });
      if (verifyError) {
        const lower = verifyError.message.toLowerCase();
        showNotice({
          tone: "error",
          message:
            lower.includes("rate limit") || verifyError.status === 429
              ? isId
                ? "Terlalu banyak percobaan. Mohon tunggu beberapa menit."
                : "Too many attempts. Please wait a few minutes."
              : isId
                ? "Kode tidak valid atau sudah kedaluwarsa. Kirim ulang kode, lalu coba lagi."
                : "That code is invalid or expired. Send a new code and try again.",
        });
        return;
      }
      justVerified.current = true;
      setVerified(true);
      document.cookie = "ct_recovery=1; Path=/; Max-Age=3600; SameSite=Lax";
    } finally {
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!pendingEmail) return;
    clearNotice();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    const { error: resendError } = await supabase.auth.resetPasswordForEmail(pendingEmail, {
      redirectTo: recoveryRedirect(),
    });
    if (resendError) {
      showNotice({
        tone: "error",
        message:
          resendError.status === 429
            ? isId
              ? "Mohon tunggu sebelum meminta kode lagi."
              : "Please wait before requesting another code."
            : isId
              ? "Kode baru belum terkirim. Coba lagi sebentar lagi."
              : "A new code could not be sent. Please try again in a moment.",
      });
      return;
    }
    setOtp("");
    showNotice({
      tone: "success",
      message: isId
        ? "Kode baru terkirim. Periksa kotak masuk atau folder spam Anda."
        : "A new code was sent. Check your inbox and spam folder.",
    });
  }

  async function handleUpdatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      setError(passwordFailureCopy(strength.code, isId));
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
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          isId
            ? "Kata sandi belum bisa diperbarui. Minta kode baru, lalu coba lagi."
            : "The password could not be updated. Request a new code and try again.",
        );
        return;
      }
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError(
          isId
            ? "Kata sandi sudah diperbarui, tetapi sesi belum bisa ditutup. Masuk lagi dengan kata sandi baru."
            : "Your password was updated, but the session could not be closed. Sign in with the new password.",
        );
        return;
      }
      document.cookie = "ct_recovery=; Path=/; Max-Age=0; SameSite=Lax";
      router.replace("/login?password_updated=1");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (!verified && pendingEmail) {
    return (
      <div className="ct-surface-featured ct-enter rounded-[18px] p-6 sm:p-8">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-positive/30 bg-positive/10 text-positive">
            <Mail className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              {isId ? "Masukkan kode reset" : "Enter your reset code"}
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {isId ? "Jika akun itu ada, kode 6 digit dikirim ke " : "If that account exists, a 6-digit code was sent to "}
              <span className="font-mono text-foreground">{pendingEmail}</span>.
            </p>
          </div>
        </div>

        {notice && (
          <div
            role={notice.tone === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              notice.tone === "error"
                ? "mt-4 flex items-start gap-2.5 rounded-[12px] border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-foreground"
                : "mt-4 flex items-start gap-2.5 rounded-[12px] border border-positive/30 bg-positive/10 p-3.5 text-xs text-foreground"
            }
          >
            {notice.tone === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden="true" />
            )}
            <span>{notice.message}</span>
          </div>
        )}

        <form onSubmit={handleVerify} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="reset-otp" className="mb-1.5 block text-xs font-semibold text-foreground">
              {isId ? "Kode verifikasi" : "Verification code"}
            </label>
            <input
              id="reset-otp"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={EMAIL_OTP_LENGTH}
              required
              value={otp}
              onChange={(event) => {
                clearNotice();
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
                ? "Lanjutkan"
                : "Continue"}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleResend()}
            className="tg-btn tg-btn-secondary inline-flex cursor-pointer text-xs"
          >
            {isId ? "Kirim ulang kode" : "Send a new code"}
          </button>
          <Link href="/login" className="text-xs font-semibold text-link hover:underline">
            {isId ? "Kembali ke halaman masuk" : "Back to sign in"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ct-enter space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-foreground sm:text-[28px]">
          {verified
            ? isId
              ? "Atur kata sandi baru"
              : "Set a new password"
            : isId
              ? "Reset kata sandi"
              : "Reset your password"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {verified
            ? isId
              ? "Pilih kata sandi baru minimal 12 karakter."
              : "Choose a strong new password (minimum 12 characters)."
            : isId
              ? "Masukkan email akun untuk menerima kode 6 digit."
              : "Enter your account email to receive a 6-digit code."}
        </p>
      </div>

      <form
        onSubmit={verified ? handleUpdatePassword : handleRequestReset}
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

        {verified ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-xs font-semibold text-foreground">
                {isId ? "Kata sandi baru" : "New password"}
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(event) => {
                    setError(null);
                    setPassword(event.target.value);
                  }}
                  placeholder={
                    isId ? "Min. 12 karakter (A-Z, a-z, 0-9)" : "Minimum 12 chars (A-Z, a-z, 0-9)"
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
                htmlFor="confirm-new-password"
                className="mb-1.5 block text-xs font-semibold text-foreground"
              >
                {isId ? "Konfirmasi kata sandi baru" : "Confirm new password"}
              </label>
              <div className="relative">
                <input
                  id="confirm-new-password"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  value={confirmPassword}
                  onChange={(event) => {
                    setError(null);
                    setConfirmPassword(event.target.value);
                  }}
                  placeholder={isId ? "Ulangi kata sandi baru" : "Repeat your new password"}
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
        ) : (
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-xs font-semibold text-foreground">
              {isId ? "Email kerja" : "Email address"}
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setError(null);
                setEmail(event.target.value);
              }}
              placeholder="name@company.com"
              className="min-h-11 w-full rounded-[10px] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-foreground placeholder:text-subtle-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !configured}
          className="tg-btn tg-btn-primary ct-btn-glow mt-6 flex min-h-11 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? isId
              ? "Mengirim..."
              : "Submitting..."
            : verified
              ? isId
                ? "Perbarui kata sandi"
                : "Update password"
              : isId
                ? "Kirim kode"
                : "Send code"}
        </button>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5 text-link" aria-hidden="true" />
          <span>
            {isId
              ? "Kode reset kedaluwarsa otomatis demi keamanan"
              : "Reset codes expire automatically for account safety"}
          </span>
        </div>
      </form>

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <Link href="/login" className="font-semibold text-link hover:underline">
          {isId ? "Kembali ke halaman masuk" : "Back to sign in"}
        </Link>
      </div>
    </div>
  );
}
