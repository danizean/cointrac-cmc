"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useAppPreferences } from "./app-preferences";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label, className = "" }: CopyButtonProps) {
  const { t } = useAppPreferences();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 font-mono text-[11px] font-medium text-foreground shadow-xs transition-colors duration-200 hover:border-primary/40 hover:bg-card-elevated ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
          <span className="text-positive">{t.common.copied}</span>
        </>
      ) : (
        <>
          <Copy
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <span>{label ?? t.common.copy}</span>
        </>
      )}
    </button>
  );
}
