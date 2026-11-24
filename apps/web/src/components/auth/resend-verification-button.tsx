"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function ResendVerificationButton({ email }: { email: string }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleResend() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage("Authentication service is not configured.");
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
        setMessage(
          error.status === 429
            ? "Please wait a moment before requesting another email."
            : error.message,
        );
        return;
      }
      setMessage("Verification email sent. Check your inbox.");
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
        {sending ? "Sending..." : "Resend verification email"}
      </button>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
