"""Authenticated identity & profile endpoints backed by verified Supabase JWTs."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Protocol

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.jwt_auth import (
    AuthenticatedUser,
    require_supabase_user,
    require_verified_supabase_user,
)

router = APIRouter(prefix="/v1/auth", tags=["Authentication"])
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class AuthMeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    email: str | None
    email_verified: bool
    role: str
    base_plan_code: str
    account_status: str
    display_name: str | None
    created_at: str | None = None
    profile_provisioned: bool


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str = Field(
        min_length=1,
        max_length=80,
        description="Public display name for the authenticated account.",
    )

    @field_validator("display_name")
    @classmethod
    def _clean_display_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Display name must not be empty.")
        if _CONTROL_CHARS.search(cleaned):
            raise ValueError("Display name contains invalid characters.")
        return cleaned


class ProfileUpdater(Protocol):
    async def update_display_name(self, user_id: str, display_name: str) -> dict[str, Any] | None:
        ...


class SupabaseProfileUpdater:
    async def update_display_name(self, user_id: str, display_name: str) -> dict[str, Any] | None:
        from app.core.db import supabase_client

        def write() -> dict[str, Any] | None:
            resp = (
                supabase_client()
                .table("profiles")
                .update({"display_name": display_name})
                .eq("id", user_id)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(write)


_profile_updater: ProfileUpdater = SupabaseProfileUpdater()


def install_profile_updater(updater: ProfileUpdater) -> None:
    global _profile_updater
    _profile_updater = updater


def reset_profile_updater() -> None:
    global _profile_updater
    _profile_updater = SupabaseProfileUpdater()


@router.get(
    "/me",
    response_model=AuthMeResponse,
    summary="Verify Authenticated User Identity",
    description=(
        "Returns the server-verified Supabase user identity and profile state derived "
        "strictly from a cryptographically validated Supabase JWT (JWKS ES256/RS256). "
        "Client-supplied user_id headers and editable user_metadata are never trusted."
    ),
)
async def get_authenticated_me(
    response: Response,
    user: AuthenticatedUser = Depends(require_supabase_user),
) -> AuthMeResponse:
    response.headers["Cache-Control"] = "no-store"
    return AuthMeResponse(
        user_id=user.user_id,
        email=user.email,
        email_verified=user.email_verified,
        role=user.role,
        base_plan_code=user.base_plan_code,
        account_status=user.account_status,
        display_name=user.display_name,
        created_at=user.created_at,
        profile_provisioned=user.profile_provisioned,
    )


@router.patch(
    "/profile",
    response_model=AuthMeResponse,
    summary="Update Authenticated User Display Name",
    description=(
        "Updates only display_name on public.profiles for the verified JWT subject. "
        "Plan, account_status, email, and email_verified_at cannot be modified here."
    ),
)
async def update_authenticated_profile(
    body: UpdateProfileRequest,
    response: Response,
    user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> AuthMeResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        updated = await _profile_updater.update_display_name(user.user_id, body.display_name)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Unable to update profile") from exc

    if updated is None:
        raise HTTPException(status_code=404, detail="Profile was not found")

    return AuthMeResponse(
        user_id=user.user_id,
        email=str(updated.get("email") or user.email or ""),
        email_verified=updated.get("email_verified_at") is not None,
        role=user.role,
        base_plan_code=user.base_plan_code,
        account_status=user.account_status,
        display_name=str(updated.get("display_name") or body.display_name),
        created_at=str(updated["created_at"]) if updated.get("created_at") else user.created_at,
        profile_provisioned=True,
    )
