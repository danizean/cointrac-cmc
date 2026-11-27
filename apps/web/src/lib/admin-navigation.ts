/**
 * Pure navigation, breadcrumb, and command-palette definitions for the
 * dedicated CoinTrac Super Admin Control Plane (/app/admin/**).
 * Completely isolated from the regular trader/developer workspace navigation.
 */

import type { BreadcrumbItem } from "@/components/ui/primitives";
import type { Locale } from "./i18n";

export const ADMIN_SIDEBAR_COLLAPSED_KEY = "ct_admin_sidebar_collapsed";

export function readAdminSidebarCollapsed(read: (key: string) => string | null): boolean {
  try {
    return read(ADMIN_SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export type AdminNavId = "overview" | "users" | "runtime" | "sandbox" | "audit";

export type AdminGroupId = "control" | "governance";

export interface AdminNavItem {
  id: AdminNavId;
  group: AdminGroupId;
  href: string;
  label: { en: string; id: string };
  description: { en: string; id: string };
}

export const ADMIN_GROUPS: ReadonlyArray<{
  id: AdminGroupId;
  label: { en: string; id: string };
}> = [
  { id: "control", label: { en: "Control Plane", id: "Pusat Kendali" } },
  { id: "governance", label: { en: "Policy & Audit", id: "Kebijakan & Audit" } },
];

export const ADMIN_NAV_ITEMS: ReadonlyArray<AdminNavItem> = [
  {
    id: "overview",
    group: "control",
    href: "/app/admin",
    label: { en: "Executive Overview", id: "Ringkasan Eksekutif" },
    description: {
      en: "AI burn rate, cache savings, tool telemetry, and system health",
      id: "Konsumsi AI, efisiensi cache, telemetri tool, dan kesehatan sistem",
    },
  },
  {
    id: "users",
    group: "control",
    href: "/app/admin/users",
    label: { en: "Users & Quotas", id: "Pengguna & Kuota" },
    description: {
      en: "Per-user AI rate limits, daily allowances, pause toggles, and roles",
      id: "Rate limit per pengguna, kuota harian, status AI, dan role admin",
    },
  },
  {
    id: "runtime",
    group: "governance",
    href: "/app/admin/runtime",
    label: { en: "AI Runtime & Policy", id: "Mesin AI & Kebijakan" },
    description: {
      en: "Global kill switch, Muse Spark 1.3 credentials, and inference tuning",
      id: "Kill switch global, kredensial Muse Spark 1.3, dan tuning inferensi",
    },
  },
  {
    id: "sandbox",
    group: "governance",
    href: "/app/admin/sandbox",
    label: { en: "AI Live Sandbox", id: "Uji Coba CoinTrac AI" },
    description: {
      en: "Test Muse Spark 1.3 live with current system directive and runtime settings",
      id: "Uji langsung CoinTrac AI sesuai system directive dan setting runtime aktif",
    },
  },
  {
    id: "audit",
    group: "governance",
    href: "/app/admin/audit",
    label: { en: "Audit & Telemetry", id: "Log Audit & Telemetri" },
    description: {
      en: "Inspect live request logs, rate-limit blocks, latency, and evidence links",
      id: "Inspeksi log permintaan, blokir limit, latensi, dan jejak bukti data",
    },
  },
];

export function isAdminRoutePath(pathname: string): boolean {
  return pathname === "/app/admin" || pathname.startsWith("/app/admin/");
}

export function isAdminNavActive(item: AdminNavItem, pathname: string): boolean {
  if (item.href === "/app/admin") {
    return pathname === "/app/admin";
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function breadcrumbsForAdminPath(pathname: string, locale: Locale): BreadcrumbItem[] {
  const rootLabel = "Super Admin";
  if (pathname === "/app/admin") {
    return [
      { label: rootLabel },
      { label: locale === "id" ? "Ringkasan Eksekutif" : "Executive Overview" },
    ];
  }

  const matched = ADMIN_NAV_ITEMS.find(
    (item) => item.href !== "/app/admin" && (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
  if (matched) {
    return [
      { label: rootLabel, href: "/app/admin" },
      { label: matched.label[locale] },
    ];
  }

  return [{ label: rootLabel, href: "/app/admin" }];
}

export interface AdminCommandItem {
  id: string;
  section: "Control Plane" | "Quick Actions";
  title: string;
  subtitle: string;
  href: string;
  keywords: string[];
}

export function buildAdminCommands(locale: Locale): AdminCommandItem[] {
  const navCommands: AdminCommandItem[] = ADMIN_NAV_ITEMS.map((item) => ({
    id: `admin-${item.id}`,
    section: "Control Plane",
    title: item.label[locale],
    subtitle: item.description[locale],
    href: item.href,
    keywords: [item.id, item.label.en, item.label.id, item.href],
  }));

  const quickCommands: AdminCommandItem[] = [
    {
      id: "admin-killswitch",
      section: "Quick Actions",
      title: locale === "id" ? "Atur Kill Switch & API Key Muse" : "Manage Muse Kill Switch & API Key",
      subtitle: "/app/admin/runtime",
      href: "/app/admin/runtime",
      keywords: ["kill switch", "muse", "api key", "model", "pause", "temperature", "ttl"],
    },
    {
      id: "admin-manage-users",
      section: "Quick Actions",
      title: locale === "id" ? "Ubah Limit atau Role Pengguna" : "Edit User Quotas or Platform Role",
      subtitle: "/app/admin/users",
      href: "/app/admin/users",
      keywords: ["quota", "rate limit", "role", "promote", "suspend", "user", "tokens"],
    },
    {
      id: "admin-inspect-errors",
      section: "Quick Actions",
      title: locale === "id" ? "Periksa Log Rate Limit & Error" : "Inspect Rate Limits & Audit Logs",
      subtitle: "/app/admin/audit",
      href: "/app/admin/audit",
      keywords: ["audit", "logs", "429", "error", "latency", "evidence"],
    },
  ];

  return [...navCommands, ...quickCommands];
}

export function filterAdminCommands(
  commands: AdminCommandItem[],
  rawQuery: string,
): AdminCommandItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return commands;
  const terms = query.split(/\s+/).filter(Boolean);
  return commands.filter((cmd) => {
    const haystack = [cmd.title, cmd.subtitle, cmd.section, ...cmd.keywords]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
