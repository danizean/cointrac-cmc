"""Resolve an OAuth consent decision to one Supabase user."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import HTTPException

from app.api.deps import _UUID

AccountStatus = Callable[[str], Awaitable[str]]
_status: AccountStatus | None = None


def install_account_status(checker: AccountStatus | None) -> None:
    global _status
    _status = checker


async def browser_session(token: str) -> str:
    return await resolve_oauth_user(token)


async def account_status(user_id: str) -> str:
    if _status is not None:
        return await _status(user_id)
    from app.api.jwt_auth import SupabaseProfileDirectory

    profile = await SupabaseProfileDirectory().get_profile(user_id)
    if profile is None:
        return "missing"
    return str(profile.get("account_status") or "active")


async def supabase_password_session(email: str, password: str) -> str:
    import httpx

    from app.core.config import get_settings

    settings = get_settings()
    publishable = settings.supabase_publishable_key.get_secret_value().strip()
    base = settings.supabase_url.strip().rstrip("/")
    if not publishable or not base:
        raise HTTPException(status_code=503, detail="Browser sign-in is not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{base}/auth/v1/token?grant_type=password",
            headers={"apikey": publishable, "Content-Type": "application/json"},
            json={"email": email, "password": password},
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="Supabase user session is required")
    payload = response.json()
    token = payload.get("access_token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token:
        raise HTTPException(status_code=401, detail="Supabase user session is required")
    return token


async def resolve_oauth_user(token: str) -> str:
    from app.api.deps import _jwt_resolver
    from app.api.jwt_auth import SupabaseProfileDirectory, verify_supabase_jwt

    resolver = _jwt_resolver or verify_supabase_jwt
    claims = await resolver(token)
    subject = str(claims["sub"])
    if _UUID.fullmatch(subject) is None:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    if _status is not None:
        status = await _status(subject)
    else:
        profile = await SupabaseProfileDirectory().get_profile(subject)
        status = "missing" if profile is None else str(profile.get("account_status") or "active")
    if status in {"suspended", "pending_deletion", "missing"}:
        raise HTTPException(status_code=403, detail="Account is not active")
    return subject
