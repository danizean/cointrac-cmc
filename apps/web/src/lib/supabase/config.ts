/**
 * Public Supabase client configuration for Next.js SSR & Browser Auth.
 *
 * Security invariant:
 * - Reads ONLY public NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * - NEVER reads SUPABASE_SERVICE_ROLE_KEY or any secret credential.
 */

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url || !publishableKey) {
    return null;
  }
  if (!url.startsWith("https://") && !url.startsWith("http://127.0.0.1")) {
    return null;
  }
  return { url, publishableKey };
}

export function isSupabaseAuthConfigured(): boolean {
  return getSupabasePublicConfig() !== null;
}
