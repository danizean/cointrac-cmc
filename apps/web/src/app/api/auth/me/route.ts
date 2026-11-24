import { NextResponse } from "next/server";
import { intelligenceApiUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server-side authenticated identity check that:
 * 1. Verifies the user via supabase.auth.getUser() (server-validated, not cookie-only).
 * 2. Forwards the user's Supabase JWT to FastAPI GET /v1/auth/me for cryptographic JWKS
 *    verification + authoritative public.profiles lookup.
 * 3. Never uses SANDBOX_API_KEY or SUPABASE_SERVICE_ROLE_KEY.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { detail: "Supabase Auth is not configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { detail: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return NextResponse.json(
      { detail: "Session access token unavailable" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const target = `${intelligenceApiUrl().replace(/\/+$/, "")}/v1/auth/me`;
  try {
    const upstream = await fetch(target, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "manual",
    });

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return NextResponse.json(
        { detail: "Unexpected response from intelligence API" },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { detail: "Intelligence API is unreachable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
