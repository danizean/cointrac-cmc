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

    # Add Remote MCP (OAuth & API key) + REST logs into platform store
    now_iso = datetime.now(UTC).isoformat()
    ai_env["store"].platform_request_logs.extend(
        [
            {
                "id": "rl_1",
                "user_id": ai_env["user_id"],
                "api_key_id": None,
                "surface": "mcp",
                "tool_name": "get_market_overview",
                "status_code": 200,
                "latency_ms": 180,
                "cache_hit": True,
                "credit_cost": 0,
                "evidence_id": "ev_mcp_oauth",
                "created_at": now_iso,
            },
            {
                "id": "rl_2",
                "user_id": ai_env["user_id"],
                "api_key_id": "key_123",
                "surface": "rest",
                "tool_name": "analyze_asset",
                "status_code": 200,
                "latency_ms": 420,
                "cache_hit": False,
                "credit_cost": 2,
                "evidence_id": "ev_rest_key",
                "created_at": now_iso,
            },
        ]
    )

    # Can view overview telemetry
    overview = client.get("/v1/admin/ai/overview", headers=hdr_admin)
    assert overview.status_code == 200
    ov_json = overview.json()
    assert ov_json["config"]["api_key_hint"] == "***9876"
    assert len(ov_json["users"]) == 2
    assert ov_json["summary"]["total_registered_users"] == 2
    assert ov_json["summary"]["super_admin_count"] == 1
    assert len(ov_json["daily_series"]) == 14
    assert ov_json["platform_summary"]["requests_30d"] == 2
    assert ov_json["platform_summary"]["mcp_requests_30d"] == 1
    assert ov_json["platform_summary"]["oauth_mcp_requests_30d"] == 1
    assert ov_json["platform_summary"]["rest_requests_30d"] == 1
    assert ov_json["platform_summary"]["cmc_credits_30d"] == 2
    assert len(ov_json["recent_api_logs"]) == 2
    trader_row = next(u for u in ov_json["users"] if u["user_id"] == ai_env["user_id"])
    assert trader_row["mcp_calls_30d"] == 1
    assert trader_row["rest_calls_30d"] == 1
    assert trader_row["cmc_credits_30d"] == 2


@pytest.mark.asyncio
async def test_muse_length_empty_content_recovers_cleanly(ai_env):
    class _LengthThenAnswerTransport:
        def __init__(self) -> None:
            self.calls = 0

        async def chat_completion(self, **kwargs):
            del kwargs
            self.calls += 1
            if self.calls == 1:
                return {
                    "usage": {"prompt_tokens": 120, "completion_tokens": 900},
                    "choices": [
                        {
                            "finish_reason": "length",
                            "message": {"role": "assistant", "content": None},
                        }
                    ],
                }
            return {
                "usage": {"prompt_tokens": 200, "completion_tokens": 60},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "**Recovered:** BTC solid."},
                    }
                ],
            }

    svc = AIAnalystService(store=ai_env["store"], transport=_LengthThenAnswerTransport())
    install_ai_analyst_service(svc)
    client = ai_env["client"]
    hdr_user = {"Authorization": f"Bearer {ai_env['tok_user']}"}
    res = client.post(
        "/v1/ai/chat",
        headers=hdr_user,
        json={"messages": [{"role": "user", "content": "Ringkas BTC"}], "locale": "id"},
    )
    assert res.status_code == 200
    assert "Recovered" in res.json()["answer"]


@pytest.mark.asyncio
async def test_ai_chat_returns_normalized_structured_cards_and_regime_fallback(
    ai_env, monkeypatch
):
    from app.services import intelligence as workflows

    client = ai_env["client"]
    hdr_user = {"Authorization": f"Bearer {ai_env['tok_user']}"}

    # 1. Verify structured_cards KPIs, tables, and timestamped evidence_refs on normal run
    res = client.post(
        "/v1/ai/chat",
        headers=hdr_user,
        json={"messages": [{"role": "user", "content": "Ringkas pasar sekarang"}], "locale": "id"},
    )
    assert res.status_code == 200
    body = res.json()
    cards = body["structured_cards"]
    assert cards is not None
    assert len(cards["kpis"]) >= 3
    assert any(kpi["label"] in {"Kapitalisasi Pasar", "BTC Spot"} for kpi in cards["kpis"])
    assert len(cards["tables"]) == 1
    assert body["evidence_refs"][0]["retrieved_at_utc"] is not None

    # 2. Verify analyze_market_regime retry once & fallback to cached snapshot after failure
    svc: AIAnalystService = ai_env["svc"]
    digest1, cit1, dumped1 = await svc._execute_tool(
        user_id=ai_env["user_id"],
        name="analyze_market_regime",
        arguments_raw='{"quote_currency":"USD"}',
        byok_cmc_key=None,
    )
    assert cit1 is not None and dumped1 is not None
    assert digest1["data"]["regime"] is not None

    calls = 0

    async def always_fail(*args, **kwargs):
        del args, kwargs
        nonlocal calls
        calls += 1
        raise RuntimeError("transient upstream failure")

    monkeypatch.setattr(workflows, "analyze_market_regime", always_fail)
    digest2, cit2, dumped2 = await svc._execute_tool(
        user_id=ai_env["user_id"],
        name="analyze_market_regime",
        arguments_raw='{"quote_currency":"USD"}',
        byok_cmc_key=None,
    )
    assert calls == 2  # Retried once before falling back
    assert cit2 is not None and dumped2 is not None
    assert cit2.data_mode == "CACHED"
    assert digest2["data"]["regime"] == digest1["data"]["regime"]
    assert any("Fallback to last cached snapshot" in note for note in digest2["limitations"])
