import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

const PUBLIC_PATHS = [
  "",
  "/product",
  "/pricing",
  "/docs",
  "/integrations",
  "/connect",
  "/playground",
  "/evidence",
  "/login",
  "/signup",
  "/reset-password",
  "/privacy",
  "/terms",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();
  return PUBLIC_PATHS.map((path) => ({
    url: new URL(path || "/", site).toString(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
