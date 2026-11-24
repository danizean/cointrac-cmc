"use client";

import { useState } from "react";
import { ApiNotice } from "@/components/api-notice";
import { useAppPreferences } from "@/components/app-preferences";
import { runIntelligenceTool } from "@/lib/api";
import { symbolList, validateToolInput } from "@/lib/tool-input";
import type { EvidenceEnvelope, ToolName } from "@/lib/types";
import { NAV_LABELS, workspaceCopy } from "@/lib/workspace-copy";
import { ResultStack } from "./result-stack";

const INPUT =
  "mt-1.5 w-full min-w-0 rounded-[10px] border border-border bg-background px-3 py-2 font-mono text-xs text-foreground";

export function AssetDesk() {
  const { locale } = useAppPreferences();
  const copy = workspaceCopy(locale);
  const [symbol, setSymbol] = useState("BTC");
  const [peers, setPeers] = useState("ETH, SOL");
  const [quote, setQuote] = useState("USD");
  const [running, setRunning] = useState<ToolName | null>(null);
  const [error, setError] = useState<{ status: number; message: string; retryAfterSeconds?: number } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<EvidenceEnvelope[]>([]);

  async function run(tool: ToolName) {
    const quoteCurrency = quote.trim().toUpperCase() || "USD";
    const params =
      tool === "analyze_asset"
        ? { quote_currency: quoteCurrency, symbol: symbol.trim().toUpperCase() }
        : {
            quote_currency: quoteCurrency,
            symbols: symbolList(tool === "analyze_momentum" && !peers.trim() ? symbol : `${symbol}, ${peers}`),
          };
    const invalid = validateToolInput(tool, params);
    if (invalid) {
      setValidation(invalid);
      return;
    }
    setValidation(null);
    setRunning(tool);
    setError(null);
    const result = await runIntelligenceTool(tool, params);
    setRunning(null);
    if (!result.ok) {
      setError({ status: result.status, message: result.message, retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    setEnvelopes([result.data]);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{NAV_LABELS[locale].assets}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.assetsBody}</p>
      </header>
      <form
        className="grid gap-3 border-y border-border py-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!running) void run("analyze_asset");
        }}
      >
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Symbol
          <input className={INPUT} value={symbol} onChange={(event) => setSymbol(event.target.value)} />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Peers
          <input className={INPUT} value={peers} onChange={(event) => setPeers(event.target.value)} />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Quote
          <input className={INPUT} value={quote} onChange={(event) => setQuote(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-3">
          <button type="submit" disabled={running !== null} className="tg-btn tg-btn-primary inline-flex min-h-11 disabled:opacity-60">
            {running === "analyze_asset" ? copy.running : "analyze_asset"}
          </button>
          <button
            type="button"
            disabled={running !== null}
            onClick={() => void run("analyze_momentum")}
            className="tg-btn inline-flex min-h-11 border border-border px-3 text-sm disabled:opacity-60"
          >
            {running === "analyze_momentum" ? copy.running : "analyze_momentum"}
          </button>
          <button
            type="button"
            disabled={running !== null}
            onClick={() => void run("compare_assets")}
            className="tg-btn inline-flex min-h-11 border border-border px-3 text-sm disabled:opacity-60"
          >
            {running === "compare_assets" ? copy.running : "compare_assets"}
          </button>
        </div>
      </form>
      {validation ? (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      ) : null}
      {error ? <ApiNotice status={error.status} message={error.message} retryAfterSeconds={error.retryAfterSeconds} /> : null}
      <ResultStack envelopes={envelopes} />
    </div>
  );
}
