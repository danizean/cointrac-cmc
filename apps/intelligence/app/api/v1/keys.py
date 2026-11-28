"""Tenant-scoped CoinTrac API key lifecycle endpoints (Phase 4).

Security invariants:
- Requires a cryptographically verified Supabase user with confirmed email
  (require_verified_supabase_user). Never trusts x-user-id / body user_id.
- Generates 256-bit CSPRNG keys (ct_live_<token_urlsafe(32)>).
- Stores ONLY SHA-256 key_hash (reusing app.api.deps.key_hash) and safe key_prefix.
- Returns plaintext key strictly once on HTTP 201 creation with Cache-Control: no-store.
- Never returns key_hash or plaintext key on list/revoke.
- Atomic single-statement revocation setting is_active=False and revoked_at=NOW()
  to satisfy api_keys_revoked_implies_inactive and private.guard_api_key_revocation().
"""

from __future__ import annotations

import asyncio
import logging
import re
import secrets
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.deps import invalidate_key_directory_cache, key_hash
from app.api.jwt_auth import AuthenticatedUser, require_verified_supabase_user

logger = logging.getLogger("cointrac")
router = APIRouter(prefix="/v1/keys", tags=["API Keys"])

MAX_ACTIVE_KEYS_PER_USER = 5
DEFAULT_USER_KEY_RATE_LIMIT = 60
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_KEY_PREFIX_LEN = 14


class CreateKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=64, description="Human-readable API key name")

    @field_validator("label")
    @classmethod
    def _clean_label(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("API key name must not be empty.")
        if _CONTROL_CHARS.search(cleaned):
            raise ValueError("API key name contains invalid characters.")
        return cleaned


class ApiKeySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    key_prefix: str
    masked_key: str
    is_active: bool
    revoked_at: str | None
    rate_limit_per_min: int
    created_at: str
    last_used_at: str | None = None


class CreateKeyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str
    key: ApiKeySummary


class ListKeysResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keys: list[ApiKeySummary]
    active_count: int
    max_active_keys: int


class RevokeKeyResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: ApiKeySummary


class KeyStore(Protocol):
    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]: ...

    async def create_for_user(
        self,
        *,
        user_id: str,
        label: str,
        key_prefix: str,
        key_hash_hex: str,
        rate_limit_per_min: int,
    ) -> dict[str, Any]: ...

    async def revoke_for_user(
        self, *, user_id: str, key_id: str, revoked_at_iso: str
    ) -> dict[str, Any] | None: ...


class SupabaseKeyStore:
    _PUBLIC_COLS = "id,label,key_prefix,is_active,revoked_at,rate_limit_per_min,created_at"

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        from app.core.db import supabase_client

        def read() -> list[dict[str, Any]]:
            resp = (
                supabase_client()
                .table("api_keys")
                .select(self._PUBLIC_COLS)
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def list_last_used_for_user(self, user_id: str) -> dict[str, str]:
        from app.core.db import supabase_client

        def read() -> dict[str, str]:
            resp = (
                supabase_client()
                .table("request_logs")
                .select("api_key_id,created_at")
                .eq("user_id", user_id)
                .not_.is_("api_key_id", "null")
                .order("created_at", desc=True)
                .limit(1000)
                .execute()
            )
            latest: dict[str, str] = {}
            for row in resp.data or []:
                kid = row.get("api_key_id")
                ts = row.get("created_at")
                if kid and ts and str(kid) not in latest:
                    latest[str(kid)] = str(ts)
            return latest

        return await asyncio.to_thread(read)

    async def create_for_user(
        self,
        *,
        user_id: str,
        label: str,
        key_prefix: str,
        key_hash_hex: str,
        rate_limit_per_min: int,
    ) -> dict[str, Any]:
        from app.core.db import supabase_client

        def write() -> dict[str, Any]:
            row = {
                "user_id": user_id,
                "label": label,
                "key_prefix": key_prefix,
                "key_hash": key_hash_hex,
                "is_sandbox": False,
                "rate_limit_per_min": rate_limit_per_min,
                "is_active": True,
            }
            resp = supabase_client().table("api_keys").insert(row).execute()
            rows = resp.data or []
            if not rows:
                raise RuntimeError("API key insert returned no row")
            return dict(rows[0])

        return await asyncio.to_thread(write)

    async def revoke_for_user(
        self, *, user_id: str, key_id: str, revoked_at_iso: str
    ) -> dict[str, Any] | None:
        from app.core.db import supabase_client

        def write() -> dict[str, Any] | None:
            resp = (
                supabase_client()
                .table("api_keys")
                .update({"is_active": False, "revoked_at": revoked_at_iso})
                .eq("id", key_id)
                .eq("user_id", user_id)
                .is_("revoked_at", "null")
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(write)


_key_store: KeyStore = SupabaseKeyStore()


def install_key_store(store: KeyStore) -> None:
    global _key_store
    _key_store = store


def reset_key_store() -> None:
    global _key_store
    _key_store = SupabaseKeyStore()


def _to_summary(row: dict[str, Any], *, last_used_at: str | None = None) -> ApiKeySummary:
    prefix = str(row["key_prefix"])
    resolved_last_used = (
        last_used_at
        if last_used_at is not None
        else (str(row["last_used_at"]) if row.get("last_used_at") is not None else None)
    )
    return ApiKeySummary(
        id=str(row["id"]),
        label=str(row["label"]),
        key_prefix=prefix,
        masked_key=f"{prefix}••••••••••••••••",
        is_active=bool(row["is_active"]) and row.get("revoked_at") is None,
        revoked_at=str(row["revoked_at"]) if row.get("revoked_at") is not None else None,
        rate_limit_per_min=int(row["rate_limit_per_min"]),
        created_at=str(row["created_at"]),
        last_used_at=resolved_last_used,
    )


def _generate_raw_key() -> str:
    return f"ct_live_{secrets.token_urlsafe(32)}"


@router.get(
    "",
    response_model=ListKeysResponse,
    summary="List Owned CoinTrac API Keys",
)
async def list_keys(
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> ListKeysResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        rows = await _key_store.list_for_user(user.user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="API key store is unavailable") from exc

    last_used_by_key: dict[str, str] = {}
    last_used_fn = getattr(_key_store, "list_last_used_for_user", None)
    if rows and callable(last_used_fn):
        try:
            fetched = await last_used_fn(user.user_id)
            if isinstance(fetched, dict):
                last_used_by_key = {str(k): str(v) for k, v in fetched.items() if v}
        except Exception as exc:
            logger.warning("Failed to load last_used_at from request_logs: %s", exc)

    summaries = [
        _to_summary(row, last_used_at=last_used_by_key.get(str(row["id"]))) for row in rows
    ]
    active_count = sum(1 for item in summaries if item.is_active)
    return ListKeysResponse(
        keys=summaries,
        active_count=active_count,
        max_active_keys=MAX_ACTIVE_KEYS_PER_USER,
    )


@router.post(
    "",
    response_model=CreateKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a CoinTrac API Key (Secret Shown Once)",
)
async def create_key(
    body: CreateKeyRequest,
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> CreateKeyResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        existing = await _key_store.list_for_user(user.user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="API key store is unavailable") from exc

    active_count = sum(
        1 for row in existing if bool(row.get("is_active")) and row.get("revoked_at") is None
    )
    if active_count >= MAX_ACTIVE_KEYS_PER_USER:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Active API key limit reached ({MAX_ACTIVE_KEYS_PER_USER}). "
                "Revoke an unused key before creating another."
            ),
        )

    raw_key = _generate_raw_key()
    prefix = raw_key[:_KEY_PREFIX_LEN]
    digest = key_hash(raw_key)

    try:
        created = await _key_store.create_for_user(
            user_id=user.user_id,
            label=body.label,
            key_prefix=prefix,
            key_hash_hex=digest,
            rate_limit_per_min=DEFAULT_USER_KEY_RATE_LIMIT,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to create API key") from exc

    invalidate_key_directory_cache(user_id=user.user_id)
    logger.info("api_key_created key_id=%s", created.get("id"))
    return CreateKeyResponse(api_key=raw_key, key=_to_summary(created))


@router.post(
    "/{key_id}/revoke",
    response_model=RevokeKeyResponse,
    summary="Revoke an Owned CoinTrac API Key Immediately",
)
async def revoke_key(
    key_id: str,
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> RevokeKeyResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        UUID(key_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="API key was not found") from exc

    now_iso = datetime.now(UTC).isoformat()
    try:
        revoked = await _key_store.revoke_for_user(
            user_id=user.user_id,
            key_id=key_id,
            revoked_at_iso=now_iso,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to revoke API key") from exc

    if revoked is None:
        raise HTTPException(status_code=404, detail="API key was not found")

    invalidate_key_directory_cache(user_id=user.user_id)
    logger.info("api_key_revoked key_id=%s", key_id)
    return RevokeKeyResponse(key=_to_summary(revoked))
