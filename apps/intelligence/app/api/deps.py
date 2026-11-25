import hashlib
import re
import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Protocol

import jwt
from fastapi import Header, HTTPException, Security
from fastapi.security import APIKeyHeader

_KEY = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
_RETIRED_KEY_PREFIXES = ("tg_live_", "tg_sandbox_")
_UUID = re.compile(r"^[0-9a-fA-F-]{36}$")
_JWT_DEFAULT_LIMIT = 60


class RateStoreUnavailable(Exception):
    """The shared rate window could not be read or updated."""


@dataclass(frozen=True)
class ApiKeyRecord:
    key_id: str
    key_hash: str
    rate_limit_per_min: int
    is_active: bool
    user_id: str | None = None
    revoked: bool = False
    account_status: str | None = None


@dataclass(frozen=True)
class AuthContext:
    key_id: str | None
    byok: str | None
    surface: str
    user_id: str | None = None
    scoped: bool = False
    rate_limit_per_min: int = _JWT_DEFAULT_LIMIT


class KeyDirectory(Protocol):
    async def find_active(self, key_hash: str) -> ApiKeyRecord | None: ...

    async def tenant_limit(self, user_id: str) -> int: ...


class MemoryKeyDirectory:
    def __init__(self, records: list[ApiKeyRecord]) -> None:
        self.records = {record.key_hash: record for record in records}

    async def find_active(self, key_hash: str) -> ApiKeyRecord | None:
        record = self.records.get(key_hash)
        if record is None or not record.is_active or record.revoked:
            return None
        return record

    async def tenant_limit(self, user_id: str) -> int:
        limits = [
            record.rate_limit_per_min
            for record in self.records.values()
            if record.user_id == user_id and record.is_active and not record.revoked
        ]
        return min(limits) if limits else _JWT_DEFAULT_LIMIT


class SupabaseKeyDirectory:
    async def find_active(self, key_hash: str) -> ApiKeyRecord | None:
        import asyncio

        from app.core.db import supabase_client

        def read() -> ApiKeyRecord | None:
            response = (
                supabase_client()
                .table("api_keys")
                .select("id,key_hash,rate_limit_per_min,is_active,user_id,revoked_at")
                .eq("key_hash", key_hash)
                .limit(1)
                .execute()
            )
            rows = response.data or []
            if not rows:
                return None
            row = rows[0]
            revoked = row.get("revoked_at") is not None
            active = bool(row["is_active"])
            if revoked or not active:
                return None
            user_id = row.get("user_id")
            account_status: str | None = None
            if user_id:
                prof_resp = (
                    supabase_client()
                    .table("profiles")
                    .select("account_status")
                    .eq("id", str(user_id))
                    .limit(1)
                    .execute()
                )
                prof_rows = prof_resp.data or []
                if prof_rows:
                    raw_status = prof_rows[0].get("account_status")
                    account_status = str(raw_status) if raw_status is not None else None
            return ApiKeyRecord(
                key_id=str(row["id"]),
                key_hash=str(row["key_hash"]),
                rate_limit_per_min=int(row["rate_limit_per_min"]),
                is_active=True,
                user_id=str(user_id) if user_id else None,
                revoked=False,
                account_status=account_status,
            )

        return await asyncio.to_thread(read)

    async def tenant_limit(self, user_id: str) -> int:
        import asyncio

        from app.core.db import supabase_client

        def read() -> int:
            response = (
                supabase_client()
                .table("api_keys")
                .select("rate_limit_per_min")
                .eq("user_id", user_id)
                .eq("is_active", True)
                .is_("revoked_at", "null")
                .execute()
            )
            limits = [int(row["rate_limit_per_min"]) for row in response.data or []]
            return min(limits) if limits else _JWT_DEFAULT_LIMIT

        return await asyncio.to_thread(read)


class SlidingWindow:
    """Process-local cap for MCP session frames. Intelligence quota uses the shared store."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    def allow(self, bucket: str, limit: int) -> int | None:
        current = time.monotonic()
        recent = [stamp for stamp in self._hits.get(bucket, []) if current - stamp < 60]
        if len(recent) >= limit:
            self._hits[bucket] = recent
            return max(1, int(60 - (current - recent[0])) + 1)
        recent.append(current)
        self._hits[bucket] = recent
        return None


_transport_window = SlidingWindow()
_teardown_window = SlidingWindow()


class MemoryRateStore:
    """Test double. Production never falls back to this store."""

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = {}

    async def consume(self, principal_id: str, limit: int) -> int | None:
        current = time.monotonic()
        recent = [stamp for stamp in self._hits.get(principal_id, []) if current - stamp < 60]
        if len(recent) >= limit:
            self._hits[principal_id] = recent
            return max(1, int(60 - (current - recent[0])) + 1)
        recent.append(current)
        self._hits[principal_id] = recent
        return None


# Canonical quota RPC on private.rate_windows. The legacy function stays in the
# database for rollback and is not called from this store.
RATE_WINDOW_RPC = "cointrac_consume_rate_window"


class SupabaseRateStore:
    async def consume(self, principal_id: str, limit: int) -> int | None:
        import asyncio

        from app.core.db import supabase_client

        def read() -> int | None:
            response = (
                supabase_client()
                .rpc(
                    RATE_WINDOW_RPC,
                    {"p_principal": principal_id, "p_limit": limit},
                )
                .execute()
            )
            rows = response.data or []
            row = rows[0] if rows else None
            if not isinstance(row, dict):
                raise RateStoreUnavailable("empty rate window response")
            if row.get("allowed") is True:
                return None
            return max(1, int(row.get("retry_after") or 1))

        try:
            return await asyncio.to_thread(read)
        except RateStoreUnavailable:
            raise
        except Exception as exc:
            raise RateStoreUnavailable(exc.__class__.__name__) from exc


class RateStore(Protocol):
    async def consume(self, principal_id: str, limit: int) -> int | None: ...


_directory: KeyDirectory = SupabaseKeyDirectory()
_rate_store: RateStore = SupabaseRateStore()
current_mcp_auth: ContextVar[ApiKeyRecord | None] = ContextVar("current_mcp_auth", default=None)
current_principal: ContextVar[AuthContext | None] = ContextVar("current_principal", default=None)
_jwt_resolver = None


def install_keys(directory: KeyDirectory) -> None:
    global _directory, _rate_store
    _directory = directory
    _rate_store = MemoryRateStore()


def install_rate_store(store: RateStore) -> None:
    global _rate_store
    _rate_store = store


def install_jwt_resolver(resolver: object) -> None:
    global _jwt_resolver
    _jwt_resolver = resolver


def key_hash(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def rate_principal(record: ApiKeyRecord) -> str:
    if record.user_id:
        return f"user:{record.user_id}"
    return f"api_key:{record.key_id}"


_cointrac_key_scheme = APIKeyHeader(
    name="x-cointrac-key",
    scheme_name="CoinTracKey",
    description="CoinTrac API key, accepted alongside Authorization: Bearer.",
    auto_error=False,
)
_cmc_byok_scheme = APIKeyHeader(
    name="x-cmc-api-key",
    scheme_name="CoinMarketCapBYOK",
    description=(
        "Optional per-request CoinMarketCap Pro API key (BYOK). "
        "Passed strictly in memory; never logged or stored."
    ),
    auto_error=False,
)


def _cointrac_oauth_access_token(token: str) -> bool:
    """True when the bearer is a CoinTrac MCP access token, which REST must reject."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        return False
    return str(header.get("kid") or "").startswith("cointrac-mcp-")


def retired_api_key(raw_key: str) -> bool:
    """True when the raw key still uses a retired TradeGuard prefix."""
    return raw_key.startswith(_RETIRED_KEY_PREFIXES)


def resolve_api_key_headers(
    *,
    cointrac_key: str | None,
    bearer_key: str | None,
) -> tuple[str | None, bool]:
    """Resolve one API key from the CoinTrac header or a bearer token.

    Returns ``(resolved_key, conflict_detected)``.
    """
    candidates = [
        value.strip() for value in (cointrac_key, bearer_key) if value is not None and value.strip()
    ]
    if not candidates:
        return None, False
    unique = set(candidates)
    if len(unique) > 1:
        return None, True
    return candidates[0], False


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        return None
    return parts[1].strip()


async def _resolve_jwt(token: str) -> str:
    from app.api.jwt_auth import SupabaseProfileDirectory, verify_supabase_jwt

    resolver = _jwt_resolver or verify_supabase_jwt
    claims = await resolver(token)
    subject = str(claims["sub"])
    if _UUID.fullmatch(subject) is None:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    try:
        profile = await SupabaseProfileDirectory().get_profile(subject)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Profile store is unavailable") from exc
    if profile is not None and str(profile.get("account_status") or "") in {
        "suspended",
        "pending_deletion",
    }:
        raise HTTPException(status_code=403, detail="Account is not active")
    return subject


async def _lookup_key(raw_key: str) -> ApiKeyRecord | None:
    if _KEY.fullmatch(raw_key) is None or retired_api_key(raw_key):
        return None
    try:
        return await _directory.find_active(key_hash(raw_key))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="API key store is unavailable") from exc


async def _consume(principal_id: str, limit: int) -> None:
    if not principal_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        retry_after = await _rate_store.consume(principal_id, limit)
    except RateStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Rate limit store is unavailable") from exc
    if retry_after is not None:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )


def context_from_key(record: ApiKeyRecord, byok: str | None, surface: str) -> AuthContext:
    return AuthContext(
        key_id=record.key_id,
        byok=byok,
        surface=surface,
        user_id=record.user_id,
        scoped=record.user_id is not None,
        rate_limit_per_min=record.rate_limit_per_min,
    )


async def require_api_key(
    authorization: str | None = Header(default=None),
    x_cointrac_key: str | None = Security(_cointrac_key_scheme),
    x_retired_key: str | None = Header(
        default=None,
        alias="x-tradeguard-key",
        include_in_schema=False,
    ),
    x_cmc_api_key: str | None = Security(_cmc_byok_scheme),
) -> AuthContext:
    """Resolve a principal from a verified JWT or a hashed CoinTrac API key."""
    if x_retired_key is not None and x_retired_key.strip():
        raise HTTPException(status_code=401, detail="Unauthorized")
    bearer = _bearer(authorization)
    jwt_subject: str | None = None
    key_record: ApiKeyRecord | None = None
    bearer_api_key: str | None = None
    if bearer and bearer.count(".") == 2:
        if _cointrac_oauth_access_token(bearer):
            raise HTTPException(status_code=401, detail="Unauthorized")
        jwt_subject = await _resolve_jwt(bearer)
    elif bearer:
        bearer_api_key = bearer

    raw_key, conflict = resolve_api_key_headers(
        cointrac_key=x_cointrac_key,
        bearer_key=bearer_api_key,
    )
    if conflict:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if raw_key is not None:
        if _KEY.fullmatch(raw_key) is None:
            raise HTTPException(status_code=401, detail="Unauthorized")
        key_record = await _lookup_key(raw_key)
        if key_record is None:
            raise HTTPException(status_code=401, detail="Unauthorized")
        if key_record.account_status in {"suspended", "pending_deletion"}:
            raise HTTPException(status_code=403, detail="Account is not active")
    if jwt_subject is None and key_record is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if jwt_subject is not None and key_record is not None and key_record.user_id != jwt_subject:
        raise HTTPException(status_code=401, detail="Unauthorized")

    byok: str | None = None
    if x_cmc_api_key is not None and x_cmc_api_key.strip():
        candidate = x_cmc_api_key.strip()
        if _KEY.fullmatch(candidate) is None:
            raise HTTPException(status_code=400, detail="Invalid x-cmc-api-key header format")
        byok = candidate

    if key_record is not None and jwt_subject is None:
        limit = (
            await _directory.tenant_limit(key_record.user_id)
            if key_record.user_id
            else key_record.rate_limit_per_min
        )
        await _consume(rate_principal(key_record), limit)
        context = context_from_key(key_record, byok, "rest")
    else:
        assert jwt_subject is not None
        limit = await _directory.tenant_limit(jwt_subject)
        await _consume(f"user:{jwt_subject}", limit)
        context = AuthContext(
            key_id=key_record.key_id if key_record is not None else None,
            byok=byok,
            surface="rest",
            user_id=jwt_subject,
            scoped=True,
            rate_limit_per_min=limit,
        )
    current_principal.set(context)
    return context


async def authenticate_mcp_key(
    raw_key: str | None,
) -> tuple[ApiKeyRecord | None, tuple[int, dict[str, str], str] | None]:
    """Authenticate an MCP request. Revoked and inactive keys are rejected."""
    if raw_key is None or raw_key.count(".") == 2 or _KEY.fullmatch(raw_key) is None:
        return None, (
            401,
            {},
            "Unauthorized: pass Authorization: Bearer <key> or x-cointrac-key",
        )
    try:
        record = await _lookup_key(raw_key)
    except HTTPException as exc:
        return None, (exc.status_code, {}, str(exc.detail))
    if record is None:
        return None, (401, {}, "Unauthorized")
    if record.account_status in {"suspended", "pending_deletion"}:
        return None, (403, {}, "Account is not active")
    return record, None


async def check_mcp_transport_limit(
    record: ApiKeyRecord,
    method: str,
) -> tuple[int, dict[str, str], str] | None:
    """Cap MCP session frames without debiting the shared intelligence quota.

    POST frames use four times the key limit. DELETE teardown uses a separate
    bucket so closing a session is not rejected after the frame cap is spent.
    """
    window = _teardown_window if method == "DELETE" else _transport_window
    retry_after = window.allow(rate_principal(record), record.rate_limit_per_min * 4)
    if retry_after is None:
        return None
    return 429, {"Retry-After": str(retry_after)}, "Rate limit exceeded"


async def check_mcp_tool_limit(record: ApiKeyRecord) -> int | None:
    """Count one MCP tool call against the shared tenant or unscoped-key window."""
    limit = (
        await _directory.tenant_limit(record.user_id)
        if record.user_id
        else record.rate_limit_per_min
    )
    try:
        return await _rate_store.consume(rate_principal(record), limit)
    except RateStoreUnavailable as exc:
        raise HTTPException(status_code=503, detail="Rate limit store is unavailable") from exc


async def verify_mcp_key(raw_key: str | None) -> tuple[int, dict[str, str], str] | None:
    record, auth_err = await authenticate_mcp_key(raw_key)
    if auth_err is not None or record is None:
        return auth_err
    return await check_mcp_transport_limit(record, "POST")
