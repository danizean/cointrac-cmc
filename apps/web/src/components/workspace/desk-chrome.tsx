"use client";

import { Clock, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import { Button, DeskSkeleton, EmptyState } from "@/components/ui/primitives";
import { formatRelativeCacheAge } from "@/lib/desk-cache";
import type { EvidenceEnvelope } from "@/lib/types";
import { workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

export const QUICK_QUOTES = ["USD", "EUR", "BTC"] as const;

export interface DeskError {
  status: number;
  message: string;
  retryAfterSeconds?: number;
}

export function DeskHeaderActions({
  quote,
  running,
  onSelectQuote,
  onRefresh,
  refreshLabel,
}: {
  quote: string;
  running: boolean;
  onSelectQuote: (nextQuote: string) => void;
  onRefresh: () => void;
  refreshLabel?: string;
}) {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div
        role="group"
        aria-label={locale === "id" ? "Mata uang" : "Currency"}
        className="inline-flex h-9 items-center rounded-full border border-border bg-card/80 p-0.5"
      >
        {QUICK_QUOTES.map((q) => {
          const active = quote.trim().toUpperCase() === q;
          return (
            <button
              key={q}
              type="button"
              disabled={running}
              onClick={() => onSelectQuote(q)}
              className={`min-h-7 cursor-pointer rounded-full px-3 font-mono text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {q}
            </button>
          );
        })}
      </div>

      <Button
        type="button"
        variant="primary"
        size="md"
        loading={running}
        onClick={onRefresh}
        className="ct-btn-glow"
      >
        {!running ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        <span>{running ? copy.running : (refreshLabel ?? copy.refresh)}</span>
      </Button>
    </div>
  );
}

export function DeskResultArea({
  running,
  error,
  validation,
  envelopes,
  cachedAt,
  onRetry,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  running: boolean;
  error: DeskError | null;
  validation?: string | null;
  envelopes: EvidenceEnvelope[];
  cachedAt: number | null;
  onRetry: () => void;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: ReactNode;
}) {
  const { locale } = useAppPreferences();
  const ageLabel = formatRelativeCacheAge(cachedAt, locale);

  return (
    <div className="space-y-4">
      {validation ? (
        <p
          role="alert"
          className="rounded-[10px] border border-destructive/40 bg-destructive-soft px-4 py-3 text-xs font-medium text-destructive"
        >
          {validation}
        </p>
      ) : null}

      {error ? (
        <ApiNotice
          status={error.status}
          message={error.message}
          retryAfterSeconds={error.retryAfterSeconds}
          onRetry={onRetry}
        />
      ) : null}

      {running ? (
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-border/40">
          <div className="ct-progress-bar h-full w-2/5 rounded-full bg-primary" />
        </div>
      ) : null}

      {running && envelopes.length === 0 ? <DeskSkeleton /> : null}

      {!running && !error && envelopes.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : null}

      {envelopes.length > 0 && ageLabel ? (
        <div className="flex items-center justify-end gap-1.5 font-mono text-[11px] text-subtle-foreground">
          <Clock className="h-3 w-3" aria-hidden="true" />
          <span>
            {locale === "id" ? `Disimpan di sesi · ${ageLabel}` : `Session snapshot · ${ageLabel}`}
          </span>
        </div>
      ) : null}

      <ResultStack envelopes={envelopes} />
    </div>
  );
}
