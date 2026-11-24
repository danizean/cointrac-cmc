import "server-only";

const LOCAL_INTELLIGENCE_API = "http://127.0.0.1:8000";

export function intelligenceApiUrl(): string {
  const configured = process.env.INTELLIGENCE_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return "https://api.cointrac.xyz";
  return LOCAL_INTELLIGENCE_API;
}

export function sandboxApiKey(): string | undefined {
  const key = process.env.SANDBOX_API_KEY?.trim();
  if (!key || key.startsWith("your_") || /[\r\n]/.test(key)) return undefined;
  return key;
}
