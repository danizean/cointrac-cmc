"""Verified Supabase JWT authentication for FastAPI (Stage 5.1).

Security invariants:
- Validates cryptographic signature using Supabase asymmetric JWKS (ES256/RS256).
  Explicitly rejects alg='none' and symmetric HS256 downgrade attacks.
- Strictly validates issuer (iss), audience (aud='authenticated'), expiration (exp),
  and UUID subject (sub).
- Never trusts client-supplied x-user-id / x-tenant-id headers.
- Never reads user-editable raw_user_meta_data / user_metadata for authorization,
  plan, or entitlement decisions.
- Keeps SUPABASE_SERVICE_ROLE_KEY strictly server-side.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Protocol
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, Header, HTTPException
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.core.config import get_settings

ALLOWED_JWT_ALGORITHMS = ("ES256", "RS256")
REQUIRED_AUDIENCE = "authenticated"
JWKS_CACHE_TTL_SECONDS = 300.0
CLOCK_SKEW_LEEWAY_SECONDS = 5


@dataclass(frozen=True)
class AuthenticatedUser:
    """Server-verified identity derived strictly from validated Supabase JWT + profile."""

    user_id: str
    email: str | None
    email_verified: bool
    role: str
    base_plan_code: str
    account_status: str
    display_name: str | None = None
    created_at: str | None = None
    profile_provisioned: bool = False
    platform_role: str = "user"

    @property
    def is_super_admin(self) -> bool:
        if self.platform_role == "super_admin":
            return True
        if self.email_verified and self.email:
            return self.email.strip().lower() in get_settings().super_admin_email_set()
        return False


class JWKSProvider(Protocol):
    async def get_keys(self, *, force_refresh: bool = False) -> list[dict[str, Any]]: ...


class ProfileDirectory(Protocol):
    async def get_profile(self, user_id: str) -> dict[str, Any] | None: ...


class SupabaseJWKSProvider:
    """Async cached fetcher for {SUPABASE_URL}/auth/v1/.well-known/jwks.json."""

    def __init__(self, jwks_url: str | None = None, ttl_seconds: float = JWKS_CACHE_TTL_SECONDS):
        self._jwks_url = jwks_url
        self._ttl_seconds = ttl_seconds
        self._keys: list[dict[str, Any]] = []
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    def _resolve_url(self) -> str:
        if self._jwks_url:
            return self._jwks_url
        base = get_settings().supabase_url.strip().rstrip("/")
        if not base:
            raise HTTPException(status_code=503, detail="Supabase Auth is not configured")
        return f"{base}/auth/v1/.well-known/jwks.json"

    async def get_keys(self, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        now = time.monotonic()
        if not force_refresh and self._keys and now < self._expires_at:
            return self._keys
        async with self._lock:
            now = time.monotonic()
            if not force_refresh and self._keys and now < self._expires_at:
                return self._keys
            url = self._resolve_url()
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(url)
                    response.raise_for_status()
                    payload = response.json()
            except Exception as exc:
                if self._keys:
                    return self._keys
                raise HTTPException(
                    status_code=503,
                    detail="Unable to retrieve Supabase JWKS signing keys",
                ) from exc
            keys = payload.get("keys") if isinstance(payload, dict) else None
            if not isinstance(keys, list) or not keys:
                raise HTTPException(status_code=503, detail="Supabase JWKS response is empty")
            self._keys = [k for k in keys if isinstance(k, dict)]
            self._expires_at = time.monotonic() + self._ttl_seconds
            return self._keys


class SupabaseProfileDirectory:
    """Reads server-authoritative profile rows from public.profiles via service role."""

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        from app.core.db import supabase_client

        def read() -> dict[str, Any] | None:
            client = supabase_client()
            try:
                response = (
                    client.table("profiles")
                    .select(
                        "id,email,display_name,base_plan_code,account_status,"
                        "platform_role,email_verified_at,created_at"
                    )
                    .eq("id", user_id)
                    .limit(1)
                    .execute()
                )
            except Exception:
                # Backward-compatible fallback if migration 015 has not added platform_role yet.
                response = (
                    client.table("profiles")
                    .select(
                        "id,email,display_name,base_plan_code,account_status,"
                        "email_verified_at,created_at"
                    )
                    .eq("id", user_id)
                    .limit(1)
                    .execute()
                )
            rows = response.data or []
            return dict(rows[0]) if rows else None

        try:
            return await asyncio.to_thread(read)
        except Exception:
            # Fail safely: if profiles migration is not yet applied, caller sees
            # profile_provisioned=False and conservative 'free' / unverified defaults
            # without crashing health or leaking DB internals.
            return None


_jwks_provider: JWKSProvider = SupabaseJWKSProvider()
_profile_directory: ProfileDirectory = SupabaseProfileDirectory()


def install_jwt_auth_deps(
    *,
    jwks_provider: JWKSProvider | None = None,
    profile_directory: ProfileDirectory | None = None,
) -> None:
    """Dependency injection hook for deterministic unit/security tests."""
    global _jwks_provider, _profile_directory
    if jwks_provider is not None:
        _jwks_provider = jwks_provider
    if profile_directory is not None:
        _profile_directory = profile_directory


def reset_jwt_auth_deps() -> None:
    global _jwks_provider, _profile_directory
    _jwks_provider = SupabaseJWKSProvider()
    _profile_directory = SupabaseProfileDirectory()


def _expected_issuer() -> str:
    base = get_settings().supabase_url.strip().rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="Supabase Auth is not configured")
    return f"{base}/auth/v1"


def _jwk_to_public_key(jwk: dict[str, Any]) -> Any:
    kty = str(jwk.get("kty") or "")
    if kty == "EC":
        return ECAlgorithm.from_jwk(jwk)
    if kty == "RSA":
        return RSAAlgorithm.from_jwk(jwk)
    raise HTTPException(status_code=401, detail="Unsupported JWT signing key type")


def _find_matching_jwk(keys: list[dict[str, Any]], kid: str | None) -> dict[str, Any] | None:
    if kid:
        for key in keys:
            if key.get("kid") == kid:
                return key
        return None
    return keys[0] if len(keys) == 1 else None


async def verify_supabase_jwt(token: str) -> dict[str, Any]:
    """Cryptographically verify a Supabase access token via JWKS and validate all claims."""
    if not token or token.count(".") != 2 or len(token) > 8192:
        raise HTTPException(status_code=401, detail="Invalid authorization token")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Malformed authorization token") from exc

    alg = str(header.get("alg") or "")
    if alg not in ALLOWED_JWT_ALGORITHMS:
        raise HTTPException(status_code=401, detail="Unsupported JWT algorithm")

    kid = header.get("kid")
    kid_str = str(kid) if isinstance(kid, str) and kid else None

    keys = await _jwks_provider.get_keys(force_refresh=False)
    jwk = _find_matching_jwk(keys, kid_str)
    if jwk is None:
        keys = await _jwks_provider.get_keys(force_refresh=True)
        jwk = _find_matching_jwk(keys, kid_str)
    if jwk is None:
        raise HTTPException(status_code=401, detail="Unknown JWT signing key")

    public_key = _jwk_to_public_key(jwk)
    expected_issuer = _expected_issuer()

    try:
        claims: dict[str, Any] = jwt.decode(
            token,
            key=public_key,
            algorithms=[alg],
            audience=REQUIRED_AUDIENCE,
            issuer=expected_issuer,
            leeway=CLOCK_SKEW_LEEWAY_SECONDS,
            options={
                "require": ["sub", "exp", "aud", "iss"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_aud": True,
                "verify_iss": True,
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Session token has expired") from exc
    except jwt.InvalidAudienceError as exc:
        raise HTTPException(status_code=401, detail="Invalid token audience") from exc
    except jwt.InvalidIssuerError as exc:
        raise HTTPException(status_code=401, detail="Invalid token issuer") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Invalid authorization token") from exc

    sub = claims.get("sub")
    if not isinstance(sub, str):
        raise HTTPException(status_code=401, detail="Invalid token subject")
    try:
        UUID(sub)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token subject") from exc

    # Explicitly strip user-editable metadata so downstream code can never rely on it.
    claims.pop("user_metadata", None)
    claims.pop("raw_user_meta_data", None)
    return claims


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization bearer token")
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(status_code=401, detail="Invalid Authorization header format")
    return parts[1].strip()


async def require_supabase_user(
    authorization: str | None = Header(default=None),
    x_cointrac_key: str | None = Header(default=None, include_in_schema=False),
) -> AuthenticatedUser:
    """Resolve authenticated user strictly from a verified Supabase JWT + server profile."""
    if x_cointrac_key and x_cointrac_key.strip() and not authorization:
        raise HTTPException(
            status_code=401,
            detail=(
                "This endpoint requires a verified user JWT bearer token, "
                "not a CoinTrac API key."
            ),
        )
    token = _extract_bearer_token(authorization)
    if token.startswith("ct_live_") or token.count(".") != 2:
        raise HTTPException(
            status_code=401,
            detail=(
                "This endpoint requires a verified user JWT bearer token, "
                "not a CoinTrac API key."
            ),
        )
    claims = await verify_supabase_jwt(token)

    user_id = str(claims["sub"])
    role = str(claims.get("role") or "authenticated")
    email = claims.get("email") if isinstance(claims.get("email"), str) else None

    profile = await _profile_directory.get_profile(user_id)
    if profile is not None:
        base_plan_code = str(profile.get("base_plan_code") or "free")
        if base_plan_code != "free":
            # Stage 5.1 hard guard: until Stage 5.3 entitlement resolution exists,
            # base_plan_code can never be elevated above 'free'.
            base_plan_code = "free"
        account_status = str(profile.get("account_status") or "active")
        platform_role = (
            "super_admin" if str(profile.get("platform_role") or "") == "super_admin" else "user"
        )
        email_verified = profile.get("email_verified_at") is not None
        display_name = (
            str(profile["display_name"]) if profile.get("display_name") is not None else None
        )
        profile_email = str(profile["email"]) if profile.get("email") else email
        if account_status in {"suspended", "pending_deletion"}:
            raise HTTPException(status_code=403, detail="Account is not active")
        return AuthenticatedUser(
            user_id=user_id,
            email=profile_email,
            email_verified=email_verified,
            role=role,
            base_plan_code=base_plan_code,
            account_status=account_status,
            display_name=display_name,
            created_at=str(profile["created_at"]) if profile.get("created_at") else None,
            profile_provisioned=True,
            platform_role=platform_role,
        )

    # Profile row absent (e.g., before migration 003 is applied): remain conservative.
    return AuthenticatedUser(
        user_id=user_id,
        email=email,
        email_verified=False,
        role=role,
        base_plan_code="free",
        account_status="active",
        display_name=None,
        profile_provisioned=False,
    )


async def require_verified_supabase_user(
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> AuthenticatedUser:
    """Require both a valid Supabase JWT and server-verified email confirmation."""
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Email verification required")
    return user


async def require_super_admin(
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> AuthenticatedUser:
    """Require server-verified super_admin role or configured SUPER_ADMIN_EMAILS allowlist."""
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user
