"use client";

import { useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const NOTICE_MS = 4000;

export function ResendVerificationButton({ email }: { email: string }) {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  function showMessage(next: string) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => {
      setMessage(null);
      timer.current = null;
    }, NOTICE_MS);
  }

  async function handleResend() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      showMessage(
        isId
          ? "Layanan autentikasi belum dikonfigurasi."
          : "Authentication service is not configured.",
      );
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
        },
      });
      if (error) {
        showMessage(
          error.status === 429
            ? isId
              ? "Mohon tunggu sebelum meminta kode lagi."
              : "Please wait before requesting another code."
            : isId
              ? "Kode belum terkirim. Coba lagi sebentar lagi."
              : "The code could not be sent. Please try again in a moment.",
        );
        return;
      }
      showMessage(
        isId
          ? "Kode baru terkirim. Periksa kotak masuk atau folder spam."
          : "A new code was sent. Check your inbox and spam folder.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleResend}
        disabled={sending}
        className="w-fit cursor-pointer rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {sending
          ? isId
            ? "Mengirim..."
            : "Sending..."
          : isId
            ? "Kirim ulang kode"
            : "Send a new code"}
      </button>
      {message && (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
