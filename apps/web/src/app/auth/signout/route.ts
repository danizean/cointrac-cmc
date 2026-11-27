import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function POST(request: NextRequest) {
  const loginUrl = new URL("/login?signed_out=1", request.nextUrl.origin);
  const response = NextResponse.redirect(loginUrl, 303);
  response.headers.set("cache-control", "no-store");

  const cfg = getSupabasePublicConfig();
  if (!cfg) return response;

  const supabase = createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  await supabase.auth.signOut();
  response.cookies.set("ct_recovery", "", { path: "/", maxAge: 0, sameSite: "lax" });
  return response;
}
