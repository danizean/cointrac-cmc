"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CoinTracMark } from "@/components/site-header";
import { useAppPreferences } from "@/components/app-preferences";

const DISMISS_KEY = "ct-demo-dock";
const DISMISS_EVENT = "ct-demo-dismissed";

function subscribeDismissed(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(DISMISS_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(DISMISS_EVENT, callback);
  };
}

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

type DemoFailure = "unavailable" | "unconfirmed" | "failed";

export function DemoLauncher() {
  const router = useRouter();
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const titleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const storedDismissed = useSyncExternalStore(
    subscribeDismissed,
    readDismissed,
    () => false,
  );
  const [hiddenOverride, setHiddenOverride] = useState(false);
  const [open, setOpen] = useState(false);
  const [entering, setEntering] = useState(false);
  const [failure, setFailure] = useState<DemoFailure | null>(null);
  const hidden = storedDismissed || hiddenOverride;

  useEffect(() => {
    if (!open) return;
    enterRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        launcherRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;

  function dismiss() {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
      window.dispatchEvent(new Event(DISMISS_EVENT));
    } catch {
      // Ignore storage failures and just close the panel.
    }
    setHiddenOverride(true);
  }

  async function enterDemo() {
    setEntering(true);
    setFailure(null);
    try {
      const response = await fetch("/api/auth/demo", { method: "POST", cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { reason?: DemoFailure } | null;
      if (!response.ok) {
        setFailure(payload?.reason ?? "failed");
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch {
      setFailure("failed");
    } finally {
      setEntering(false);
    }
  }

  const failureCopy =
    failure === "unconfirmed"
      ? isId
        ? "Akun demo belum dikonfirmasi."
        : "The demo account is not confirmed yet."
      : failure === "unavailable"
        ? isId
          ? "Demo belum dikonfigurasi di server ini."
          : "Demo sign-in is not configured on this server."
        : isId
          ? "Demo belum bisa dibuka. Coba lagi sebentar lagi."
          : "The demo workspace could not be opened. Try again in a moment.";

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-max max-w-[min(100vw-2rem,22rem)] flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="ct-surface-featured pointer-events-auto w-[min(100vw-2rem,22rem)] rounded-[18px] p-4 shadow-[0_18px_50px_-24px_rgba(8,11,18,0.45)]"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-link">
            {isId ? "Demo juri" : "Judge demo"}
          </p>
          <h2 id={titleId} className="mt-1 text-base font-semibold tracking-[-0.02em] text-foreground">
            {isId ? "Lihat workspace yang hidup" : "Open a live workspace"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {isId
              ? "Masuk ke akun demo CoinTrac yang sudah disiapkan. Tidak perlu mendaftar."
              : "Enter the prepared CoinTrac demo account. No signup required."}
          </p>
          {failure && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {failureCopy}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <button
              ref={enterRef}
              type="button"
              onClick={() => void enterDemo()}
              disabled={entering}
              className="tg-btn tg-btn-primary ct-btn-glow min-h-11 flex-1 cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {entering
                ? isId
                  ? "Membuka..."
                  : "Opening..."
                : isId
                  ? "Masuk ke demo"
                  : "Enter demo workspace"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                launcherRef.current?.focus();
              }}
              className="min-h-11 cursor-pointer rounded-[10px] px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              {isId ? "Tutup" : "Close"}
            </button>
          </div>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? titleId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="ct-btn-glow pointer-events-auto inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full bg-primary py-1 pl-1 pr-4 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white shadow-sm">
          <CoinTracMark className="h-7 w-7" />
        </span>
        <span>{isId ? "Coba CoinTrac?" : "Try CoinTrac?"}</span>
      </button>
      {open && (
        <button
          type="button"
          onClick={dismiss}
          className="pointer-events-auto cursor-pointer text-[11px] font-medium text-subtle-foreground hover:text-foreground"
        >
          {isId ? "Sembunyikan untuk sesi ini" : "Hide for this session"}
        </button>
      )}
    </div>
  );
}
