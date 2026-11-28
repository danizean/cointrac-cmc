/**
 * Hydration-safe client store for multi-thread CoinTrac AI conversations.
 * Backed by localStorage with a referentially stable snapshot for useSyncExternalStore.
 */

import type { AIChatResponsePayload } from "./control-plane-api";

export interface AIChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  meta?: AIChatResponsePayload;
  feedback?: "up" | "down" | null;
  error?: { status: number; message: string };
}

export interface AIThread {
  id: string;
  title: string;
  updatedAt: string;
  turns: AIChatTurn[];
}

export interface AIThreadState {
  activeThreadId: string | null;
  threads: AIThread[];
}

const STORAGE_KEY = "ct_ai_threads_v2";
const THREAD_EVENT = "ct-ai-threads-v2-change";
const MAX_THREADS = 24;
const MAX_TURNS_PER_THREAD = 30;

export const EMPTY_AI_THREAD_STATE: AIThreadState = {
  activeThreadId: null,
  threads: [],
};

let cachedRaw: string | null = null;
let cachedParsed: AIThreadState = EMPTY_AI_THREAD_STATE;

export function subscribeAIThreads(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(THREAD_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(THREAD_EVENT, callback);
  };
}

export function readAIThreadStateSnapshot(): AIThreadState {
  if (typeof window === "undefined") return EMPTY_AI_THREAD_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedRaw = null;
      cachedParsed = EMPTY_AI_THREAD_STATE;
      return EMPTY_AI_THREAD_STATE;
    }
    if (raw === cachedRaw) {
      return cachedParsed;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return EMPTY_AI_THREAD_STATE;
    }
    const obj = parsed as Partial<AIThreadState>;
    const rawThreads = Array.isArray(obj.threads) ? obj.threads : [];
    const seenIds = new Set<string>();
    const threads: AIThread[] = [];
    for (const item of rawThreads) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);
      threads.push(item);
      if (threads.length >= MAX_THREADS) break;
    }
    const activeThreadId =
      typeof obj.activeThreadId === "string" && threads.some((t) => t.id === obj.activeThreadId)
        ? obj.activeThreadId
        : null;
    cachedRaw = raw;
    cachedParsed = { activeThreadId, threads };
    return cachedParsed;
  } catch {
    return EMPTY_AI_THREAD_STATE;
  }
}

export function writeAIThreadState(next: AIThreadState): void {
  if (typeof window === "undefined") return;
  try {
    const seenIds = new Set<string>();
    const uniqueThreads: AIThread[] = [];
    for (const thread of next.threads) {
      if (!thread || !thread.id || seenIds.has(thread.id)) continue;
      seenIds.add(thread.id);
      uniqueThreads.push({
        ...thread,
        turns: thread.turns.slice(-MAX_TURNS_PER_THREAD),
      });
      if (uniqueThreads.length >= MAX_THREADS) break;
    }
    const normalized: AIThreadState = {
      activeThreadId: next.activeThreadId,
      threads: uniqueThreads,
    };
    const serialized = JSON.stringify(normalized);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedParsed = normalized;
    window.dispatchEvent(new Event(THREAD_EVENT));
  } catch {
    // Ignore storage restriction errors
  }
}

export function deriveThreadTitle(prompt: string): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New Chat";
  return cleaned.length <= 46 ? cleaned : `${cleaned.slice(0, 43)}...`;
}
