"""Security & correctness tests for verified Supabase JWT authentication (Stage 5.1)."""

from __future__ import annotations

import json
import time
from typing import Any
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm

from app.api.jwt_auth import (
    AuthenticatedUser,
    install_jwt_auth_deps,
    require_verified_supabase_user,
    reset_jwt_auth_deps,
)
from app.api.v1.auth import router as auth_router
from app.core.config import get_settings


class _FakeJWKSProvider:
    def __init__(self, keys: list[dict[str, Any]]) -> None:
        self.keys = keys
        self.refresh_calls = 0

    async def get_keys(self, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        if force_refresh:
            self.refresh_calls += 1
        return self.keys


class _MemoryProfileDirectory:
    def __init__(self, profiles: dict[str, dict[str, Any]]) -> None:
        self.profiles = profiles

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return self.profiles.get(user_id)


def _generate_ec_keypair(
    kid: str = "test-ec-kid-1",
) -> tuple[ec.EllipticCurvePrivateKey, dict[str, Any]]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = kid
    jwk["alg"] = "ES256"
    jwk["use"] = "sig"
    return private_key, jwk


def _make_token(
    private_key: ec.EllipticCurvePrivateKey,
    *,
    sub: str,
    iss: str,
    aud: str = "authenticated",
    exp_offset: int = 3600,
    kid: str = "test-ec-kid-1",
    email: str = "alice@example.com",
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = int(time.time())
    payload: dict[str, Any] = {
        "sub": sub,
        "iss": iss,
        "aud": aud,
        "role": "authenticated",
        "email": email,
        "iat": now,
        "exp": now + exp_offset,
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": kid})


def _test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(auth_router)

    @app.get("/v1/auth/verified-only")
    async def verified_only(user: AuthenticatedUser = Depends(require_verified_supabase_user)):
        return {"user_id": user.user_id, "email_verified": user.email_verified}

    return app


@pytest.fixture
def auth_harness(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://fflwfpmbyykyxhlhikwc.supabase.co")
    get_settings.cache_clear()

    private_key, jwk = _generate_ec_keypair()
    user_a = str(uuid4())
    user_b = str(uuid4())
    user_unverified = str(uuid4())
    user_suspended = str(uuid4())

    profiles = {
        user_a: {
            "id": user_a,
            "email": "alice@example.com",
            "display_name": "Alice",
            "base_plan_code": "free",
            "account_status": "active",
            "email_verified_at": "2026-11-23T10:00:00+00:00",
        },
        user_b: {
            "id": user_b,
            "email": "bob@example.com",
            "display_name": "Bob",
            "base_plan_code": "free",
            "account_status": "active",
            "email_verified_at": "2026-11-23T10:00:00+00:00",
        },
        user_unverified: {
            "id": user_unverified,
            "email": "unverified@example.com",
            "display_name": None,
            "base_plan_code": "free",
            "account_status": "active",
            "email_verified_at": None,
        },
        user_suspended: {
            "id": user_suspended,
            "email": "suspended@example.com",
            "display_name": None,
            "base_plan_code": "free",
            "account_status": "suspended",
            "email_verified_at": "2026-11-23T10:00:00+00:00",
        },
    }

    jwks = _FakeJWKSProvider([jwk])
    directory = _MemoryProfileDirectory(profiles)
    install_jwt_auth_deps(jwks_provider=jwks, profile_directory=directory)

    client = TestClient(_test_app())
    iss = "https://fflwfpmbyykyxhlhikwc.supabase.co/auth/v1"
    try:
        yield {
            "client": client,
            "private_key": private_key,
            "iss": iss,
            "user_a": user_a,
            "user_b": user_b,
            "user_unverified": user_unverified,
            "user_suspended": user_suspended,
            "jwks": jwks,
        }
    finally:
        reset_jwt_auth_deps()
        get_settings.cache_clear()


def test_valid_es256_jwt_resolves_verified_identity(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_a"],
        iss=auth_harness["iss"],
    )
    resp = auth_harness["client"].get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.headers.get("cache-control") == "no-store"
    body = resp.json()
    assert body["user_id"] == auth_harness["user_a"]
    assert body["email"] == "alice@example.com"
    assert body["email_verified"] is True
    assert body["base_plan_code"] == "free"
    assert body["account_status"] == "active"
    assert body["profile_provisioned"] is True


def test_missing_or_malformed_authorization_rejected(auth_harness):
    client = auth_harness["client"]
    assert client.get("/v1/auth/me").status_code == 401
    assert client.get("/v1/auth/me", headers={"Authorization": "Basic abc"}).status_code == 401
    resp = client.get("/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401


def test_expired_jwt_rejected(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_a"],
        iss=auth_harness["iss"],
        exp_offset=-60,
    )
    resp = auth_harness["client"].get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


def test_wrong_audience_rejected(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_a"],
        iss=auth_harness["iss"],
        aud="anon",
    )
    resp = auth_harness["client"].get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert "audience" in resp.json()["detail"].lower()


def test_wrong_issuer_rejected(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_a"],
        iss="https://udprwjbmrfknulngsjid.supabase.co/auth/v1",
    )
    resp = auth_harness["client"].get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert "issuer" in resp.json()["detail"].lower()


def test_invalid_signature_and_alg_downgrade_rejected(auth_harness):
    other_key, _ = _generate_ec_keypair(kid="test-ec-kid-1")
    forged = _make_token(
        other_key,
        sub=auth_harness["user_a"],
        iss=auth_harness["iss"],
    )
    assert (
        auth_harness["client"]
        .get("/v1/auth/me", headers={"Authorization": f"Bearer {forged}"})
        .status_code
        == 401
    )

    hs256_token = jwt.encode(
        {
            "sub": auth_harness["user_a"],
            "iss": auth_harness["iss"],
            "aud": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        "weak-shared-secret-at-least-32-bytes-long",
        algorithm="HS256",
    )
    resp_hs = auth_harness["client"].get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {hs256_token}"}
    )
    assert resp_hs.status_code == 401
    assert "algorithm" in resp_hs.json()["detail"].lower()


def test_non_uuid_subject_rejected(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub="not-a-uuid",
        iss=auth_harness["iss"],
    )
    resp = auth_harness["client"].get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_spoofed_headers_and_editable_user_metadata_cannot_escalate_or_impersonate(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_a"],
        iss=auth_harness["iss"],
        extra_claims={
            "user_metadata": {"plan": "pro", "base_plan_code": "pro", "role": "admin"},
            "raw_user_meta_data": {"plan": "pro_early_access", "is_admin": True},
        },
    )
    resp = auth_harness["client"].get(
        "/v1/auth/me",
        headers={
            "Authorization": f"Bearer {token}",
            "x-user-id": auth_harness["user_b"],
            "x-tenant-id": auth_harness["user_b"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    # Identity comes exclusively from verified JWT sub (user_a), never spoofed headers (user_b)
    assert body["user_id"] == auth_harness["user_a"]
    assert body["email"] == "alice@example.com"
    # Editable user_metadata can NEVER grant Pro or admin role
    assert body["base_plan_code"] == "free"
    assert body["role"] == "authenticated"


def test_unverified_user_blocked_from_verified_only_endpoint(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_unverified"],
        iss=auth_harness["iss"],
        email="unverified@example.com",
    )
    resp_me = auth_harness["client"].get(
        "/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp_me.status_code == 200
    assert resp_me.json()["email_verified"] is False

    resp_verified = auth_harness["client"].get(
        "/v1/auth/verified-only", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp_verified.status_code == 403
    assert "verification" in resp_verified.json()["detail"].lower()


def test_suspended_user_rejected(auth_harness):
    token = _make_token(
        auth_harness["private_key"],
        sub=auth_harness["user_suspended"],
        iss=auth_harness["iss"],
        email="suspended@example.com",
    )
    resp = auth_harness["client"].get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
