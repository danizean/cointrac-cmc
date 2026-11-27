"use client";

import { useSyncExternalStore } from "react";
import type { Locale } from "./i18n";

export interface DeskCacheEntry<T> {
  value: T;
  cachedAt: number;
}

const memoryCache = new Map<string, DeskCacheEntry<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const STORAGE_PREFIX = "ct_desk_cache_v1:";

function subscribeKey(key: string, callback: () => void): () => void {
  let keyListeners = listeners.get(key);
  if (!keyListeners) {
    keyListeners = new Set();
    listeners.set(key, keyListeners);
  }
  keyListeners.add(callback);
  return () => {
    keyListeners?.delete(callback);
  };
}

export function readDeskCache<T>(key: string): DeskCacheEntry<T> | null {
  const inMemory = memoryCache.get(key);
  if (inMemory) {
    return inMemory as DeskCacheEntry<T>;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeskCacheEntry<T>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.cachedAt !== "number" ||
      !("value" in parsed)
    ) {
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeDeskCache<T>(key: string, value: T): number {
  const cachedAt = Date.now();
  const entry: DeskCacheEntry<T> = { value, cachedAt };
  memoryCache.set(key, entry);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
    } catch {
      // sessionStorage quota or private mode; in-memory cache still holds this tab's entry
    }
  }
  const keyListeners = listeners.get(key);
  if (keyListeners) {
    for (const notify of keyListeners) notify();
  }
  return cachedAt;
}

export function useDeskCache<T>(key: string): DeskCacheEntry<T> | null {
  return useSyncExternalStore(
    (callback) => subscribeKey(key, callback),
    () => readDeskCache<T>(key),
    () => null,
  );
}

export function formatRelativeCacheAge(cachedAt: number | null, locale: Locale): string | null {
  if (cachedAt === null) return null;
  const elapsedSec = Math.max(0, Math.floor((Date.now() - cachedAt) / 1000));
  if (elapsedSec < 5) {
    return locale === "id" ? "Baru dimuat" : "Just now";
  }
  if (elapsedSec < 60) {
    return locale === "id" ? `${elapsedSec} dtk lalu` : `${elapsedSec}s ago`;
  }
  const mins = Math.floor(elapsedSec / 60);
  if (mins < 60) {
    return locale === "id" ? `${mins} mnt lalu` : `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  return locale === "id" ? `${hrs} jam lalu` : `${hrs}h ago`;
}
