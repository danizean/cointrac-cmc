"use client";

import {
  ArrowUpRight,
  Bot,
  Clock,
  Cpu,
  History,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppPreferences } from "@/components/app-preferences";
import { StatusIndicator } from "@/components/status-badges";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  PageHeader,
  Skeleton,
} from "@/components/ui/primitives";
import {
  fetchAiStatus,
  sendAiChat,
  type AIChatResponsePayload,
  type AIQuotaSnapshot,
  type AIUsageLogItem,
} from "@/lib/control-plane-api";

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  meta?: AIChatResponsePayload;
}

const SUGGESTED_PROMPTS: Array<{
  id: string;
  labelEn: string;
  labelId: string;
  promptEn: string;
  promptId: string;
}> = [
  {
    id: "macro",
    labelEn: "Macro & Market Regime",
    labelId: "Ringkasan Pasar & Rezim",
    promptEn:
      "Give me a crisp market briefing: current macro regime, BTC/ETH dominance, Fear & Greed, and top-50 breadth.",
    promptId:
      "Berikan briefing pasar singkat: kondisi rezim makro saat ini, dominasi BTC/ETH, Fear & Greed, dan kekuatan breadth Top-50.",
  },
  {
    id: "gems",
    labelEn: "Top Hidden Gems",
    labelId: "Hidden Gem Terbaik",
    promptEn:
      "List my top Hidden Gem candidates across EARLY and CONFIRMED tracks with scores, key drivers, and risk notes.",
    promptId:
      "Tampilkan kandidat Hidden Gem terbaik saya di track EARLY dan CONFIRMED beserta skor, pendorong utama, dan catatan risikonya.",
  },
  {
    id: "movers",
    labelEn: "Anti-Chase Movers & Anomalies",
    labelId: "Movers & Anomali Volume",
    promptEn:
      "Scan anti-chase momentum movers and check any unusual volume-to-mcap anomalies or BTC divergences right now.",
    promptId:
      "Pindai penggerak pasar dengan filter anti-FOMO dan cek anomali lonjakan volume atau divergensi BTC saat ini.",
  },
  {
    id: "majors",
    labelEn: "Compare BTC, ETH, SOL",
    labelId: "Bandingkan BTC, ETH, SOL",
    promptEn:
      "Compare BTC, ETH, and SOL side-by-side on liquidity, momentum, RS vs BTC, and derivatives stress.",
    promptId:
      "Bandingkan BTC, ETH, dan SOL dari sisi likuiditas, momentum, kekuatan relatif vs BTC, dan tekanan derivatif.",
  },
];

function renderFormattedLine(line: string, keyPrefix: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b-${idx}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={`${keyPrefix}-c-${idx}`}
          className="rounded-[5px] border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-link"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${idx}`}>{part}</span>;
  });
}

function FormattedAnswer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, bIdx) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l) || /^\s*\d+\.\s+/.test(l));
        if (isList) {
          return (
            <ul key={`blk-${bIdx}`} className="space-y-1.5 pl-4">
              {lines.map((line, lIdx) => {
                const cleaned = line.replace(/^\s*(?:[-*•]|\d+\.)\s+/, "");
                return (
                  <li key={`li-${bIdx}-${lIdx}`} className="list-disc marker:text-link">
                    {renderFormattedLine(cleaned, `${bIdx}-${lIdx}`)}
                  </li>
                );
              })}
            </ul>
          );
        }
        return (
          <div key={`p-${bIdx}`} className="space-y-1">
            {lines.map((line, lIdx) => {
              if (/^#{1,3}\s+/.test(line)) {
                const heading = line.replace(/^#{1,3}\s+/, "");
                return (
                  <p key={`h-${bIdx}-${lIdx}`} className="font-semibold text-foreground">
                    {renderFormattedLine(heading, `${bIdx}-h-${lIdx}`)}
                  </p>
                );
              }
              return (
                <p key={`ln-${bIdx}-${lIdx}`}>{renderFormattedLine(line, `${bIdx}-${lIdx}`)}</p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function CoinTracAIConsole() {
  const { locale } = useAppPreferences();
  const isId = locale === "id";

  const [quota, setQuota] = useState<AIQuotaSnapshot | null>(null);
  const [recentLogs, setRecentLogs] = useState<AIUsageLogItem[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<{ status: number; message: string } | null>(null);

  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<{ status: number; message: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const turnSeqRef = useRef(0);

  const loadStatus = useCallback(async () => {
    const res = await fetchAiStatus();
    setStatusLoading(false);
    if (res.ok) {
      setQuota(res.data.quota);
      setRecentLogs(res.data.recent_logs);
      setStatusError(null);
    } else {
      setStatusError({ status: res.status, message: res.message });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAiStatus().then((res) => {
      if (!active) return;
      setStatusLoading(false);
      if (res.ok) {
        setQuota(res.data.quota);
        setRecentLogs(res.data.recent_logs);
      } else {
        setStatusError({ status: res.status, message: res.message });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(promptText?: string) {
    const raw = (promptText ?? input).trim();
    if (!raw || sending) return;

    turnSeqRef.current += 1;
    const userTurn: ChatTurn = {
      id: `u_${turnSeqRef.current}`,
      role: "user",
      content: raw,
    };
    const nextTurns = [...turns, userTurn];
    setTurns(nextTurns);
    if (!promptText) setInput("");
    setChatError(null);
    setSending(true);

    const apiMessages = nextTurns.slice(-10).map((t) => ({
      role: t.role,
      content: t.content,
    }));

    const res = await sendAiChat({
      messages: apiMessages,
      locale,
    });
    setSending(false);

    if (!res.ok) {
      setChatError({ status: res.status, message: res.message });
      void loadStatus();
      return;
    }

    turnSeqRef.current += 1;
    const aiTurn: ChatTurn = {
      id: `a_${turnSeqRef.current}`,
      role: "assistant",
      content: res.data.answer,
      meta: res.data,
    };
    setTurns((prev) => [...prev, aiTurn]);
    setQuota(res.data.quota);
    void loadStatus();
    window.requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  const aiReady = quota
    ? quota.ai_enabled && quota.user_ai_enabled && quota.key_configured
    : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="CoinTrac AI"
        description={
          isId
            ? "Analis pasar presisi berbasis Muse Spark 1.3 dengan tool calling deterministik CoinTrac dan sitasi bukti teraudit."
            : "Precision crypto intelligence analyst powered by Muse Spark 1.3 with deterministic CoinTrac tool calling and cited evidence."
        }
        actions={
          turns.length > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                setTurns([]);
                setChatError(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{isId ? "Percakapan Baru" : "New Thread"}</span>
            </Button>
          ) : undefined
        }
      />

      {statusError ? (
        <ErrorNotice
          status={statusError.status}
          message={statusError.message}
          onRetry={() => void loadStatus()}
        />
      ) : null}

      {/* Compact Live Quota & Model Status Strip */}
      <Card className="ct-surface-featured flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        {statusLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : quota ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-foreground">
                <Cpu className="h-4 w-4 text-link" aria-hidden="true" />
                <span>{quota.model}</span>
              </span>
              {aiReady ? (
                <StatusIndicator state="CONNECTED" label="READY" />
              ) : !quota.key_configured ? (
                <StatusIndicator state="STANDBY" label={isId ? "API KEY KOSONG" : "KEY MISSING"} />
              ) : (
                <StatusIndicator state="STANDBY" label={isId ? "DINONAKTIFKAN" : "PAUSED"} />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
              <span className="text-muted-foreground">
                {isId ? "Laju:" : "Rate:"}{" "}
                <strong className="text-foreground">
                  {quota.remaining_this_minute}/{quota.rate_limit_per_min}
                </strong>{" "}
                / min
              </span>
              <span className="text-muted-foreground">
                {isId ? "Harian:" : "Daily:"}{" "}
                <strong className="text-foreground">
                  {quota.remaining_today_requests}/{quota.daily_requests_limit}
                </strong>{" "}
                req
              </span>
              <span className="text-muted-foreground">
                {isId ? "Token:" : "Tokens:"}{" "}
                <strong className="text-foreground">
                  {quota.remaining_today_tokens.toLocaleString()}
                </strong>{" "}
                {isId ? "sisa" : "left"}
              </span>
            </div>
          </>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Primary Conversation Workspace */}
        <div className="space-y-4">
          {turns.length === 0 ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={sending || (quota !== null && !aiReady)}
                    onClick={() => void handleSubmit(isId ? item.promptId : item.promptEn)}
                    className="ct-surface-card group flex cursor-pointer flex-col justify-between gap-2 rounded-[14px] p-4 text-left transition-all hover:border-primary/45 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground group-hover:text-link">
                        <Sparkles className="h-3.5 w-3.5 text-link" aria-hidden="true" />
                        <span>{isId ? item.labelId : item.labelEn}</span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-subtle-foreground group-hover:text-link" />
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {isId ? item.promptId : item.promptEn}
                    </p>
                  </button>
                ))}
              </div>

              <EmptyState
                icon={<Bot className="h-5 w-5 text-link" aria-hidden="true" />}
                title={isId ? "Tanyakan apa saja soal pasar kripto" : "Ask CoinTrac AI anything"}
                description={
                  isId
                    ? "Setiap jawaban mengambil angka langsung dari tool deterministik CoinTrac dan menyertakan evidence_id — nol halusinasi."
                    : "Every answer queries CoinTrac deterministic market tools and cites verified evidence_id references."
                }
              />
            </div>
          ) : (
            <div className="space-y-4">
              {turns.map((turn) =>
                turn.role === "user" ? (
                  <div key={turn.id} className="flex justify-end">
                    <div className="max-w-2xl rounded-[14px] border border-primary/40 bg-primary/12 px-4 py-3 text-sm text-foreground">
                      {turn.content}
                    </div>
                  </div>
                ) : (
                  <Card key={turn.id} className="ct-surface-featured space-y-4 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
                      <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-link">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>CoinTrac AI · {turn.meta?.model ?? "muse-spark-1.3"}</span>
                      </span>
                      {turn.meta ? (
                        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-subtle-foreground">
                          {turn.meta.cache_hit ? (
                            <Badge tone="info">CACHED · 0 TOKENS</Badge>
                          ) : (
                            <span>{turn.meta.usage.total_tokens.toLocaleString()} tok</span>
                          )}
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" aria-hidden="true" />
                            {turn.meta.latency_ms} ms
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <FormattedAnswer text={turn.content} />

                    {turn.meta && (turn.meta.tools_used.length > 0 || turn.meta.evidence_refs.length > 0) ? (
                      <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                        {turn.meta.tools_used.map((tool) => (
                          <Badge key={tool} tone="neutral">
                            {tool}
                          </Badge>
                        ))}
                        {turn.meta.evidence_refs.map((ev) => (
                          <Link
                            key={ev.evidence_id}
                            href={`/app/evidence?id=${encodeURIComponent(ev.evidence_id)}`}
                            className="inline-flex items-center gap-1 rounded-full border border-positive/35 bg-positive-soft px-2.5 py-0.5 font-mono text-[11px] font-semibold text-positive hover:underline"
                          >
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            <span>{ev.evidence_id}</span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </Card>
                ),
              )}
              <div ref={endRef} />
            </div>
          )}

          {sending ? (
            <Card className="space-y-3 p-4">
              <div className="h-[2px] w-full overflow-hidden rounded-full bg-border/40">
                <div className="ct-progress-bar h-full w-2/5 rounded-full bg-primary" />
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {isId
                  ? "Muse Spark 1.3 sedang memanggil tool CoinTrac & merangkum bukti..."
                  : "Muse Spark 1.3 is calling CoinTrac tools and synthesizing evidence..."}
              </p>
            </Card>
          ) : null}

          {chatError ? (
            <ErrorNotice status={chatError.status} message={chatError.message} />
          ) : null}

          {/* Input Bar */}
          <Card className="p-3">
            <form
              className="flex flex-col gap-2.5 sm:flex-row sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
            >
              <label className="sr-only" htmlFor="cointrac-ai-input">
                {isId ? "Pertanyaan untuk CoinTrac AI" : "Ask CoinTrac AI"}
              </label>
              <textarea
                id="cointrac-ai-input"
                rows={2}
                value={input}
                disabled={sending}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
                placeholder={
                  isId
                    ? "Contoh: Analisa SOL vs AVAX dan cek hidden gem EARLY hari ini..."
                    : "Example: Compare SOL vs AVAX and check my best EARLY hidden gems..."
                }
                className="min-h-12 w-full resize-none rounded-[10px] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={sending}
                disabled={!input.trim() || sending || (quota !== null && !aiReady)}
                className="ct-btn-glow shrink-0"
              >
                {!sending ? <Send className="h-4 w-4" aria-hidden="true" /> : null}
                <span>{isId ? "Kirim" : "Analyze"}</span>
              </Button>
            </form>
          </Card>
        </div>

        {/* Right Compact History Sidebar */}
        <aside className="space-y-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <History className="h-3.5 w-3.5 text-link" aria-hidden="true" />
                <span>{isId ? "Riwayat AI Terbaru" : "Recent AI Queries"}</span>
              </span>
              <span className="font-mono text-[11px] text-subtle-foreground">
                {recentLogs.length}
              </span>
            </div>
            {recentLogs.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                {isId ? "Belum ada riwayat AI." : "No AI queries logged yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {recentLogs.slice(0, 8).map((log) => (
                  <li key={log.id} className="space-y-1 p-3.5">
                    <button
                      type="button"
                      disabled={sending || !log.prompt_summary}
                      onClick={() => void handleSubmit(log.prompt_summary)}
                      className="line-clamp-2 cursor-pointer text-left text-xs font-medium text-foreground hover:text-link disabled:cursor-default"
                    >
                      {log.prompt_summary || "—"}
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-subtle-foreground">
                      <span>{log.status}</span>
                      <span>
                        {log.cache_hit ? "CACHED" : `${log.total_tokens.toLocaleString()} tok`} ·{" "}
                        {log.latency_ms}ms
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
