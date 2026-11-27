"""Security & functional tests for CoinTrac Phase 4 Developer Control Plane.

Covers:
- API key creation (copy-once plaintext, SHA-256 hash stored, never returned in list)
- Active API key cap (5 per user)
- Cross-tenant API key isolation (User A cannot list or revoke User B's keys -> 404)
- Atomic immediate revocation + immediate 401 when revoked key hits require_api_key
- Tenant-scoped GET /v1/telemetry/usage (tool quota separated from CMC credits)
- PATCH /v1/auth/profile display_name validation & anti-escalation (cannot alter plan/status)
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jwt.algorithms import ECAlgorithm

from app.api.deps import (
    ApiKeyRecord,
    AuthContext,
    MemoryRateStore,
    install_keys,
    install_rate_store,
    key_hash,
    require_api_key,
)
from app.api.jwt_auth import install_jwt_auth_deps, reset_jwt_auth_deps
from app.api.v1.auth import (
    install_profile_updater,
    reset_profile_updater,
)
from app.api.v1.auth import router as auth_router
from app.api.v1.keys import (
    MAX_ACTIVE_KEYS_PER_USER,
    install_key_store,
    reset_key_store,
)
from app.api.v1.keys import router as keys_router
from app.api.v1.telemetry import (
    install_usage_reader,
    reset_usage_reader,
)
from app.api.v1.telemetry import router as telemetry_router
from app.core.config import get_settings


class _FakeJWKS:
    def __init__(self, jwk: dict[str, Any]) -> None:
        self.jwk = jwk

    async def get_keys(self, *, force_refresh: bool = False) -> list[dict[str, Any]]:
        return [self.jwk]


class _MemProfiles:
    def __init__(self, rows: dict[str, dict[str, Any]]) -> None:
        self.rows = rows

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return self.rows.get(user_id)

    async def update_display_name(self, user_id: str, display_name: str) -> dict[str, Any] | None:
        row = self.rows.get(user_id)
        if row is None:
            return None
        row["display_name"] = display_name
        return dict(row)


class _MemKeyStoreAndDirectory:
    """Shared in-memory store backing both /v1/keys CRUD and deps.require_api_key lookup."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        return [dict(r) for r in self.rows if r["user_id"] == user_id]

    async def create_for_user(
        self,
        *,
        user_id: str,
        label: str,
        key_prefix: str,
        key_hash_hex: str,
        rate_limit_per_min: int,
    ) -> dict[str, Any]:
        row = {
            "id": str(uuid4()),
            "user_id": user_id,
            "label": label,
            "key_prefix": key_prefix,
            "key_hash": key_hash_hex,
            "is_sandbox": False,
            "rate_limit_per_min": rate_limit_per_min,
            "is_active": True,
            "revoked_at": None,
            "created_at": datetime.now(UTC).isoformat(),
        }
        self.rows.insert(0, row)
        return dict(row)

    async def revoke_for_user(
        self, *, user_id: str, key_id: str, revoked_at_iso: str
    ) -> dict[str, Any] | None:
        for row in self.rows:
            if row["id"] == key_id and row["user_id"] == user_id and row["revoked_at"] is None:
                row["is_active"] = False
                row["revoked_at"] = revoked_at_iso
                return dict(row)
        return None

    async def find_active(self, digest: str) -> ApiKeyRecord | None:
        for row in self.rows:
            if row["key_hash"] == digest:
                if not row["is_active"] or row["revoked_at"] is not None:
                    return None
                return ApiKeyRecord(
                    key_id=row["id"],
                    key_hash=row["key_hash"],
                    rate_limit_per_min=row["rate_limit_per_min"],
                    is_active=True,
                    user_id=row["user_id"],
                    revoked=False,
                )
        return None

    async def tenant_limit(self, user_id: str) -> int:
        limits = [
            int(r["rate_limit_per_min"])
            for r in self.rows
            if r["user_id"] == user_id and r["is_active"] and r["revoked_at"] is None
        ]
        return min(limits) if limits else 60


class _MemUsageReader:
    def __init__(self, logs_by_user: dict[str, list[dict[str, Any]]]) -> None:
        self.logs_by_user = logs_by_user

    async def read_user_logs(self, owner_id: str, limit: int = 1000) -> list[dict[str, Any]]:
        return list(self.logs_by_user.get(owner_id, []))[:limit]

    async def read_user_plan(self, owner_id: str) -> str:
        return "free"


def _make_jwt(
    private_key: ec.EllipticCurvePrivateKey,
    *,
    sub: str,
    email: str,
    iss: str,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub,
            "iss": iss,
            "aud": "authenticated",
            "role": "authenticated",
            "email": email,
            "iat": now,
            "exp": now + 3600,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": "cp-test-kid"},
    )


@pytest.fixture
def cp_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPABASE_URL", "https://fflwfpmbyykyxhlhikwc.supabase.co")
    get_settings.cache_clear()

    private_key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk["kid"] = "cp-test-kid"
    jwk["alg"] = "ES256"
    jwk["use"] = "sig"

    user_a = str(uuid4())
    user_b = str(uuid4())
    now_iso = datetime.now(UTC).isoformat()

    profiles = _MemProfiles(
        {
            user_a: {
                "id": user_a,
                "email": "alice@cointrac.test",
                "display_name": "Alice Quant",
                "base_plan_code": "free",
                "account_status": "active",
                "email_verified_at": now_iso,
                "created_at": now_iso,
            },
            user_b: {
                "id": user_b,
                "email": "bob@cointrac.test",
                "display_name": "Bob Analyst",
                "base_plan_code": "free",
                "account_status": "active",
                "email_verified_at": now_iso,
                "created_at": now_iso,
            },
        }
    )

    store = _MemKeyStoreAndDirectory()
    usage_reader = _MemUsageReader(
        {
            user_a: [
                {
                    "surface": "mcp",
                    "tool_name": "get_market_overview",
                    "status_code": 200,
                    "latency_ms": 140,
                    "cache_hit": True,
                    "credit_cost": 0,
                    "evidence_id": "ev_a1",
                    "created_at": now_iso,
                },
                {
                    "surface": "rest",
                    "tool_name": "analyze_sector_rotation",
                    "status_code": 200,
                    "latency_ms": 920,
                    "cache_hit": False,
                    "credit_cost": 7,
                    "evidence_id": "ev_a2",
                    "created_at": now_iso,
                },
            ],
            user_b: [
                {
                    "surface": "rest",
                    "tool_name": "analyze_asset",
                    "status_code": 200,
                    "latency_ms": 200,
                    "cache_hit": False,
                    "credit_cost": 2,
                    "evidence_id": "ev_b1",
                    "created_at": now_iso,
                }
            ],
        }
    )

    install_jwt_auth_deps(jwks_provider=_FakeJWKS(jwk), profile_directory=profiles)
    install_profile_updater(profiles)
    install_key_store(store)
    install_keys(store)
    install_rate_store(MemoryRateStore())
    install_usage_reader(usage_reader)

    app = FastAPI()
    app.include_router(auth_router)
    app.include_router(keys_router)
    app.include_router(telemetry_router)

    @app.get("/v1/probe-key")
    async def probe_key(auth: AuthContext = Depends(require_api_key)):
        return {"user_id": auth.user_id, "key_id": auth.key_id, "scoped": auth.scoped}

    iss = "https://fflwfpmbyykyxhlhikwc.supabase.co/auth/v1"
    tok_a = _make_jwt(private_key, sub=user_a, email="alice@cointrac.test", iss=iss)
    tok_b = _make_jwt(private_key, sub=user_b, email="bob@cointrac.test", iss=iss)

    try:
        yield {
            "client": TestClient(app),
            "user_a": user_a,
            "user_b": user_b,
            "tok_a": tok_a,
            "tok_b": tok_b,
            "store": store,
        }
    finally:
        reset_jwt_auth_deps()
        reset_profile_updater()
        reset_key_store()
        reset_usage_reader()
        get_settings.cache_clear()


def test_api_key_lifecycle_copy_once_and_immediate_revocation(cp_env):
    client = cp_env["client"]
    hdr_a = {"Authorization": f"Bearer {cp_env['tok_a']}", "x-user-id": cp_env["user_b"]}

    # Create key (spoofed x-user-id must be ignored)
    created = client.post("/v1/keys", json={"label": "Cursor Local"}, headers=hdr_a)
    assert created.status_code == 201
    assert created.headers.get("cache-control") == "no-store"
    body = created.json()
    raw_secret = body["api_key"]
    assert raw_secret.startswith("ct_live_")
    assert len(raw_secret) >= 48
    key_id = body["key"]["id"]
    assert body["key"]["label"] == "Cursor Local"
    assert body["key"]["key_prefix"].startswith("ct_live_")
    assert body["key"]["is_active"] is True
    assert "key_hash" not in body["key"]
    assert cp_env["store"].rows[0]["user_id"] == cp_env["user_a"]
    assert cp_env["store"].rows[0]["key_hash"] == key_hash(raw_secret)

    # List returns masked metadata only, never plaintext or key_hash
    listed = client.get("/v1/keys", headers=hdr_a)
    assert listed.status_code == 200
    assert listed.json()["active_count"] == 1
    assert raw_secret not in listed.text
    assert "key_hash" not in listed.text

    # Minted ct_live_ key works immediately via Authorization: Bearer and x-cointrac-key
    probe_bearer = client.get("/v1/probe-key", headers={"Authorization": f"Bearer {raw_secret}"})
    assert probe_bearer.status_code == 200
    assert probe_bearer.json()["user_id"] == cp_env["user_a"]

    probe_ok = client.get("/v1/probe-key", headers={"x-cointrac-key": raw_secret})
    assert probe_ok.status_code == 200
    assert probe_ok.json()["user_id"] == cp_env["user_a"]

    # User B cannot see or revoke User A's key
    hdr_b = {"Authorization": f"Bearer {cp_env['tok_b']}"}
    assert client.get("/v1/keys", headers=hdr_b).json()["keys"] == []
    assert client.post(f"/v1/keys/{key_id}/revoke", headers=hdr_b).status_code == 404

    # User A revokes own ct_live_ key -> immediate 401 on both auth headers
    rev = client.post(f"/v1/keys/{key_id}/revoke", headers=hdr_a)
    assert rev.status_code == 200
    assert rev.json()["key"]["is_active"] is False
    assert rev.json()["key"]["revoked_at"] is not None

    assert client.get("/v1/probe-key", headers={"x-cointrac-key": raw_secret}).status_code == 401
    assert (
        client.get("/v1/probe-key", headers={"Authorization": f"Bearer {raw_secret}"}).status_code
        == 401
    )

    # Re-revoking returns 404 (already revoked)
    assert client.post(f"/v1/keys/{key_id}/revoke", headers=hdr_a).status_code == 404


def test_retired_tg_live_key_is_rejected_while_ct_live_still_works(cp_env):
    client = cp_env["client"]
    store = cp_env["store"]
    hdr_a = {"Authorization": f"Bearer {cp_env['tok_a']}"}

    legacy_raw = "tg_live_legacy_existing_secret_token_2026_compat"
    legacy_id = str(uuid4())
    store.rows.insert(
        0,
        {
            "id": legacy_id,
            "user_id": cp_env["user_a"],
            "label": "Retired Prefix Key",
            "key_prefix": legacy_raw[:14],
            "key_hash": key_hash(legacy_raw),
            "is_sandbox": False,
            "rate_limit_per_min": 60,
            "is_active": True,
            "revoked_at": None,
            "created_at": datetime.now(UTC).isoformat(),
        },
    )

    assert (
        client.get("/v1/probe-key", headers={"Authorization": f"Bearer {legacy_raw}"}).status_code
        == 401
    )
    assert client.get("/v1/probe-key", headers={"x-cointrac-key": legacy_raw}).status_code == 401

    new_res = client.post("/v1/keys", json={"label": "New CoinTrac Key"}, headers=hdr_a)
    assert new_res.status_code == 201
    new_raw = new_res.json()["api_key"]
    assert new_raw.startswith("ct_live_")
    assert (
        client.get("/v1/probe-key", headers={"Authorization": f"Bearer {new_raw}"}).status_code
        == 200
    )
    retired_header = client.get(
        "/v1/probe-key",
        headers={"x-cointrac-key": new_raw, "x-tradeguard-key": new_raw},
    )
    assert retired_header.status_code == 401
    assert (
        client.get("/v1/probe-key", headers={"Authorization": f"Bearer {new_raw}"}).status_code
        == 200
    )


def test_swagger_docs_uses_cointrac_branding_and_no_hardcoded_secret():
    from app.api.docs import SWAGGER_DOCS_HTML

    assert "CoinTrac" in SWAGGER_DOCS_HTML
    assert "TradeGuardKey" not in SWAGGER_DOCS_HTML
    assert "tg_sandbox_" not in SWAGGER_DOCS_HTML
    assert (
        "<YOUR_COINTRAC_API_KEY>" in SWAGGER_DOCS_HTML
        or "&lt;YOUR_COINTRAC_API_KEY&gt;" in SWAGGER_DOCS_HTML
    )


def test_api_key_active_cap_enforced(cp_env):
    client = cp_env["client"]
    hdr_a = {"Authorization": f"Bearer {cp_env['tok_a']}"}
    for i in range(MAX_ACTIVE_KEYS_PER_USER):
        res = client.post("/v1/keys", json={"label": f"Key {i + 1}"}, headers=hdr_a)
        assert res.status_code == 201
    over = client.post("/v1/keys", json={"label": "Over Cap"}, headers=hdr_a)
    assert over.status_code == 400


def test_usage_endpoint_strictly_tenant_scoped_and_separates_cmc_credits(cp_env):
    client = cp_env["client"]
    res_a = client.get(
        "/v1/telemetry/usage",
        headers={"Authorization": f"Bearer {cp_env['tok_a']}", "x-user-id": cp_env["user_b"]},
    )
    assert res_a.status_code == 200
    body_a = res_a.json()
    assert body_a["tool_quota"]["calls_last_24h"] == 2
    assert body_a["tool_quota"]["active_tier"] == "free"
    assert body_a["tool_quota"]["daily_quota_limit"] is None
    assert body_a["cmc_credits"]["credits_this_month"] == 7
    assert body_a["cmc_credits"]["monthly_allowance"] is None
    assert body_a["cmc_credits"]["cache_hit_rate_pct"] == 50.0
    assert all(req["evidence_id"] != "ev_b1" for req in body_a["recent_requests"])

    res_b = client.get(
        "/v1/telemetry/usage",
        headers={"Authorization": f"Bearer {cp_env['tok_b']}"},
    )
    assert res_b.status_code == 200
    body_b = res_b.json()
    assert body_b["tool_quota"]["calls_last_24h"] == 1
    assert body_b["cmc_credits"]["credits_this_month"] == 2
    assert [req["evidence_id"] for req in body_b["recent_requests"]] == ["ev_b1"]


def test_profile_update_validates_display_name_and_blocks_extra_fields(cp_env):
    client = cp_env["client"]
    hdr_a = {"Authorization": f"Bearer {cp_env['tok_a']}"}

    ok = client.patch("/v1/auth/profile", json={"display_name": "  Alice Desk  "}, headers=hdr_a)
    assert ok.status_code == 200
    assert ok.json()["display_name"] == "Alice Desk"
    assert ok.json()["base_plan_code"] == "free"

    # Rejects empty whitespace and forbidden extra fields (plan escalation attempt)
    blank = client.patch("/v1/auth/profile", json={"display_name": "   "}, headers=hdr_a)
    assert blank.status_code == 422
    esc = client.patch(
        "/v1/auth/profile",
        json={"display_name": "Alice", "base_plan_code": "pro"},
        headers=hdr_a,
    )
    assert esc.status_code == 422


@pytest.mark.asyncio
async def test_supabase_usage_reader_merges_hidden_gem_scan_credits_without_double_counting(
    monkeypatch,
):
    from app.api.v1.telemetry import SupabaseUsageReader

    owner_id = cp_owner = "00000000-0000-0000-0000-000000000099"
    now = datetime.now(UTC)
    t_req = (now - timedelta(minutes=10)).isoformat()
    t_scan_start = (now - timedelta(minutes=5)).isoformat()
    t_scan_end = (now - timedelta(minutes=4)).isoformat()
    t_cancel = (now - timedelta(minutes=2)).isoformat()
    t_queued = (now - timedelta(minutes=1)).isoformat()

    queries: list[tuple[str, list[tuple[str, object]]]] = []

    class _FakeQuery:
        def __init__(self, table_name: str) -> None:
            self.table_name = table_name
            self.filters: list[tuple[str, object]] = []

        def select(self, _fields: str) -> _FakeQuery:
            return self

        def eq(self, key: str, value: object) -> _FakeQuery:
            self.filters.append((key, value))
            return self

        def order(self, *_args: object, **_kwargs: object) -> _FakeQuery:
            return self

        def limit(self, _count: int) -> _FakeQuery:
            return self

        def execute(self) -> object:
            queries.append((self.table_name, list(self.filters)))
            if self.table_name == "request_logs":
                payload = [
                    {
                        "surface": "rest",
                        "tool_name": "analyze_sector_rotation",
                        "status_code": 200,
                        "latency_ms": 600,
                        "cache_hit": False,
                        "credit_cost": 7,
                        "evidence_id": "ev_rot_1",
                        "created_at": t_req,
                    }
                ]
            else:
                payload = [
                    {
                        "id": "scan-completed",
                        "status": "COMPLETED",
                        "cmc_credits_consumed": 108,
                        "source_metadata": {"reused_cache": False},
                        "started_at": t_scan_start,
                        "completed_at": t_scan_end,
                        "created_at": t_scan_start,
                    },
                    {
                        "id": "scan-cancelled",
                        "status": "CANCELLED",
                        "cmc_credits_consumed": 12,
                        "source_metadata": {},
                        "started_at": t_cancel,
                        "completed_at": t_cancel,
                        "created_at": t_cancel,
                    },
                    {
                        "id": "scan-queued-zero",
                        "status": "QUEUED",
                        "cmc_credits_consumed": 0,
                        "source_metadata": {},
                        "started_at": None,
                        "completed_at": None,
                        "created_at": t_queued,
                    },
                ]

            class _Result:
                data = payload

            return _Result()

    class _FakeClient:
        def table(self, name: str) -> _FakeQuery:
            return _FakeQuery(name)

    monkeypatch.setattr("app.core.db.supabase_client", lambda: _FakeClient())

    rows = await SupabaseUsageReader().read_user_logs(cp_owner, limit=50)
    assert queries == [
        ("request_logs", [("user_id", owner_id)]),
        ("hg_scan_runs", [("user_id", owner_id)]),
    ]
    assert [r["tool_name"] for r in rows] == [
        "hidden_gem_scan",
        "hidden_gem_scan",
        "analyze_sector_rotation",
    ]
    assert sum(int(r["credit_cost"]) for r in rows) == 127
    assert rows[1]["credit_cost"] == 108
    assert rows[1]["latency_ms"] == 60_000
    assert rows[1]["status_code"] == 200
    assert rows[0]["status_code"] == 499


def test_telemetry_summary_and_usage_reflect_hidden_gem_scan_credits(cp_env):
    # Ensure /v1/telemetry/summary and /v1/telemetry/usage both include hidden_gem_scan
    # without leaking any unrelated tenant's credits.
    client = cp_env["client"]
    now_iso = datetime.now(UTC).isoformat()

    from app.api.v1 import telemetry as telemetry_mod

    reader = telemetry_mod._usage_reader
    reader.logs_by_user[cp_env["user_a"]].append(  # type: ignore[attr-defined]
        {
            "surface": "rest",
            "tool_name": "hidden_gem_scan",
            "status_code": 200,
            "latency_ms": 4200,
            "cache_hit": False,
            "credit_cost": 105,
            "evidence_id": None,
            "created_at": now_iso,
        }
    )
    telemetry_mod._cached_summary.clear()

    hdr_a = {"Authorization": f"Bearer {cp_env['tok_a']}"}
    summary_res = client.get("/v1/telemetry/summary", headers=hdr_a)
    usage_res = client.get("/v1/telemetry/usage", headers=hdr_a)
    assert summary_res.status_code == 200
    assert usage_res.status_code == 200
    assert summary_res.json()["total_cmc_credits"] == 112
    assert usage_res.json()["cmc_credits"]["credits_this_month"] == 112
    by_tool = {row["tool_name"]: row for row in usage_res.json()["tool_breakdown"]}
    assert by_tool["hidden_gem_scan"]["cmc_credits"] == 105
    assert by_tool["hidden_gem_scan"]["calls"] == 1

    # Bob stays isolated
    bob_summary = client.get(
        "/v1/telemetry/summary", headers={"Authorization": f"Bearer {cp_env['tok_b']}"}
    )
    assert bob_summary.json()["total_cmc_credits"] == 2
    assert client.patch("/v1/auth/profile", json={"display_name": "Anon"}).status_code == 401
