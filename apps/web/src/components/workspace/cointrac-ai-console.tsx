"use client";

import {
  Activity,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  Gem,
  Layers,
  LineChart,
  MessageSquare,
  PanelLeft,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAppPreferences } from "@/components/app-preferences";
import {
  deriveThreadTitle,
  EMPTY_AI_THREAD_STATE,
  readAIThreadStateSnapshot,
  subscribeAIThreads,
  writeAIThreadState,
  type AIChatTurn,
  type AIThread,
} from "@/lib/ai-thread-store";
import {
  fetchAiStatus,
  sendAiChat,
  type AIQuotaSnapshot,
  type AIUsageLogItem,
} from "@/lib/control-plane-api";
import { AiMarkdown } from "./ai-markdown";
import { AIStructuredCard } from "./ai-structured-card";

type FocusLensId = "all" | "macro" | "assets" | "gems" | "movers" | "derivatives";

const FOCUS_LENSES: ReadonlyArray<{
  id: FocusLensId;
  labelEn: string;
  labelId: string;
  hint: string | null;
}> = [
  { id: "all", labelEn: "Auto · All Tools", labelId: "Otomatis · Semua Tool", hint: null },
  {
    id: "macro",
    labelEn: "Macro & Regime",
    labelId: "Makro & Rezim",
    hint: "Macro regime, Fear & Greed, BTC dominance, and top-50 breadth",
  },
  {
    id: "assets",
    labelEn: "Coins & Compare",
    labelId: "Koin & Bandingkan",
    hint: "Coin comparison, liquidity, FDV overhang, and relative strength vs BTC",
  },
  {
    id: "gems",
    labelEn: "Hidden Gems",
    labelId: "Hidden Gems",
    hint: "Hidden Gems EARLY & CONFIRMED discovery candidates and calibration stats",
  },
  {
    id: "movers",
    labelEn: "Movers & Anomalies",
    labelId: "Movers & Anomali",
    hint: "Anti-chase momentum movers and statistical volume/BTC divergence anomalies",
  },
  {
    id: "derivatives",
    labelEn: "Sectors & Derivatives",
    labelId: "Sektor & Derivatif",
    hint: "Sector capital rotation and perpetual funding/open-interest stress",
  },
];

const STARTER_CARDS: ReadonlyArray<{
  id: string;
  lens: FocusLensId;
  tag: string;
  icon: "macro" | "gems" | "movers" | "assets";
  titleEn: string;
  titleId: string;
  descEn: string;
  descId: string;
  promptEn: string;
  promptId: string;
}> = [
  {
    id: "macro",
    lens: "macro",
    tag: "MACRO",
    icon: "macro",
    titleEn: "Market Briefing & Regime",
    titleId: "Briefing Pasar & Rezim",
    descEn: "Macro regime classification, BTC dominance, Fear & Greed, breadth.",
    descId: "Klasifikasi rezim makro, dominasi BTC, Fear & Greed & breadth.",
    promptEn:
      "Give me a crisp market briefing: current macro regime, BTC/ETH dominance, Fear & Greed, and Top-50 breadth.",
    promptId:
      "Berikan briefing pasar singkat: kondisi rezim makro saat ini, dominasi BTC/ETH, Fear & Greed, dan breadth Top-50.",
  },
  {
    id: "gems",
    lens: "gems",
    tag: "GEMS",
    icon: "gems",
    titleEn: "Top Hidden Gem Picks",
    titleId: "Kandidat Hidden Gem",
    descEn: "Compare EARLY & CONFIRMED candidates with scores and risk gates.",
    descId: "Bandingkan kandidat EARLY & CONFIRMED beserta skor & risikonya.",
    promptEn:
      "List my top Hidden Gem candidates across EARLY and CONFIRMED tracks with scores, key drivers, and risk notes.",
    promptId:
      "Tampilkan kandidat Hidden Gem terbaik saya di track EARLY dan CONFIRMED beserta skor, pendorong utama, dan catatan risikonya.",
  },
  {
    id: "movers",
    lens: "movers",
    tag: "FLOW",
    icon: "movers",
    titleEn: "Anti-Chase Movers & Spikes",
    titleId: "Movers & Anomali Volume",
    descEn: "Healthy liquid leaders filtered against FOMO + Z-score volume spikes.",
    descId: "Penggerak likuid anti-FOMO + deteksi anomali Z-score volume.",
    promptEn:
      "Scan anti-chase momentum movers and check any unusual volume-to-mcap anomalies or BTC divergences right now.",
    promptId:
      "Pindai penggerak pasar dengan filter anti-FOMO dan cek anomali lonjakan volume atau divergensi BTC saat ini.",
  },
  {
    id: "compare",
    lens: "assets",
    tag: "COMPARE",
    icon: "assets",
    titleEn: "BTC vs ETH vs SOL Table",
    titleId: "Tabel BTC vs ETH vs SOL",
    descEn: "Side-by-side table covering liquidity, 7d RS vs BTC, and stress.",
    descId: "Tabel perbandingan likuiditas, RS 7d vs BTC & tekanan derivatif.",
    promptEn:
      "Compare BTC, ETH, and SOL in a concise table covering liquidity, 7d RS vs BTC, momentum, and derivatives stress.",
    promptId:
      "Bandingkan BTC, ETH, dan SOL dalam tabel ringkas mencakup likuiditas, RS 7d vs BTC, momentum, dan tekanan derivatif.",
  },
];

function StarterIcon({ kind }: { kind: "macro" | "gems" | "movers" | "assets" }) {
  if (kind === "gems") return <Gem className="h-4 w-4 text-link" aria-hidden="true" />;
  if (kind === "movers") return <Activity className="h-4 w-4 text-link" aria-hidden="true" />;
  if (kind === "assets") return <Layers className="h-4 w-4 text-link" aria-hidden="true" />;
  return <LineChart className="h-4 w-4 text-link" aria-hidden="true" />;
}

function isSameLocalDay(iso: string): boolean {
  try {
    const dt = new Date(iso);
    const now = new Date();
    return (
      dt.getFullYear() === now.getFullYear() &&
      dt.getMonth() === now.getMonth() &&
      dt.getDate() === now.getDate()
    );
  } catch {
    return false;
  }
}

export function CoinTracAIConsole({
  mode = "workspace",
}: {
  mode?: "workspace" | "admin_sandbox";
}) {
  const { locale } = useAppPreferences();
  const isId = locale === "id";
  const isAdminSandbox = mode === "admin_sandbox";

  const [quota, setQuota] = useState<AIQuotaSnapshot | null>(null);
  const [recentLogs, setRecentLogs] = useState<AIUsageLogItem[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<{ status: number; message: string } | null>(null);

  const threadState = useSyncExternalStore(
    subscribeAIThreads,
    readAIThreadStateSnapshot,
    () => EMPTY_AI_THREAD_STATE,
  );

  const [input, setInput] = useState("");
  const [threadSearch, setThreadSearch] = useState("");
  const [lens, setLens] = useState<FocusLensId>("all");
  const [bypassCache, setBypassCache] = useState(false);
  const [sending, setSending] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedLogPreview, setSelectedLogPreview] = useState<AIUsageLogItem | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [quotaMenuOpen, setQuotaMenuOpen] = useState(false);
  const [lensMenuOpen, setLensMenuOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const quotaMenuRef = useRef<HTMLDivElement | null>(null);
  const lensMenuRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);

  const activeThread = useMemo<AIThread | null>(
    () => threadState.threads.find((t) => t.id === threadState.activeThreadId) ?? null,
    [threadState],
  );
  const turns = useMemo(() => activeThread?.turns ?? [], [activeThread]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
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
        setStatusError(null);
      } else {
        setStatusError({ status: res.status, message: res.message });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sending) return;
    const id = window.setInterval(() => {
      setThinkingStage((prev) => (prev + 1) % 3);
    }, 2100);
    return () => window.clearInterval(id);
  }, [sending]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, sending]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [input]);

  useEffect(() => {
    if (!quotaMenuOpen && !lensMenuOpen) return;
    const onOutsideClick = (e: MouseEvent) => {
      if (quotaMenuOpen && quotaMenuRef.current && !quotaMenuRef.current.contains(e.target as Node)) {
        setQuotaMenuOpen(false);
      }
      if (lensMenuOpen && lensMenuRef.current && !lensMenuRef.current.contains(e.target as Node)) {
        setLensMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onOutsideClick);
    return () => window.removeEventListener("mousedown", onOutsideClick);
  }, [quotaMenuOpen, lensMenuOpen]);

  const activeLens = useMemo(
    () => FOCUS_LENSES.find((item) => item.id === lens) ?? FOCUS_LENSES[0],
    [lens],
  );

  const visibleStarters = useMemo(() => {
    if (lens === "all") return STARTER_CARDS;
    const matched = STARTER_CARDS.filter((s) => s.lens === lens);
    return matched.length > 0 ? matched : STARTER_CARDS;
  }, [lens]);

  const groupedThreads = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    const list = q
      ? threadState.threads.filter((t) => t.title.toLowerCase().includes(q))
      : threadState.threads;
    const today: AIThread[] = [];
    const earlier: AIThread[] = [];
    for (const t of list) {
      if (isSameLocalDay(t.updatedAt)) {
        today.push(t);
      } else {
        earlier.push(t);
      }
    }
    return { today, earlier };
  }, [threadSearch, threadState.threads]);

  function startNewThread() {
    const cur = readAIThreadStateSnapshot();
    writeAIThreadState({ ...cur, activeThreadId: null });
    setSelectedLogPreview(null);
    setMobileRailOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectThread(threadId: string) {
    const cur = readAIThreadStateSnapshot();
    writeAIThreadState({ ...cur, activeThreadId: threadId });
    setSelectedLogPreview(null);
    setMobileRailOpen(false);
  }

  function openServerHistoryEntry(log: AIUsageLogItem) {
    setMobileRailOpen(false);
    const target = log.prompt_summary.trim().toLowerCase();
    const cur = readAIThreadStateSnapshot();
    const matched = cur.threads.find(
      (thr) =>
        thr.title.trim().toLowerCase() === target ||
        thr.turns.some((t) => t.role === "user" && t.content.trim().toLowerCase() === target),
    );
    if (matched) {
      writeAIThreadState({ ...cur, activeThreadId: matched.id });
      setSelectedLogPreview(null);
      return;
    }
    setSelectedLogPreview(log);
  }

  function handleFeedback(turnId: string, vote: "up" | "down") {
    const cur = readAIThreadStateSnapshot();
    if (!cur.activeThreadId) return;
    writeAIThreadState({
      ...cur,
      threads: cur.threads.map((thr) =>
        thr.id === cur.activeThreadId
          ? {
              ...thr,
              turns: thr.turns.map((turn) =>
                turn.id === turnId
                  ? { ...turn, feedback: turn.feedback === vote ? null : vote }
                  : turn,
              ),
            }
          : thr,
      ),
    });
  }

  function deleteThread(threadId: string) {
    const cur = readAIThreadStateSnapshot();
    const nextThreads = cur.threads.filter((t) => t.id !== threadId);
    const nextActive =
      cur.activeThreadId === threadId ? (nextThreads[0]?.id ?? null) : cur.activeThreadId;
    writeAIThreadState({ activeThreadId: nextActive, threads: nextThreads });
  }

  const executePrompt = useCallback(
    async (
      rawPrompt: string,
      options?: { forceLive?: boolean; replaceTurnIdx?: number },
    ) => {
      const clean = rawPrompt.trim();
      if (!clean || sending) return;

      const cur = readAIThreadStateSnapshot();
      const nowIso = new Date().toISOString();
      seqRef.current += 1;

      let targetThreadId = cur.activeThreadId;
      let threadList = [...cur.threads];
      let targetThread = threadList.find((t) => t.id === targetThreadId) ?? null;

      if (!targetThread) {
        targetThreadId = `thr_${Date.now()}_${seqRef.current}`;
        targetThread = {
          id: targetThreadId,
          title: deriveThreadTitle(clean),
          updatedAt: nowIso,
          turns: [],
        };
        threadList = [targetThread, ...threadList];
      }

      const baseTurns =
        typeof options?.replaceTurnIdx === "number"
          ? targetThread.turns.slice(0, options.replaceTurnIdx)
          : targetThread.turns.filter((t) => !t.error);

      const userTurn: AIChatTurn = {
        id: `u_${Date.now()}_${seqRef.current}`,
        role: "user",
        content: clean,
        createdAt: nowIso,
      };
      const updatedTurns = [...baseTurns, userTurn];

      writeAIThreadState({
        activeThreadId: targetThreadId,
        threads: threadList.map((t) =>
          t.id === targetThreadId ? { ...t, updatedAt: nowIso, turns: updatedTurns } : t,
        ),
      });

      setThinkingStage(0);
      setSending(true);

      const apiMessages = updatedTurns.slice(-10).map((t) => ({
        role: t.role,
        content: t.content,
      }));

      const res = await sendAiChat({
        messages: apiMessages,
        locale,
        context_hint: activeLens.hint,
        bypass_cache: options?.forceLive ?? bypassCache,
      });

      setSending(false);
      seqRef.current += 1;

      const latestState = readAIThreadStateSnapshot();
      const latestThreads = [...latestState.threads];
      const replyIso = new Date().toISOString();

      if (!res.ok) {
        const errTurn: AIChatTurn = {
          id: `e_${Date.now()}_${seqRef.current}`,
          role: "assistant",
          content: "",
          createdAt: replyIso,
          error: { status: res.status, message: res.message },
        };
        writeAIThreadState({
          activeThreadId: targetThreadId,
          threads: latestThreads.map((t) =>
            t.id === targetThreadId
              ? { ...t, updatedAt: replyIso, turns: [...t.turns, errTurn] }
              : t,
          ),
        });
        void loadStatus();
        return;
      }

      const aiTurn: AIChatTurn = {
        id: `a_${Date.now()}_${seqRef.current}`,
        role: "assistant",
        content: res.data.answer,
        createdAt: replyIso,
        meta: res.data,
      };
      writeAIThreadState({
        activeThreadId: targetThreadId,
        threads: latestThreads.map((t) =>
          t.id === targetThreadId
            ? { ...t, updatedAt: replyIso, turns: [...t.turns, aiTurn] }
            : t,
        ),
      });
      setQuota(res.data.quota);
      void loadStatus();
    },
    [activeLens.hint, bypassCache, loadStatus, locale, sending],
  );

  async function handleFormSubmit() {
    const clean = input.trim();
    if (!clean || sending) return;
    setInput("");
    await executePrompt(clean);
  }

  async function handleCopyAnswer(turnId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(turnId);
      window.setTimeout(() => setCopiedId((cur) => (cur === turnId ? null : cur)), 1800);
    } catch {
      // Ignore restricted clipboard access
    }
  }

  function handleRetryTurn(errorIdx: number) {
    for (let i = errorIdx - 1; i >= 0; i -= 1) {
      if (turns[i]?.role === "user") {
        void executePrompt(turns[i].content, { replaceTurnIdx: i });
        return;
      }
    }
  }

  const aiReady = quota
    ? quota.ai_enabled && quota.user_ai_enabled && quota.key_configured
    : false;
  const quotaExhausted = Boolean(quota && quota.remaining_today_requests <= 0);
  const lowQuotaWarning = Boolean(
    quota && quota.remaining_today_requests > 0 && quota.remaining_today_requests < 5,
  );
  const composerLocked = Boolean(quota && (!aiReady || quotaExhausted));

  const thinkingLabels = isId
    ? [
        "Menghubungkan ke Muse Spark 1.3...",
        "Memanggil tool pasar deterministik CoinTrac...",
        "Menyusun ringkasan terverifikasi & evidence_id...",
      ]
    : [
        "Routing to Muse Spark 1.3...",
        "Running CoinTrac deterministic market tools...",
        "Synthesizing verified numbers & evidence_id...",
      ];

  const renderComposer = (centered: boolean) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleFormSubmit();
      }}
      className={`w-full ${centered ? "mx-auto max-w-[700px]" : "mx-auto max-w-[760px]"}`}
    >
      <div className="ct-surface-featured rounded-[26px] transition-all focus-within:border-primary/70 focus-within:ring-2 focus-within:ring-primary/20">
        <label htmlFor="cointrac-gpt-input" className="sr-only">
          {isId ? "Tanyakan apa saja kepada CoinTrac AI" : "Ask CoinTrac AI anything"}
        </label>
        <textarea
          ref={inputRef}
          id="cointrac-gpt-input"
          rows={centered ? 2 : 1}
          value={input}
          disabled={sending || composerLocked}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleFormSubmit();
            }
          }}
          placeholder={
            quotaExhausted
              ? isId
                ? "Kuota harian CoinTrac AI habis — reset otomatis pukul 00:00 UTC..."
                : "Daily CoinTrac AI quota reached — resets at 00:00 UTC..."
              : composerLocked
                ? isId
                  ? "CoinTrac AI sedang dijeda atau API key belum diset..."
                  : "CoinTrac AI is paused or unconfigured..."
                : isId
                  ? "Tanyakan apa saja soal pasar kripto, koin, movers, atau Hidden Gems..."
                  : "Ask anything about crypto regime, coins, movers, or Hidden Gems..."
          }
          className="max-h-44 min-h-[52px] w-full resize-none border-0 bg-transparent px-5 pt-4 pb-2 text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-subtle-foreground focus:outline-none focus-visible:outline-none"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Sleek Custom Focus Lens Popover */}
            <div ref={lensMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={lensMenuOpen}
                onClick={() => setLensMenuOpen((v) => !v)}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors ${
                  lens !== "all" || lensMenuOpen
                    ? "border-primary/45 bg-primary/12 text-link"
                    : "border-border/80 bg-background/60 text-muted-foreground hover:border-border-strong hover:text-foreground"
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                <span>{isId ? activeLens.labelId : activeLens.labelEn}</span>
                <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
              </button>

              {lensMenuOpen ? (
                <div
                  className={`ct-surface-featured absolute left-0 z-30 w-60 rounded-[14px] p-1.5 ${
                    centered ? "top-10" : "bottom-10"
                  }`}
                >
                  {FOCUS_LENSES.map((item) => {
                    const selected = item.id === lens;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setLens(item.id);
                          setLensMenuOpen(false);
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-[9px] px-3 py-2 text-left text-xs transition-colors ${
                          selected
                            ? "bg-primary/14 font-semibold text-link"
                            : "text-foreground hover:bg-muted/70"
                        }`}
                      >
                        <span>{isId ? item.labelId : item.labelEn}</span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              aria-pressed={bypassCache}
              onClick={() => setBypassCache((v) => !v)}
              title={
                isId
                  ? "Lewati cache jawaban AI dan ambil data baru"
                  : "Skip cached AI response and query live"
              }
              className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[11.5px] font-medium transition-colors ${
                bypassCache
                  ? "border-primary/45 bg-primary/12 text-link"
                  : "border-border/80 bg-background/60 text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              <Zap className="h-3 w-3" aria-hidden="true" />
              <span>{isId ? "Data Live" : "Live"}</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {lowQuotaWarning && quota ? (
              <span className="rounded-full border border-warning/40 bg-warning-soft/30 px-2 py-0.5 font-mono text-[10.5px] font-semibold text-warning">
                {isId
                  ? `Sisa ${quota.remaining_today_requests} req hari ini`
                  : `${quota.remaining_today_requests} req left today`}
              </span>
            ) : null}
            {quota && quota.remaining_this_minute <= 3 ? (
              <span className="font-mono text-[11px] text-warning">
                {quota.remaining_this_minute}/{quota.rate_limit_per_min} min
              </span>
            ) : null}

            <button
              type="submit"
              disabled={!input.trim() || sending || composerLocked}
              aria-label={isId ? "Kirim pesan" : "Send message"}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:bg-muted disabled:text-disabled-foreground disabled:shadow-none ${
                input.trim() && !sending && !composerLocked
                  ? "ct-btn-glow bg-primary text-primary-foreground hover:bg-primary-hover"
                  : "bg-muted text-disabled-foreground"
              }`}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  const renderThreadGroup = (title: string, items: AIThread[]) => {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle-foreground">
          {title}
        </p>
        <ul className="space-y-0.5">
          {items.map((thr) => {
            const active = thr.id === activeThread?.id;
            return (
              <li key={thr.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectThread(thr.id)}
                  className={`relative flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[9px] border px-2.5 py-2 text-left text-xs transition-colors ${
                    active
                      ? "border-primary/35 bg-primary/12 font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted/65 hover:text-foreground"
                  }`}
                >
                  {active ? (
                    <span
                      className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                  <span className="truncate">{thr.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteThread(thr.id)}
                  aria-label={isId ? "Hapus percakapan" : "Delete chat"}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive-soft hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const renderThreadRail = (mobile = false) => (
    <div className="flex h-full flex-col bg-card/55">
      <div className="space-y-2.5 border-b border-border/75 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startNewThread}
            className="flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-border-strong bg-background/80 px-3 text-xs font-semibold text-foreground transition-colors hover:border-primary/45 hover:text-link"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isId ? "Percakapan Baru" : "New Chat"}</span>
          </button>
          {mobile ? (
            <button
              type="button"
              onClick={() => setMobileRailOpen(false)}
              aria-label={isId ? "Tutup riwayat" : "Close history"}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] border border-border text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {threadState.threads.length >= 3 ? (
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3 w-3 -translate-y-1/2 text-subtle-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={threadSearch}
              onChange={(e) => setThreadSearch(e.target.value)}
              placeholder={isId ? "Cari chat..." : "Search chats..."}
              className="h-8 w-full rounded-[8px] border border-border bg-input-bg py-1 pr-2.5 pl-7 text-[11.5px] text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none"
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-3.5">
        {threadState.threads.length === 0 ? (
          <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-subtle-foreground">
            {isId
              ? "Percakapan Anda tersimpan otomatis di sini agar mudah dilanjutkan kapan saja."
              : "Your conversations appear here so you can resume any research thread."}
          </p>
        ) : (
          <>
            {renderThreadGroup(isId ? "Hari Ini" : "Today", groupedThreads.today)}
            {renderThreadGroup(isId ? "Sebelumnya" : "Previous", groupedThreads.earlier)}
          </>
        )}

        {recentLogs.length > 0 ? (
          <div>
            <p className="px-2.5 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle-foreground">
              {isId ? "Riwayat Server" : "Recent Prompts"}
            </p>
            <ul className="space-y-0.5">
              {recentLogs
                .filter((log, idx, arr) => {
                  const key = log.prompt_summary.trim().toLowerCase();
                  return (
                    key.length > 0 &&
                    arr.findIndex((x) => x.prompt_summary.trim().toLowerCase() === key) === idx
                  );
                })
                .slice(0, 7)
                .map((log) => (
                  <li key={log.id}>
                    <button
                      type="button"
                      disabled={!log.prompt_summary}
                      onClick={() => openServerHistoryEntry(log)}
                      title={
                        isId
                          ? "Buka riwayat tanpa memakai kuota"
                          : "Open conversation / log without spending quota"
                      }
                      className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                    >
                      <Sparkles className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
                      <span className="truncate">{log.prompt_summary || "—"}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/75 bg-background/45 px-3.5 py-3 font-mono text-[11px]">
        {quota ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{isId ? "Kuota Harian" : "Daily Quota"}</span>
              <span className="font-semibold text-foreground">
                {quota.remaining_today_requests}/{quota.daily_requests_limit} req
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, Math.round((quota.remaining_today_requests / Math.max(1, quota.daily_requests_limit)) * 100))}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-subtle-foreground">
              <span>{quota.remaining_today_tokens.toLocaleString()} tok left</span>
              <span>{quota.rate_limit_per_min}/min</span>
            </div>
          </div>
        ) : statusLoading ? (
          <p className="text-subtle-foreground">{isId ? "Memuat kuota..." : "Loading quota..."}</p>
        ) : (
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="cursor-pointer text-link hover:underline"
          >
            {isId ? "Muat ulang status API" : "Retry API status"}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      {/* Desktop ChatGPT-style Left Thread Sidebar */}
      {railOpen ? (
        <aside className="hidden w-[264px] shrink-0 border-r border-border/80 lg:block">
          {renderThreadRail(false)}
        </aside>
      ) : null}

      {/* Mobile Slide-Over Thread Drawer */}
      {mobileRailOpen ? (
        <div
          className="fixed inset-0 z-50 flex bg-black/65 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileRailOpen(false)}
        >
          <aside
            className="h-full w-[276px] border-r border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {renderThreadRail(true)}
          </aside>
        </div>
      ) : null}

      {/* Primary Center-Stage Full-Bleed Canvas */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {turns.length === 0 ? (
          <div
            aria-hidden="true"
            className="ct-hero-glow pointer-events-none absolute inset-x-0 top-0 h-[360px]"
          >
            <div className="ct-grid-backdrop h-full w-full opacity-55" />
          </div>
        ) : null}

        {/* Minimalist GPT Top Model Bar */}
        <header className="relative z-20 flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-background/70 px-3 backdrop-blur-md sm:px-5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMobileRailOpen(true)}
              aria-label={isId ? "Buka riwayat chat" : "Open chat history"}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => setRailOpen((v) => !v)}
              aria-label={railOpen ? "Hide chat sidebar" : "Show chat sidebar"}
              className="hidden h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
            >
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <div ref={quotaMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setQuotaMenuOpen((v) => !v)}
                className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] px-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/70"
              >
                <Sparkles className="h-4 w-4 text-link" aria-hidden="true" />
                <span>CoinTrac AI</span>
                <span className="rounded-full border border-border bg-card/80 px-2 py-0.5 font-mono text-[10.5px] font-medium text-muted-foreground">
                  {quota?.model ?? "muse-spark-1.3"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden="true" />
              </button>

              {quotaMenuOpen ? (
                <div className="ct-surface-featured absolute top-11 left-0 z-30 w-72 rounded-[14px] p-3.5">
                  <div className="flex items-center justify-between border-b border-border pb-2.5">
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                      <Cpu className="h-3.5 w-3.5 text-link" aria-hidden="true" />
                      {quota?.model ?? "muse-spark-1.3"}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                        aiReady
                          ? "bg-positive-soft text-positive"
                          : "bg-warning-soft text-warning"
                      }`}
                    >
                      {aiReady ? "READY" : quota?.key_configured ? "PAUSED" : "OFFLINE"}
                    </span>
                  </div>
                  {quota ? (
                    <dl className="mt-2.5 space-y-1.5 font-mono text-[11px]">
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">{isId ? "Laju / mnt" : "Rate / min"}</dt>
                        <dd className="text-foreground">
                          {quota.remaining_this_minute}/{quota.rate_limit_per_min}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">{isId ? "Kuota hari ini" : "Daily req"}</dt>
                        <dd className="text-foreground">
                          {quota.remaining_today_requests}/{quota.daily_requests_limit}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">{isId ? "Sisa token" : "Tokens left"}</dt>
                        <dd className="text-foreground">
                          {quota.remaining_today_tokens.toLocaleString()}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-muted-foreground">Reset window</dt>
                        <dd className="text-subtle-foreground">{quota.reset_in_seconds}s</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {statusError?.message ?? (isId ? "Memuat status..." : "Loading status...")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
              <span
                className={`h-2 w-2 rounded-full ${aiReady ? "bg-positive" : "bg-warning"}`}
              />
              <span>{aiReady ? "LIVE" : statusLoading ? "..." : "STANDBY"}</span>
            </span>

            {turns.length > 0 ? (
              <button
                type="button"
                onClick={startNewThread}
                className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card/85 px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/45 hover:text-link"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">{isId ? "Chat Baru" : "New Chat"}</span>
              </button>
            ) : null}
          </div>
        </header>

        {/* Backend Status Alert Banner if unreachable */}
        {statusError ? (
          <div className="relative z-10 mx-auto mt-3 w-full max-w-[760px] px-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-warning/40 bg-warning-soft/25 px-3.5 py-2.5 text-xs">
              <span className="text-foreground">
                <strong>HTTP {statusError.status}:</strong> {statusError.message}
              </span>
              <button
                type="button"
                onClick={() => void loadStatus()}
                className="inline-flex cursor-pointer items-center gap-1 font-mono font-semibold text-link hover:underline"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>{isId ? "Coba Lagi" : "Retry"}</span>
              </button>
            </div>
          </div>
        ) : null}

        {/* Quota Exhausted Banner */}
        {quotaExhausted && quota ? (
          <div className="relative z-10 mx-auto mt-3 w-full max-w-[760px] px-4">
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-warning/45 bg-warning-soft/30 px-3.5 py-2.5 text-xs text-foreground"
            >
              <span>
                {isId
                  ? `Kuota harian CoinTrac AI habis (${quota.remaining_today_requests}/${quota.daily_requests_limit} tersisa hari ini). Reset otomatis pada 00:00 UTC`
                  : `Daily CoinTrac AI quota reached (${quota.remaining_today_requests}/${quota.daily_requests_limit} requests left today). Resets automatically at 00:00 UTC`}
                {quota.reset_in_seconds > 0
                  ? ` (${Math.floor(quota.reset_in_seconds / 3600)}h ${Math.floor((quota.reset_in_seconds % 3600) / 60)}m).`
                  : "."}
              </span>
              <span className="font-mono text-[11px] font-semibold text-warning">
                {isId ? "00:00 UTC Reset" : "00:00 UTC Reset"}
              </span>
            </div>
          </div>
        ) : null}

        {/* Read-Only Archived Server Log Preview (Opened When Local Thread Is Unavailable — 0 AI Calls) */}
        {selectedLogPreview ? (
          <div className="relative z-10 mx-auto mt-3 w-full max-w-[760px] px-4">
            <div className="ct-surface-featured space-y-2.5 rounded-[14px] p-4 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-link">
                    {isId ? "Arsip Riwayat Server (Tanpa Kuota)" : "Archived Prompt Log (No Quota Used)"}
                  </p>
                  <p className="mt-1 font-medium text-foreground">{selectedLogPreview.prompt_summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLogPreview(null)}
                  aria-label={isId ? "Tutup pratinjau arsip" : "Close archived preview"}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-border text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                <span>{selectedLogPreview.created_at.replace("T", " ").slice(0, 16)} UTC</span>
                <span>· {selectedLogPreview.total_tokens.toLocaleString()} tok</span>
                <span>· {selectedLogPreview.latency_ms} ms</span>
                {selectedLogPreview.evidence_ids.map((evId) =>
                  isAdminSandbox ? (
                    <span
                      key={evId}
                      className="rounded-full border border-positive/35 bg-positive-soft px-2 py-0.5 text-positive"
                    >
                      {evId}
                    </span>
                  ) : (
                    <Link
                      key={evId}
                      href={`/app/evidence?id=${encodeURIComponent(evId)}`}
                      className="rounded-full border border-positive/35 bg-positive-soft px-2 py-0.5 text-positive hover:underline"
                    >
                      {evId}
                    </Link>
                  ),
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                <span className="text-[11px] text-muted-foreground">
                  {isId
                    ? "Teks jawaban lengkap tidak disimpan di perangkat ini. Anda tetap bisa mengaudit evidence_id di atas."
                    : "Full prose transcript was not saved in this browser; inspect persisted evidence IDs above."}
                </span>
                <button
                  type="button"
                  disabled={sending || composerLocked}
                  onClick={() => {
                    const p = selectedLogPreview.prompt_summary;
                    setSelectedLogPreview(null);
                    void executePrompt(p);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-primary/45 bg-primary/12 px-3 py-1 font-mono text-[11px] font-semibold text-link hover:bg-primary/20 disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                  <span>{isId ? "Jalankan Ulang (1 req)" : "Run Fresh (1 req)"}</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Empty State (Flagship Centered Stage) vs Active Conversation Stream */}
        {turns.length === 0 ? (
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8 sm:px-6">
            <div className="w-full max-w-[700px] space-y-6">
              <div className="space-y-3 text-center">
                <div className="ct-enter inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-link">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Muse Spark 1.3 · 13 Live Tools</span>
                </div>
                <h1 className="ct-enter-delay-1 text-2xl font-semibold tracking-[-0.03em] text-foreground sm:text-[34px] sm:leading-[1.12]">
                  {isId
                    ? "Analis Kripto Institusional Berbasis Bukti."
                    : "Crypto Market Intelligence, Grounded in Evidence."}
                </h1>
                <p className="ct-enter-delay-2 mx-auto max-w-lg text-xs leading-relaxed text-muted-foreground sm:text-sm">
                  {isId
                    ? "Tanya rezim makro, Hidden Gems, atau bandingkan koin — setiap angka dipanggil langsung dari CoinTrac dan ditautkan ke evidence_id."
                    : "Ask for macro regime, Hidden Gems, or coin comparisons — every figure is verified via live tools with cited evidence."}
                </p>
              </div>

              <div className="ct-enter-delay-2">{renderComposer(true)}</div>

              <div className="ct-enter-delay-3 grid gap-2.5 sm:grid-cols-2">
                {visibleStarters.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    disabled={sending || composerLocked}
                    onClick={() => void executePrompt(isId ? card.promptId : card.promptEn)}
                    className="ct-surface-card group flex cursor-pointer items-start gap-3 rounded-[14px] p-3.5 text-left transition-all hover:border-primary/45 hover:bg-card-elevated disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-primary/25 bg-primary/10">
                      <StarterIcon kind={card.icon} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground group-hover:text-link">
                          {isId ? card.titleId : card.titleEn}
                        </span>
                        <span className="font-mono text-[9.5px] font-semibold tracking-wider text-subtle-foreground">
                          {card.tag}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[11.5px] text-muted-foreground">
                        {isId ? card.descId : card.descEn}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Editorial Conversation Stream */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
              <div className="mx-auto max-w-[760px] space-y-8">
                {turns.map((turn, idx) =>
                  turn.role === "user" ? (
                    <div key={turn.id} className="ct-code-swap flex justify-end">
                      <div className="group flex max-w-[82%] flex-col items-end gap-1.5">
                        <div className="rounded-[22px] rounded-br-[6px] border border-primary/35 bg-primary/14 px-4.5 py-3 text-[14.5px] leading-relaxed text-foreground">
                          {turn.content}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setInput(turn.content);
                            inputRef.current?.focus();
                          }}
                          className="cursor-pointer px-2 font-mono text-[10.5px] text-subtle-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-link"
                        >
                          {isId ? "Edit prompt" : "Reuse prompt"}
                        </button>
                      </div>
                    </div>
                  ) : turn.error ? (
                    <div key={turn.id} className="ct-code-swap flex items-start gap-3.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-destructive/40 bg-destructive-soft text-destructive">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="flex-1 space-y-2.5 rounded-2xl border border-destructive/40 bg-destructive-soft/25 px-4 py-3.5">
                        <p className="font-mono text-xs font-semibold text-destructive">
                          Error {turn.error.status}
                        </p>
                        <p className="text-xs leading-relaxed text-foreground">
                          {turn.error.message}
                        </p>
                        <button
                          type="button"
                          disabled={sending}
                          onClick={() => handleRetryTurn(idx)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:border-primary/45 hover:text-link"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          <span>{isId ? "Coba Lagi" : "Retry"}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={turn.id} className="ct-code-swap flex items-start gap-3.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/14 text-link">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        {/* Deterministic Structured Summary Cards, Tables & Sparkline */}
                        {turn.meta?.structured_cards ? (
                          <AIStructuredCard
                            summary={turn.meta.structured_cards}
                            locale={locale}
                            isAdminSandbox={isAdminSandbox}
                          />
                        ) : null}

                        <AiMarkdown text={turn.content} />

                        {/* Always-Visible Evidence & Tool Provenance Strip */}
                        {turn.meta &&
                        (turn.meta.tools_used.length > 0 || turn.meta.evidence_refs.length > 0) ? (
                          <div className="space-y-1.5 rounded-[12px] border border-border/80 bg-card/55 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-positive">
                                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>{isId ? "Bukti:" : "Evidence:"}</span>
                              </span>
                              {turn.meta.evidence_refs.map((ev) => {
                                const tsLabel = ev.source_timestamp ?? ev.retrieved_at_utc;
                                const shortTs = tsLabel
                                  ? (() => {
                                      const d = new Date(tsLabel);
                                      return Number.isNaN(d.getTime())
                                        ? null
                                        : `${d.toISOString().slice(11, 16)} UTC`;
                                    })()
                                  : null;
                                const badgeClass =
                                  "inline-flex items-center gap-1 rounded-full border border-positive/35 bg-positive-soft px-2.5 py-0.5 font-mono text-[10.5px] font-semibold text-positive";
                                return isAdminSandbox ? (
                                  <span key={ev.evidence_id} className={badgeClass}>
                                    <span>{ev.evidence_id}</span>
                                    {ev.data_mode ? <span>· {ev.data_mode}</span> : null}
                                    {shortTs ? <span>· {shortTs}</span> : null}
                                  </span>
                                ) : (
                                  <Link
                                    key={ev.evidence_id}
                                    href={`/app/evidence?id=${encodeURIComponent(ev.evidence_id)}`}
                                    className={`${badgeClass} hover:underline`}
                                  >
                                    <span>{ev.evidence_id}</span>
                                    {ev.data_mode ? <span>· {ev.data_mode}</span> : null}
                                    {shortTs ? <span>· {shortTs}</span> : null}
                                  </Link>
                                );
                              })}
                              {turn.meta.tools_used.map((tool) => (
                                <span
                                  key={tool}
                                  className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                                >
                                  {tool}
                                </span>
                              ))}
                            </div>
                            {turn.meta.structured_cards?.limitations_line ? (
                              <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                                {turn.meta.structured_cards.limitations_line}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Clean Minimalist Action Bar: Copy, Regenerate, Live Refresh, Feedback */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => void handleCopyAnswer(turn.id, turn.content)}
                            aria-label={isId ? "Salin jawaban" : "Copy response"}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {copiedId === turn.id ? (
                              <>
                                <Check className="h-3 w-3 text-positive" aria-hidden="true" />
                                <span className="text-positive">{isId ? "Disalin" : "Copied"}</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                <span>{isId ? "Salin" : "Copy"}</span>
                              </>
                            )}
                          </button>

                          {idx > 0 && turns[idx - 1]?.role === "user" ? (
                            <>
                              <button
                                type="button"
                                disabled={sending || composerLocked}
                                onClick={() =>
                                  void executePrompt(turns[idx - 1].content, {
                                    forceLive: false,
                                    replaceTurnIdx: idx - 1,
                                  })
                                }
                                className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                              >
                                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                                <span>{isId ? "Buat Ulang" : "Regenerate"}</span>
                              </button>
                              <button
                                type="button"
                                disabled={sending || composerLocked}
                                onClick={() =>
                                  void executePrompt(turns[idx - 1].content, {
                                    forceLive: true,
                                    replaceTurnIdx: idx - 1,
                                  })
                                }
                                className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-subtle-foreground transition-colors hover:bg-muted hover:text-link disabled:opacity-50"
                              >
                                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                <span>{isId ? "Segarkan Live" : "Regenerate Live"}</span>
                              </button>
                            </>
                          ) : null}

                          <button
                            type="button"
                            onClick={() => handleFeedback(turn.id, "up")}
                            aria-pressed={turn.feedback === "up"}
                            aria-label={isId ? "Jawaban membantu" : "Helpful response"}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 font-mono text-[11px] transition-colors ${
                              turn.feedback === "up"
                                ? "bg-positive-soft text-positive"
                                : "text-subtle-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          >
                            <ThumbsUp className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleFeedback(turn.id, "down")}
                            aria-pressed={turn.feedback === "down"}
                            aria-label={isId ? "Jawaban kurang tepat" : "Unhelpful response"}
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 font-mono text-[11px] transition-colors ${
                              turn.feedback === "down"
                                ? "bg-destructive-soft text-destructive"
                                : "text-subtle-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          >
                            <ThumbsDown className="h-3 w-3" aria-hidden="true" />
                          </button>

                          {turn.meta?.cache_hit ? (
                            <span className="rounded-full border border-border/80 bg-muted/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {isId ? "Snapshot Cache" : "Cached Snapshot"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ),
                )}

                {sending ? (
                  <div className="flex items-start gap-3.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/14 text-link">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                    </span>
                    <div className="space-y-2 pt-1">
                      <p className="font-mono text-xs text-link">
                        {thinkingLabels[thinkingStage]}
                      </p>
                      <div className="h-[2px] w-48 overflow-hidden rounded-full bg-border/50">
                        <div className="ct-progress-bar h-full w-2/5 rounded-full bg-primary" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Bottom Floating Composer */}
            <div className="bg-gradient-to-t from-background via-background/95 to-transparent px-3 pt-3 pb-3 sm:px-6 sm:pb-4">
              {renderComposer(false)}
              <p className="mt-2 text-center text-[11px] text-subtle-foreground">
                {isId
                  ? "CoinTrac AI memverifikasi angka lewat tool deterministik · Nilai kosong tetap null, bukan saran finansial."
                  : "CoinTrac AI verifies numbers via deterministic tools · Missing values stay null, not financial advice."}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
