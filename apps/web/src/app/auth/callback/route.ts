import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { sanitizeRedirectPath } from "@/lib/auth-redirect";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "recovery",
  "email_change",
  "email",
  "invite",
]);

const FRAGMENT_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>Confirming session</title>
</head>
<body>
  <p>Confirming your session.</p>
  <script>
    (function () {
      var hash = new URLSearchParams(location.hash.charAt(0) === "#" ? location.hash.slice(1) : "");
      var access = hash.get("access_token") || "";
      var refresh = hash.get("refresh_token") || "";
      if (!access || !refresh) {
        location.replace("/login?error=missing_auth_parameters");
        return;
      }
      fetch(location.pathname + location.search, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          access_token: access,
          refresh_token: refresh,
          type: hash.get("type") || ""
        })
      }).then(function (response) {
        var target = response.url && response.url.indexOf(location.origin) === 0
          ? response.url
          : "/login?error=callback_exchange_failed";
        location.replace(target);
      }).catch(function () {
        location.replace("/login?error=callback_exchange_failed");
      });
    })();
  </script>
</body>
</html>`;

function redirectNoStore(url: URL) {
  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

function loginError(origin: string, code: string) {
  const errUrl = new URL("/login", origin);
  errUrl.searchParams.set("error", code);
  return redirectNoStore(errUrl);
}

function clientOnResponse(request: NextRequest, response: NextResponse): SupabaseClient | null {
  const cfg = getSupabasePublicConfig();
  if (!cfg) return null;
  return createServerClient(cfg.url, cfg.publishableKey, {
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
}

function isToken(value: unknown, min: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= 8192 && !/\s/.test(value);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code")?.trim() ?? "";
  const tokenHash = searchParams.get("token_hash")?.trim() ?? "";
  const rawType = searchParams.get("type")?.trim() ?? "";
  const nextRaw = searchParams.get("next");
  const defaultTarget = rawType === "recovery" ? "/reset-password?mode=update" : "/app";
  const safeNext = sanitizeRedirectPath(nextRaw, defaultTarget);

  if (!getSupabasePublicConfig()) {
    return loginError(origin, "auth_not_configured");
  }

  if (!code && !(tokenHash && ALLOWED_OTP_TYPES.has(rawType as EmailOtpType))) {
    return new NextResponse(FRAGMENT_PAGE, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  const response = redirectNoStore(new URL(safeNext, origin));
  const supabase = clientOnResponse(request, response);
  if (!supabase) return loginError(origin, "auth_not_configured");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return loginError(origin, "callback_exchange_failed");
    return response;
  }

  const { error } = await supabase.auth.verifyOtp({
    type: rawType as EmailOtpType,
    token_hash: tokenHash,
  });
  if (error) return loginError(origin, "verification_link_invalid");
  return response;
}

export async function POST(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  let payload: { access_token?: unknown; refresh_token?: unknown; type?: unknown };
  try {
    payload = await request.json();
  } catch {
    return loginError(origin, "missing_auth_parameters");
  }

  if (!isToken(payload.access_token, 20) || !isToken(payload.refresh_token, 10)) {
    return loginError(origin, "missing_auth_parameters");
  }

  const queryType = searchParams.get("type")?.trim() ?? "";
  const hashType = typeof payload.type === "string" ? payload.type.trim() : "";
  const recovery = queryType === "recovery" || hashType === "recovery";
  const safeNext = sanitizeRedirectPath(
    searchParams.get("next"),
    recovery ? "/reset-password?mode=update" : "/app",
  );
  const response = redirectNoStore(new URL(safeNext, origin));
  const supabase = clientOnResponse(request, response);
  if (!supabase) return loginError(origin, "auth_not_configured");

  const { error } = await supabase.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) return loginError(origin, "callback_exchange_failed");
  return response;
}
