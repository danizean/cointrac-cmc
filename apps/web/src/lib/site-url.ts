const LOCAL_SITE = "http://localhost:3000";
const PRODUCTION_SITE = "https://cointrac.xyz";

export function siteUrl(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return new URL(configured);
  if (process.env.VERCEL_ENV === "production") return new URL(PRODUCTION_SITE);
  return new URL(LOCAL_SITE);
}
