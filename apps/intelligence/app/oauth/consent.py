"""Browser consent. The approved user id comes from the verified session only."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from html import escape
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from app.oauth.identity import browser_session
from app.oauth.runtime import get_oauth_runtime, new_code

router = APIRouter(tags=["OAuth"])
ConsentAuthenticator = Callable[[str, str], Awaitable[str]]
_authenticator: ConsentAuthenticator | None = None


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


def _page(title: str, body: str) -> HTMLResponse:
    document = (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        f"<title>{escape(title)}</title></head>"
        '<body style="margin:0;background:#080B12;color:#F4F7FB;font-family:Inter,sans-serif">'
        f'<main style="max-width:32rem;margin:4rem auto;padding:1.5rem">{body}</main>'
        "</body></html>"
    )
    return HTMLResponse(document, headers={"Cache-Control": "no-store"})


def _pending_or_400(runtime: object, request_id: str):
    pending = runtime.store.get_pending(request_id)
    if pending is None:
        raise HTTPException(status_code=400, detail="authorization request expired")
    return pending


@router.get("/oauth/consent")
async def consent(request: Request, request_id: str) -> HTMLResponse:
    runtime = _runtime()
    pending = _pending_or_400(runtime, request_id)
    client = runtime.store.get_client(pending.client_id)
    if client is None or request.cookies.get("cointrac_oauth_csrf") != pending.csrf_token:
        raise HTTPException(status_code=400, detail="authorization request expired")
    session = request.cookies.get("cointrac_oauth_session", "")
    hidden = (
        f'<input type="hidden" name="request_id" value="{escape(request_id)}">'
        f'<input type="hidden" name="csrf" value="{escape(pending.csrf_token)}">'
    )
    if not session:
        return _page(
            "Sign in to CoinTrac",
            "<h1>Sign in</h1>"
            f"<p>{escape(client.client_name)} is requesting access.</p>"
            '<form method="post" action="/oauth/consent/session">'
            f"{hidden}"
            '<label>Email <input name="email" type="email" '
            'autocomplete="username" required></label>'
            '<label>Password <input name="password" type="password" '
            'autocomplete="current-password" required></label>'
            '<button type="submit">Continue</button></form>',
        )
    try:
        user_id = await browser_session(session)
    except HTTPException:
        return _page("Sign in to CoinTrac", "<p>The sign-in session is no longer valid.</p>")
    return _page(
        "Authorize CoinTrac",
        f"<h1>Authorize {escape(client.client_name)}</h1>"
        f"<p>Signed in as {escape(user_id)}.</p>"
        f"<p>Requested scope: {escape(pending.scope)}</p>"
        f"<p>Authorization codes will be sent to {escape(pending.redirect_uri)}.</p>"
        '<form method="post" action="/oauth/consent/decision">'
        f"{hidden}"
        '<button type="submit" name="approve" value="yes">Approve</button>'
        '<button type="submit" name="approve" value="no">Deny</button></form>',
    )


@router.post("/oauth/consent/session")
async def consent_session(request: Request) -> RedirectResponse:
    runtime = _runtime()
    posted = await _posted(request)
    pending = _pending_or_400(runtime, posted.get("request_id", ""))
    if not _csrf_ok(request, posted.get("csrf", ""), pending.csrf_token):
        raise HTTPException(status_code=400, detail="authorization request expired")
    if _authenticator is None:
        from app.oauth.identity import supabase_password_session

        token = await supabase_password_session(posted.get("email", ""), posted.get("password", ""))
    else:
        token = await _authenticator(posted.get("email", ""), posted.get("password", ""))
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
