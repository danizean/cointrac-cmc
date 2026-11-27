"""Tests for CoinTrac AI (Muse Spark 1.3), per-user rate limits, and Super Admin governance."""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm
from tests.test_services import Book, Caps, Scripted, common_handlers

from app.api.jwt_auth import install_jwt_auth_deps, reset_jwt_auth_deps
from app.api.v1.admin_ai import router as admin_ai_router
from app.api.v1.ai import router as ai_router
from app.api.v1.auth import router as auth_router
from app.core.config import get_settings
from app.services.ai_analyst import (
    AIAnalystService,
    MemoryAIStore,
    install_ai_analyst_service,
    reset_ai_analyst_service,
)
from app.services.evidence import MemoryEvidence
from app.services.intelligence import SectorBook, ServiceDeps, install_deps


def _generate_ec_keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = "ai-test-key"
    jwk["alg"] = "ES256"
    return private_key, jwk


def _make_jwt(private_key, *, sub: str, email: str, iss: str) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "email": email,
        "role": "authenticated",
        "aud": "authenticated",
        "iss": iss,
        "iat": now,
        "exp": now + 300,
    }
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "ai-test-key"})


class _FakeJWKS:
    def __init__(self, jwk: dict[str, Any]) -> None:
        self.jwk = jwk

    async def get_keys(self, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        del force_refresh
        return [self.jwk]


class _FakeProfileDirectory:
    def __init__(self, profiles: dict[str, dict[str, Any]]) -> None:
        self.profiles = profiles

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return self.profiles.get(user_id)


class _FakeMuseTransport:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def chat_completion(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        temperature: float,
    ) -> dict[str, Any]:
        del base_url, api_key, model, max_tokens, temperature
        self.calls.append({"messages": messages, "tools": tools})
        has_tool_reply = any(m.get("role") == "tool" for m in messages)
        if not has_tool_reply and tools:
            return {
                "usage": {
                    "prompt_tokens": 420,
                    "completion_tokens": 25,
                    "prompt_tokens_details": {"cached_tokens": 100},
                },
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_mkt_1",
                                    "type": "function",
                                    "function": {
                                        "name": "get_market_overview",
                                        "arguments": '{"quote_currency":"USD"}',
                                    },
                                }
                            ],
                        }
                    }
                ],
            }
        return {
            "usage": {
                "prompt_tokens": 600,
                "completion_tokens": 90,
                "prompt_tokens_details": {"cached_tokens": 300},
            },
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": (
                            "**Ringkasan:** BTC di $95,000 (+2.4%) dan ETH di $3,400 (+3.1%)."
                        ),
                    }
                }
            ],
        }


@pytest.fixture()
def ai_env(monkeypatch):
    user_regular = str(uuid4())
    user_admin = str(uuid4())
    monkeypatch.setenv("SUPABASE_URL", "https://fflwfpmbyykyxhlhikwc.supabase.co")
    monkeypatch.setenv("MUSE_API_KEY", "muse_test_secret_1234567890")
    monkeypatch.setenv("SUPER_ADMIN_EMAILS", "boss@cointrac.xyz")
    get_settings.cache_clear()

    private_key, jwk = _generate_ec_keypair()
    now_iso = datetime.now(UTC).isoformat()

    profiles = {
        user_regular: {
            "id": user_regular,
            "email": "trader@cointrac.test",
            "display_name": "Trader One",
            "base_plan_code": "free",
            "account_status": "active",
            "platform_role": "user",
            "email_verified_at": now_iso,
            "created_at": now_iso,
        },
        user_admin: {
            "id": user_admin,
            "email": "boss@cointrac.xyz",
            "display_name": "Super Boss",
            "base_plan_code": "free",
            "account_status": "active",
            "platform_role": "super_admin",
            "email_verified_at": now_iso,
            "created_at": now_iso,
        },
    }

    install_jwt_auth_deps(
        jwks_provider=_FakeJWKS(jwk),
        profile_directory=_FakeProfileDirectory(profiles),
    )

    install_deps(
        ServiceDeps(
            gateway=Scripted(common_handlers()),
            evidence=MemoryEvidence(),
            assets=Book(),
            sectors=SectorBook(),
            capabilities=Caps(),
            now=lambda: datetime(2026, 11, 22, 15, tzinfo=UTC),
        )
    )

    store = MemoryAIStore()
    store.profiles = profiles
    transport = _FakeMuseTransport()
    svc = AIAnalystService(store=store, transport=transport)
    install_ai_analyst_service(svc)

    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(ai_router)
    app.include_router(admin_ai_router)

    iss = "https://fflwfpmbyykyxhlhikwc.supabase.co/auth/v1"
    tok_user = _make_jwt(private_key, sub=user_regular, email="trader@cointrac.test", iss=iss)
    tok_admin = _make_jwt(private_key, sub=user_admin, email="boss@cointrac.xyz", iss=iss)

    try:
        yield {
            "client": TestClient(app),
            "user_id": user_regular,
            "admin_id": user_admin,
            "tok_user": tok_user,
            "tok_admin": tok_admin,
            "store": store,
            "transport": transport,
            "svc": svc,
        }
    finally:
        reset_jwt_auth_deps()
        reset_ai_analyst_service()
        install_deps(None)
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_cointrac_ai_tool_calling_cache_and_rate_limit(ai_env):
    client = ai_env["client"]
    hdr_user = {"Authorization": f"Bearer {ai_env['tok_user']}"}

    # Regular user /v1/auth/me exposes is_super_admin=False
    me_user = client.get("/v1/auth/me", headers=hdr_user)
    assert me_user.status_code == 200
    assert me_user.json()["is_super_admin"] is False

    # Ask CoinTrac AI -> Muse executes get_market_overview tool & cites evidence_id
    chat_res = client.post(
        "/v1/ai/chat",
        headers=hdr_user,
        json={
            "messages": [{"role": "user", "content": "Ringkas kondisi pasar crypto hari ini"}],
            "locale": "id",
        },
    )
    assert chat_res.status_code == 200
    body = chat_res.json()
    assert "get_market_overview" in body["tools_used"]
    assert len(body["evidence_refs"]) == 1
    assert body["evidence_refs"][0]["evidence_id"].startswith("ev_")
    assert body["cache_hit"] is False
    assert body["usage"]["total_tokens"] == 1135
    assert body["quota"]["used_today_requests"] == 1
    assert len(ai_env["transport"].calls) == 2

    # Same single-turn question hits response cache (0 extra Muse calls!)
    cached_res = client.post(
        "/v1/ai/chat",
        headers=hdr_user,
        json={
            "messages": [{"role": "user", "content": "Ringkas kondisi pasar crypto hari ini"}],
            "locale": "id",
        },
    )
    assert cached_res.status_code == 200
    assert cached_res.json()["cache_hit"] is True
    assert len(ai_env["transport"].calls) == 2

    # Tighten per-user rate limit to 1 req/min as Super Admin -> next uncached call gets 429
    hdr_admin = {"Authorization": f"Bearer {ai_env['tok_admin']}"}
    lim = client.put(
        f"/v1/admin/ai/users/{ai_env['user_id']}/limits",
        headers=hdr_admin,
        json={"ai_enabled": True, "rate_limit_per_min": 1},
    )
    assert lim.status_code == 200

    limited = client.post(
        "/v1/ai/chat",
        headers=hdr_user,
        json={
            "messages": [{"role": "user", "content": "Pertanyaan berbeda sekarang"}],
            "locale": "id",
        },
    )
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_super_admin_routes_strictly_protected_and_mask_api_key(ai_env):
    client = ai_env["client"]
    hdr_user = {"Authorization": f"Bearer {ai_env['tok_user']}"}
    hdr_admin = {"Authorization": f"Bearer {ai_env['tok_admin']}"}

    # Regular user is strictly blocked (403) on all Super Admin endpoints
    assert client.get("/v1/admin/ai/overview", headers=hdr_user).status_code == 403
    assert client.get("/v1/admin/ai/config", headers=hdr_user).status_code == 403
    assert (
        client.patch(
            "/v1/admin/ai/config", headers=hdr_user, json={"default_rate_limit_per_min": 99}
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/v1/admin/ai/users/{ai_env['user_id']}/role",
            headers=hdr_user,
            json={"platform_role": "super_admin"},
        ).status_code
        == 403
    )

    # Super Admin updates config & DB secret -> plaintext secret is NEVER echoed back
    patched = client.patch(
        "/v1/admin/ai/config",
        headers=hdr_admin,
        json={
            "default_rate_limit_per_min": 15,
            "default_daily_requests": 80,
            "api_key_secret": "muse_live_supersecret_9876",
        },
    )
    assert patched.status_code == 200
    cfg = patched.json()
    assert cfg["default_rate_limit_per_min"] == 15
    assert cfg["api_key_configured"] is True
    assert cfg["api_key_source"] == "db"
    assert cfg["api_key_hint"] == "***9876"
    assert "muse_live_supersecret_9876" not in patched.text

    # Cannot demote own active super_admin session
    self_demote = client.patch(
        f"/v1/admin/ai/users/{ai_env['admin_id']}/role",
        headers=hdr_admin,
        json={"platform_role": "user"},
    )
    assert self_demote.status_code == 400

    # Can view overview telemetry
    overview = client.get("/v1/admin/ai/overview", headers=hdr_admin)
    assert overview.status_code == 200
    assert overview.json()["config"]["api_key_hint"] == "***9876"
    assert len(overview.json()["users"]) == 2
