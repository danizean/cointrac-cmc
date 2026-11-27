"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fetchAdminAiOverview, type AdminAIOverviewPayload } from "@/lib/control-plane-api";

interface AdminDataContextValue {
  data: AdminAIOverviewPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: { status: number; message: string } | null;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AdminAIOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const res = await fetchAdminAiOverview();
    setRefreshing(false);
    setLoading(false);
    if (!res.ok) {
      setError({ status: res.status, message: res.message });
      return;
    }
    setError(null);
    setData(res.data);
    setLastUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAdminAiOverview().then((res) => {
      if (!active) return;
      setLoading(false);
      if (!res.ok) {
        setError({ status: res.status, message: res.message });
        return;
      }
      setError(null);
      setData(res.data);
      setLastUpdatedAt(Date.now());
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AdminDataContext.Provider
      value={{
        data,
        loading,
        refreshing,
        error,
        lastUpdatedAt,
        refresh,
      }}
    >
      {children}
    </AdminDataContext.Provider>
  );
}

export function useAdminData(): AdminDataContextValue {
  const ctx = useContext(AdminDataContext);
  if (!ctx) {
    throw new Error("useAdminData must be used inside <AdminDataProvider>");
  }
  return ctx;
}
