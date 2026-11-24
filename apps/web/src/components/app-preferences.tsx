"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DICTIONARIES, LOCALE_PREFERENCE_KEY, type Dictionary, type Locale } from "@/lib/i18n";

export type Theme = "dark" | "light";

const THEME_KEY = "tg_theme";

function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_PREFERENCE_KEY}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Ignore storage access restrictions
  }
  return "dark";
}

interface AppPreferencesValue {
  theme: Theme;
  locale: Locale;
  t: Dictionary;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
  setLocale: (next: Locale) => void;
}

const AppPreferencesContext = createContext<AppPreferencesValue | null>(null);

export function AppPreferencesProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Ignore storage access restrictions
    }
    setThemeState(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  const setLocale = useCallback((next: Locale) => {
    try {
      window.localStorage.setItem(LOCALE_PREFERENCE_KEY, next);
    } catch {
      // Ignore storage access restrictions
    }
    writeLocaleCookie(next);
    setLocaleState(next);
    document.documentElement.lang = next;
  }, []);

  const value: AppPreferencesValue = {
    theme,
    locale,
    t: DICTIONARIES[locale],
    setTheme,
    toggleTheme,
    setLocale,
  };

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences(): AppPreferencesValue {
  const ctx = useContext(AppPreferencesContext);
  if (!ctx) {
    return {
      theme: "dark",
      locale: "en",
      t: DICTIONARIES.en,
      setTheme: () => {},
      toggleTheme: () => {},
      setLocale: () => {},
    };
  }
  return ctx;
}
