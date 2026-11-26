"""Browser consent. The approved user id comes from the verified session only."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from html import escape
from urllib.parse import urlencode, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.oauth.identity import browser_session
from app.oauth.runtime import get_oauth_runtime, new_code

router = APIRouter(tags=["OAuth"])
ConsentAuthenticator = Callable[[str, str], Awaitable[str]]
_authenticator: ConsentAuthenticator | None = None

_COINTRAC_MARK = (
    '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" '
    'xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
    '<rect width="28" height="28" rx="7" fill="#1769FF"/>'
    '<path d="M19.5 10.2C18.3 8.85 16.55 8 14.5 8C10.9 8 8 10.7 8 14C8 17.3 10.9 20 '
    '14.5 20C16.6 20 18.4 19.1 19.6 17.65" stroke="#FFFFFF" stroke-width="2.3" '
    'stroke-linecap="round"/>'
    '<circle cx="19.5" cy="14" r="2" fill="#FFFFFF"/>'
    "</svg>"
)

_STYLES = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(900px 420px at 50% -10%, rgba(6, 182, 212, 0.16), transparent 65%),
    radial-gradient(640px 320px at 85% 10%, rgba(37, 99, 235, 0.12), transparent 60%),
    #080B12;
  color: #F4F7FB;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.shell { width: 100%; max-width: 28rem; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  text-decoration: none;
  color: #F4F7FB;
  font-weight: 600;
  font-size: 1rem;
  letter-spacing: -0.02em;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  border: 1px solid rgba(34, 211, 238, 0.28);
  background: rgba(6, 182, 212, 0.1);
  color: #22D3EE;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.dot { width: 6px; height: 6px; border-radius: 999px; background: #10B981; }
.card {
  background: linear-gradient(180deg, rgba(18, 24, 38, 0.96), rgba(13, 17, 27, 0.98));
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 18px;
  padding: 1.75rem;
  box-shadow: 0 24px 64px -20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(6, 182, 212, 0.08);
}
.header { margin-bottom: 1.25rem; }
h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #F8FAFC;
}
.subtitle {
  margin: 0.45rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: #94A3B8;
}
.client-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 0.875rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(8, 11, 18, 0.65);
  margin-bottom: 1.25rem;
}
.client-name { font-size: 0.875rem; font-weight: 600; color: #F8FAFC; }
.client-host {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
  color: #22D3EE;
  margin-top: 0.15rem;
  word-break: break-all;
}
.scope-badge {
  flex-shrink: 0;
  padding: 0.25rem 0.55rem;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(30, 41, 59, 0.65);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
  color: #CBD5E1;
}
.alert {
  margin-bottom: 1rem;
  padding: 0.75rem 0.875rem;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.42);
  background: rgba(239, 68, 68, 0.12);
  color: #FCA5A5;
  font-size: 0.8125rem;
  line-height: 1.45;
}
.field { margin-bottom: 1rem; }
label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: #CBD5E1;
}
input[type="email"], input[type="password"] {
  width: 100%;
  min-height: 2.75rem;
  padding: 0.625rem 0.875rem;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: #080B12;
  color: #F8FAFC;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input[type="email"]:focus, input[type="password"]:focus {
  border-color: #06B6D4;
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.16);
}
.perms {
  margin: 0 0 1.25rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(8, 11, 18, 0.55);
  list-style: none;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #CBD5E1;
}
.perms li + li { margin-top: 0.5rem; }
.ok { color: #34D399; font-weight: 600; margin-right: 0.4rem; }
.no { color: #94A3B8; font-weight: 600; margin-right: 0.4rem; }
.btn {
  width: 100%;
  min-height: 2.75rem;
  border-radius: 10px;
  border: 1px solid transparent;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  transition: opacity 0.15s ease, transform 0.1s ease;
}
.btn:active { transform: translateY(1px); }
.btn-primary {
  background: linear-gradient(135deg, #06B6D4 0%, #2563EB 100%);
  color: #FFFFFF;
  box-shadow: 0 10px 26px -10px rgba(6, 182, 212, 0.65);
}
.btn-primary:hover { opacity: 0.94; }
.btn-secondary {
  background: transparent;
  border-color: rgba(148, 163, 184, 0.25);
  color: #CBD5E1;
  margin-top: 0.625rem;
}
.btn-secondary:hover { background: rgba(148, 163, 184, 0.08); color: #F8FAFC; }
.btn-ghost {
  background: none;
  border: none;
  color: #94A3B8;
  font-size: 0.75rem;
  margin-top: 0.75rem;
  width: auto;
  min-height: 2rem;
  padding: 0 0.25rem;
  text-decoration: underline;
  cursor: pointer;
}
.btn-ghost:hover { color: #F8FAFC; }
.links {
  margin-top: 1.125rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: #94A3B8;
}
.links a { color: #22D3EE; text-decoration: none; font-weight: 500; }
.links a:hover { text-decoration: underline; }
.meta {
  margin-top: 1rem;
  text-align: center;
  font-size: 0.72rem;
  line-height: 1.5;
  color: #64748B;
}
.meta code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #94A3B8;
}
"""


def install_consent_authenticator(authenticator: ConsentAuthenticator | None) -> None:
    global _authenticator
    _authenticator = authenticator


def _runtime():
    runtime = get_oauth_runtime()
    if runtime is None:
        raise HTTPException(status_code=503, detail="OAuth authorization server is not configured")
    return runtime


async def _posted(request: Request) -> dict[str, str]:
    form = await request.form()
    return {str(key): str(value) for key, value in form.items()}


def _cookie_secure(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip() == "https"
    return request.url.scheme == "https"


def _csrf_ok(request: Request, posted: str, expected: str) -> bool:
    cookie = request.cookies.get("cointrac_oauth_csrf", "")
    return bool(posted) and posted == expected and cookie == expected


def _redirect_host(redirect_uri: str) -> str:
    parsed = urlparse(redirect_uri)
    return parsed.netloc or redirect_uri


def _page(title: str, body: str, *, footer_note: str = "") -> HTMLResponse:
    document = (
        '<!DOCTYPE html><html lang="en"><head>'
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{escape(title)} · CoinTrac</title>"
        f"<style>{_STYLES}</style>"
        "</head><body>"
        '<div class="shell">'
        '<div class="topbar">'
        '<a class="brand" href="https://cointrac.xyz" target="_blank" rel="noopener noreferrer">'
        f"{_COINTRAC_MARK}<span>CoinTrac</span>"
        "</a>"
        '<span class="pill"><span class="dot"></span>OAuth 2.1 · PKCE</span>'
        "</div>"
        f'<main class="card">{body}</main>'
        f'<p class="meta">{footer_note}</p>'
        "</div>"
        "</body></html>"
    )
    return HTMLResponse(document, headers={"Cache-Control": "no-store"})


def _pending_or_400(runtime: object, request_id: str):
    pending = runtime.store.get_pending(request_id)
    if pending is None:
        raise HTTPException(status_code=400, detail="authorization request expired")
    return pending


def _error_banner(error: str) -> str:
    if error == "invalid_credentials":
        return (
            '<div class="alert" role="alert">'
            "Invalid email or password. Verify your CoinTrac credentials and try again."
            "</div>"
        )
    if error == "auth_unavailable":
        return (
            '<div class="alert" role="alert">'
            "Authentication service is temporarily unavailable. Please try again shortly."
            "</div>"
        )
    if error == "session_expired":
        return (
            '<div class="alert" role="alert">'
            "Your sign-in session expired. Please sign in again to continue."
            "</div>"
        )
    return ""


@router.get("/oauth")
async def oauth_root() -> RedirectResponse:
    return RedirectResponse("https://cointrac.xyz/connect", status_code=302)


@router.get("/oauth/consent")
async def consent(request: Request, request_id: str, error: str = "") -> HTMLResponse:
    runtime = _runtime()
    pending = _pending_or_400(runtime, request_id)
    client = runtime.store.get_client(pending.client_id)
    if client is None or request.cookies.get("cointrac_oauth_csrf") != pending.csrf_token:
        raise HTTPException(status_code=400, detail="authorization request expired")
    session = request.cookies.get("cointrac_oauth_session", "")
    client_name = escape(client.client_name)
    callback_host = escape(_redirect_host(pending.redirect_uri))
    scope_label = escape(pending.scope)
    hidden = (
        f'<input type="hidden" name="request_id" value="{escape(request_id)}">'
        f'<input type="hidden" name="csrf" value="{escape(pending.csrf_token)}">'
    )
    client_card = (
        '<div class="client-box">'
        "<div>"
        f'<div class="client-name">{client_name}</div>'
        f'<div class="client-host">Callback: {callback_host}</div>'
        "</div>"
        f'<span class="scope-badge">{scope_label}</span>'
        "</div>"
    )

    if not session:
        return _page(
            "Sign in",
            '<div class="header">'
            f"<h1>Sign in to authorize {client_name}</h1>"
            '<p class="subtitle">'
            "Use your verified CoinTrac account. Credentials stay on CoinTrac and are never shared "
            f"with {client_name}."
            "</p>"
            "</div>"
            f"{client_card}"
            f"{_error_banner(error)}"
            '<form method="post" action="/oauth/consent/session">'
            f"{hidden}"
            '<div class="field">'
            '<label for="email">Email address</label>'
            '<input id="email" name="email" type="email" autocomplete="username" '
            'placeholder="you@domain.com" required autofocus>'
            "</div>"
            '<div class="field">'
            '<label for="password">Password</label>'
            '<input id="password" name="password" type="password" '
            'autocomplete="current-password" placeholder="Enter your CoinTrac password" required>'
            "</div>"
            '<button class="btn btn-primary" type="submit">Continue to Authorization</button>'
            "</form>"
            '<div class="links">'
            '<a href="https://cointrac.xyz/signup" target="_blank" rel="noopener noreferrer">'
            "Create CoinTrac account &nearr;</a>"
            '<a href="https://cointrac.xyz/reset-password" '
            'target="_blank" rel="noopener noreferrer">'
            "Forgot password?</a>"
            "</div>",
            footer_note="Secured by CoinTrac Identity · Verified redirect to "
            f"<code>{callback_host}</code>",
        )

    try:
        user_id = await browser_session(session)
    except HTTPException:
        return _page(
            "Session expired",
            '<div class="header">'
            "<h1>Sign-in session expired</h1>"
            '<p class="subtitle">Please sign in again to authorize this MCP connection.</p>'
            "</div>"
            '<form method="post" action="/oauth/consent/switch">'
            f"{hidden}"
            '<button class="btn btn-primary" type="submit">Sign in again</button>'
            "</form>",
        )

    return _page(
        "Authorize Access",
        '<div class="header">'
        f"<h1>Authorize {client_name}</h1>"
        '<p class="subtitle">'
        f"Review what {client_name} can access under your CoinTrac account."
        "</p>"
        "</div>"
        f"{client_card}"
        '<ul class="perms">'
        '<li><span class="ok">&#10003;</span>Run CoinTrac market intelligence tools &amp; read '
        "evidence provenance (<code>mcp:tools</code>)</li>"
        '<li><span class="ok">&#10003;</span>Usage &amp; rate limits billed against your CoinTrac '
        "account quota</li>"
        '<li><span class="no">&#10005;</span>Cannot read or revoke API keys, change passwords, or '
        "modify account settings</li>"
        "</ul>"
        '<form method="post" action="/oauth/consent/decision">'
        f"{hidden}"
        '<button class="btn btn-primary" type="submit" name="approve" value="yes">'
        f"Approve &amp; Connect {client_name}"
        "</button>"
        '<button class="btn btn-secondary" type="submit" name="approve" value="no">'
        "Deny Access</button>"
        "</form>"
        '<div class="links" style="align-items:center">'
        f'<span>Account ID: <code style="color:#CBD5E1">{escape(user_id)}</code></span>'
        '<form method="post" action="/oauth/consent/switch" style="margin:0">'
        f"{hidden}"
        '<button class="btn-ghost" type="submit" style="margin:0">Switch account</button>'
        "</form>"
        "</div>",
        footer_note="After approval, CoinTrac redirects your browser back to "
        f"<code>{callback_host}</code>",
    )


@router.post("/oauth/consent/switch")
async def consent_switch(request: Request) -> RedirectResponse:
    runtime = _runtime()
    posted = await _posted(request)
    pending = _pending_or_400(runtime, posted.get("request_id", ""))
    if not _csrf_ok(request, posted.get("csrf", ""), pending.csrf_token):
        raise HTTPException(status_code=400, detail="authorization request expired")
    response = RedirectResponse(f"/oauth/consent?request_id={pending.request_id}", status_code=303)
    response.delete_cookie("cointrac_oauth_session", path="/oauth")
    return response


@router.post("/oauth/consent/session")
async def consent_session(request: Request) -> RedirectResponse:
    runtime = _runtime()
    posted = await _posted(request)
    pending = _pending_or_400(runtime, posted.get("request_id", ""))
    if not _csrf_ok(request, posted.get("csrf", ""), pending.csrf_token):
        raise HTTPException(status_code=400, detail="authorization request expired")
    try:
        if _authenticator is None:
            from app.oauth.identity import supabase_password_session

            token = await supabase_password_session(
                posted.get("email", ""),
                posted.get("password", ""),
            )
        else:
            token = await _authenticator(posted.get("email", ""), posted.get("password", ""))
    except HTTPException as exc:
        err_code = "auth_unavailable" if exc.status_code >= 500 else "invalid_credentials"
        return RedirectResponse(
            f"/oauth/consent?request_id={pending.request_id}&error={err_code}",
            status_code=303,
        )
    response = RedirectResponse(f"/oauth/consent?request_id={pending.request_id}", status_code=303)
    response.set_cookie(
        "cointrac_oauth_session",
        token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        max_age=600,
        path="/oauth",
    )
    return response


@router.post("/oauth/consent/decision")
async def consent_decision(request: Request) -> RedirectResponse:
    runtime = _runtime()
    posted = await _posted(request)
    pending = _pending_or_400(runtime, posted.get("request_id", ""))
    if not _csrf_ok(request, posted.get("csrf", ""), pending.csrf_token):
        raise HTTPException(status_code=400, detail="authorization request expired")
    if posted.get("approve") == "no":
        runtime.store.pop_request(pending.request_id)
        query = urlencode({"error": "access_denied", "state": pending.state})
        return RedirectResponse(f"{pending.redirect_uri}?{query}", status_code=302)
    if posted.get("approve") != "yes":
        raise HTTPException(status_code=400, detail="authorization was not approved")
    user_id = await browser_session(request.cookies.get("cointrac_oauth_session", ""))
    if runtime.store.pop_request(pending.request_id) is None:
        raise HTTPException(status_code=400, detail="authorization request expired")
    raw_code, code = new_code(pending, user_id)
    runtime.store.save_code(code)
    runtime.store.save_consent(user_id, pending.client_id, pending.scope)
    query = urlencode({"code": raw_code, "state": pending.state})
    return RedirectResponse(f"{pending.redirect_uri}?{query}", status_code=302)
