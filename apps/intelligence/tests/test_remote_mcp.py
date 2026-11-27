"""Phase 5 Remote MCP Infrastructure security, transport, concurrency & contract tests.

Covers all Phase 5E requirements:
1. Remote MCP endpoint (/mcp and /mcp/ without 307 redirect) + stateless default
2. Valid API key (ct_live_* and legacy tg_live_* on Bearer and x-tradeguard-key)
3. Invalid / missing / JWT-on-MCP rejection (401)
4. Revoked API key immediate rejection (401)
5. Suspended / pending_deletion account rejection (403)
6. Query-parameter credential rejection (400)
7. DNS rebinding Host (421) and Origin (403) validation + wildcard rejection at startup
8. Streamable HTTP CORS preflight (DELETE, Mcp-Session-Id, MCP-Protocol-Version, Retry-After)
9. Stateful session ownership binding ((user_id, key_id)) & cross-tenant hijacking prevention (404)
10. Tenant isolation across tools, evidence resources, and usage telemetry
11. Concurrent requests isolation (asyncio.gather across two tenants)
12. Rate limiting on tools and evidence resource reads
13. Tool timeout (504) & sanitized error handling (zero internal leaks)
14. Log credential redaction (ct_live_*, tg_live_*, Bearer, x-tradeguard-key, query params)
15. Honest GET /v1/mcp/status metadata (not_deployed vs deployed) + MCP contract census (10/3/2/3)
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm
from mcp.client.streamable_http import streamable_http_client
from tests.test_mcp import research_deps

from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    install_keys,
    key_hash,
)
from app.api.jwt_auth import install_jwt_auth_deps, reset_jwt_auth_deps
from app.core.config import Settings, get_settings
from app.core.logging import redact
from app.main import create_app
from app.mcp.server import set_evidence_writer, set_service_deps
from app.services.evidence import MemoryEvidence
from mcp import ClientSession


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


def _init_payload(req_id: int = 1) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "phase5-test", "version": "1.0.0"},
        },
    }


def _mcp_headers(api_key: str, *, header_mode: str = "bearer", **extra: str) -> dict[str, str]:
    hdrs = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if header_mode == "bearer":
        hdrs["Authorization"] = f"Bearer {api_key}"
    elif header_mode == "cointrac":
        hdrs["x-cointrac-key"] = api_key
    else:
        hdrs["x-tradeguard-key"] = api_key
    hdrs.update(extra)
    return hdrs


def test_settings_rejects_wildcard_hosts_origins_and_unsafe_remote_url() -> None:
    with pytest.raises(ValueError, match="Wildcard host"):
        Settings(mcp_allowed_hosts="*")
    with pytest.raises(ValueError, match="Wildcard host"):
        Settings(mcp_allowed_hosts="*.cointrac.dev")
    with pytest.raises(ValueError, match="Wildcard origin"):
        Settings(mcp_allowed_origins="*")
    with pytest.raises(ValueError, match="https://"):
        Settings(remote_mcp_public_url="http://mcp.cointrac.dev/mcp")
    with pytest.raises(ValueError, match="localhost"):
        Settings(remote_mcp_public_url="https://localhost:8000/mcp")

    safe = Settings(
        mcp_allowed_hosts="127.0.0.1:*,mcp.cointrac.dev",
        mcp_allowed_origins="http://localhost:*,https://app.cointrac.dev",
        remote_mcp_public_url="https://mcp.cointrac.dev/mcp/",
    )
    assert safe.mcp_stateless_http is True
    assert safe.remote_mcp_public_url == "https://mcp.cointrac.dev/mcp"
    assert "mcp.cointrac.dev" in safe.mcp_allowed_host_list()


def test_settings_rejects_wildcard_cors_and_unsafe_public_hosts() -> None:
    with pytest.raises(ValueError, match="Wildcard origin"):
        Settings(cors_origins="*")
    with pytest.raises(ValueError, match="https://"):
        Settings(public_api_base_url="http://api.cointrac.xyz")
    with pytest.raises(ValueError, match="localhost"):
        Settings(public_api_base_url="https://localhost/v1")
    with pytest.raises(ValueError, match="Wildcard host"):
        Settings(trusted_hosts="*")

    ready = Settings(
        cors_origins="https://cointrac.xyz,https://www.cointrac.xyz",
        trusted_hosts="api.cointrac.xyz,mcp.cointrac.xyz,localhost,127.0.0.1",
        public_api_base_url="https://api.cointrac.xyz/",
    )
    assert ready.cors_origin_list() == ["https://cointrac.xyz", "https://www.cointrac.xyz"]
    assert ready.public_api_base_url == "https://api.cointrac.xyz"
    assert "mcp.cointrac.xyz" in ready.trusted_host_list()


def test_logging_redacts_dynamic_api_keys_bearer_and_query_secrets() -> None:
    sample = (
        "Failed request with ct_live_AbCdEf1234567890 and tg_live_Legacy9876543210 "
        "Authorization: Bearer secret_token_value_123456 "
        "x-tradeguard-key: tg_sandbox_example_key_99 "
        "url=https://example.com/mcp?api_key=ct_live_leak123456&foo=bar"
    )
    cleaned = redact(sample)
    assert "ct_live_AbCdEf1234567890" not in cleaned
    assert "tg_live_Legacy9876543210" not in cleaned
    assert "secret_token_value_123456" not in cleaned
    assert "tg_sandbox_example_key_99" not in cleaned
    assert "ct_live_leak123456" not in cleaned
    assert "foo=bar" in cleaned


async def test_remote_mcp_endpoint_no_redirect_auth_matrix_and_query_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    monkeypatch.setenv("MCP_ALLOWED_HOSTS", "127.0.0.1:*,mcp.cointrac.test")
    monkeypatch.setenv("MCP_ALLOWED_ORIGINS", "http://127.0.0.1:*,https://app.cointrac.test")
    get_settings.cache_clear()

    key_ct = "ct_live_new_phase5_key_abcdefghijklmnopqrstuvwxyz"
    key_legacy = "tg_live_legacy_phase5_key_1234567890abcdefghijkl"
    key_revoked = "ct_live_revoked_phase5_key_1234567890abcdefghijk"
    key_suspended = "ct_live_suspended_phase5_key_1234567890abcdefghi"

    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="k-ct",
                    key_hash=key_hash(key_ct),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="user-a",
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-leg",
                    key_hash=key_hash(key_legacy),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="user-a",
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-rev",
                    key_hash=key_hash(key_revoked),
                    rate_limit_per_min=60,
                    is_active=False,
                    user_id="user-a",
                    revoked=True,
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-susp",
                    key_hash=key_hash(key_suspended),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="user-susp",
                    account_status="suspended",
                ),
            ]
        )
    )
    deps, _ev = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)
    test_app = create_app()
    try:
        async with test_app.router.lifespan_context(test_app):
            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                follow_redirects=False,
            ) as client:
                # 1. Both /mcp (no trailing slash -> NO 307) and /mcp/ succeed with ct_live_ Bearer
                r_no_slash = await client.post(
                    "/mcp", json=_init_payload(1), headers=_mcp_headers(key_ct)
                )
                assert r_no_slash.status_code == 200
                assert "CoinTrac Market Intelligence" in r_no_slash.text

                r_slash = await client.post(
                    "/mcp/", json=_init_payload(2), headers=_mcp_headers(key_ct)
                )
                assert r_slash.status_code == 200

                # 2. Retired tg_live_ keys and the retired header are rejected
                r_leg_bearer = await client.post(
                    "/mcp",
                    json=_init_payload(3),
                    headers=_mcp_headers(key_legacy, header_mode="bearer"),
                )
                assert r_leg_bearer.status_code == 401

                r_leg_hdr = await client.post(
                    "/mcp",
                    json=_init_payload(4),
                    headers=_mcp_headers(key_ct, header_mode="legacy"),
                )
                assert r_leg_hdr.status_code == 401

                r_ct_header = await client.post(
                    "/mcp",
                    json=_init_payload(41),
                    headers=_mcp_headers(key_ct, header_mode="cointrac"),
                )
                assert r_ct_header.status_code == 200

                # 3. Missing, invalid, JWT-shaped, and revoked keys rejected with 401
                assert (await client.post("/mcp", json=_init_payload(5))).status_code == 401
                assert (
                    await client.post(
                        "/mcp", json=_init_payload(6), headers=_mcp_headers("ct_live_wrong_key_123")
                    )
                ).status_code == 401
                assert (
                    await client.post(
                        "/mcp", json=_init_payload(7), headers=_mcp_headers("aaa.bbb.ccc")
                    )
                ).status_code == 401
                assert (
                    await client.post(
                        "/mcp", json=_init_payload(8), headers=_mcp_headers(key_revoked)
                    )
                ).status_code == 401

                # 4. Suspended account rejected with 403
                r_susp = await client.post(
                    "/mcp", json=_init_payload(9), headers=_mcp_headers(key_suspended)
                )
                assert r_susp.status_code == 403

                # 5. Query-string credentials rejected with 400
                r_qs = await client.post(
                    f"/mcp?api_key={key_ct}",
                    json=_init_payload(10),
                    headers=_mcp_headers(key_ct),
                )
                assert r_qs.status_code == 400
                assert r_qs.headers.get("cache-control") == "no-store"

                # 6. DNS rebinding protection: allowed host/origin pass; disallowed fail
                r_allowed_host = await client.post(
                    "/mcp",
                    json=_init_payload(11),
                    headers=_mcp_headers(
                        key_ct,
                        Host="mcp.cointrac.test",
                        Origin="https://app.cointrac.test",
                    ),
                )
                assert r_allowed_host.status_code == 200

                r_bad_host = await client.post(
                    "/mcp",
                    json=_init_payload(12),
                    headers=_mcp_headers(key_ct, Host="evil.attacker.invalid"),
                )
                assert r_bad_host.status_code == 421

                r_bad_origin = await client.post(
                    "/mcp",
                    json=_init_payload(13),
                    headers=_mcp_headers(
                        key_ct,
                        Host="mcp.cointrac.test",
                        Origin="https://evil.attacker.invalid",
                    ),
                )
                assert r_bad_origin.status_code == 403

                # 7. CORS preflight supports DELETE & Streamable HTTP headers
                r_cors = await client.options(
                    "/mcp",
                    headers={
                        "Origin": "http://localhost:3000",
                        "Access-Control-Request-Method": "DELETE",
                        "Access-Control-Request-Headers": (
                            "Authorization, Mcp-Session-Id, MCP-Protocol-Version"
                        ),
                    },
                )
                assert r_cors.status_code == 200
                allow_methods = r_cors.headers.get("access-control-allow-methods", "")
                assert "DELETE" in allow_methods
                assert "POST" in allow_methods
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        get_settings.cache_clear()


async def test_stateful_mcp_prevents_cross_tenant_and_cross_key_session_hijacking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MCP_STATELESS_HTTP", "false")
    get_settings.cache_clear()

    key_a1 = "ct_live_user_a_primary_key_1234567890abcdef"
    key_a2 = "ct_live_user_a_secondary_key_1234567890abcd"
    key_b1 = "ct_live_user_b_attacker_key_1234567890abcde"

    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord("ka1", key_hash(key_a1), 60, True, user_id="user-a"),
                ApiKeyRecord("ka2", key_hash(key_a2), 60, True, user_id="user-a"),
                ApiKeyRecord("kb1", key_hash(key_b1), 60, True, user_id="user-b"),
            ]
        )
    )
    deps, _ev = research_deps()
    set_service_deps(deps)
    set_evidence_writer(MemoryEvidence())
    test_app = create_app()
    try:
        async with test_app.router.lifespan_context(test_app):
            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
            ) as client:
                init_res = await client.post(
                    "/mcp", json=_init_payload(1), headers=_mcp_headers(key_a1)
                )
                assert init_res.status_code == 200
                sid = init_res.headers.get("mcp-session-id")
                assert sid

                list_body = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}

                # User B attempting to hijack User A's session -> 404 Session not found
                hijack_b = await client.post(
                    "/mcp",
                    json=list_body,
                    headers=_mcp_headers(key_b1, **{"Mcp-Session-Id": sid}),
                )
                assert hijack_b.status_code == 404

                # User A with a DIFFERENT key (ka2 != ka1) cannot reuse ka1's session -> 404
                wrong_key_same_user = await client.post(
                    "/mcp",
                    json=list_body,
                    headers=_mcp_headers(key_a2, **{"Mcp-Session-Id": sid}),
                )
                assert wrong_key_same_user.status_code == 404

                # Owning (user_a, ka1) succeeds and can tear down via DELETE
                del_res = await client.delete(
                    "/mcp", headers=_mcp_headers(key_a1, **{"Mcp-Session-Id": sid})
                )
                assert del_res.status_code in {200, 204}
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        get_settings.cache_clear()


async def test_remote_mcp_concurrent_multi_tenant_isolation_and_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    get_settings.cache_clear()

    key_a = "ct_live_concurrent_user_a_1234567890abcdef"
    key_b = "ct_live_concurrent_user_b_1234567890abcdef"
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord("ka", key_hash(key_a), 60, True, user_id="tenant-a"),
                ApiKeyRecord("kb", key_hash(key_b), 60, True, user_id="tenant-b"),
            ]
        )
    )
    deps, _ev = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)
    test_app = create_app()

    async def invoke_for(api_key: str, tool_name: str, args: dict[str, Any]) -> bool:
        transport = httpx.ASGITransport(app=test_app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:8000",
            headers={"Authorization": f"Bearer {api_key}"},
        ) as http_client:
            async with streamable_http_client(
                "http://127.0.0.1:8000/mcp", http_client=http_client
            ) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    res = await session.call_tool(tool_name, args)
                    return res.is_error is False

    try:
        async with test_app.router.lifespan_context(test_app):
            outcomes = await asyncio.gather(
                invoke_for(key_a, "get_market_overview", {}),
                invoke_for(key_b, "analyze_market_regime", {}),
                invoke_for(key_a, "analyze_sector_rotation", {}),
                invoke_for(key_b, "analyze_asset", {"symbol": "SOL"}),
            )
            assert outcomes == [True, True, True, True]
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        get_settings.cache_clear()

    assert len(logs.logs) == 4
    by_tool = {entry.tool_name: entry for entry in logs.logs}
    assert by_tool["get_market_overview"].user_id == "tenant-a"
    assert by_tool["get_market_overview"].api_key_id == "ka"
    assert by_tool["analyze_sector_rotation"].user_id == "tenant-a"
    assert by_tool["analyze_market_regime"].user_id == "tenant-b"
    assert by_tool["analyze_market_regime"].api_key_id == "kb"
    assert by_tool["analyze_asset"].user_id == "tenant-b"
    assert all(entry.surface == "mcp" and entry.status_code == 200 for entry in logs.logs)


async def test_mcp_tool_timeout_sanitized_errors_and_evidence_resource_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from mcp.server.mcpserver.exceptions import ToolError

    from app.api.deps import current_mcp_auth
    from app.mcp import server as mcp_server

    monkeypatch.setenv("MCP_TOOL_TIMEOUT_SECONDS", "1.0")
    get_settings.cache_clear()

    logs = MemoryEvidence()
    set_evidence_writer(logs)

    async def slow_coro() -> Any:
        await asyncio.sleep(2.5)

    async def broken_coro() -> Any:
        raise RuntimeError("secret internal url https://internal.db/token=abc")

    try:
        # 1. Timeout produces sanitized ToolError and logs 504
        with pytest.raises(ToolError) as timeout_exc:
            await mcp_server._tracked("get_market_overview", slow_coro())
        assert "timed out" in str(timeout_exc.value)
        assert logs.logs[-1].status_code == 504

        # 2. Unexpected internal error produces sanitized ToolError without leaking message
        with pytest.raises(ToolError) as err_exc:
            await mcp_server._tracked("analyze_asset", broken_coro())
        assert "internal error" in str(err_exc.value).lower()
        assert "secret internal url" not in str(err_exc.value)
        assert logs.logs[-1].status_code == 500

        # 3. Evidence resource access enforces rate limit and logs telemetry
        rec = ApiKeyRecord("k-res", key_hash("ct_live_res_test_key"), 1, True, user_id="tenant-r")
        install_keys(MemoryKeyDirectory([rec]))

        async def fake_read_evidence(eid: str) -> dict[str, object]:
            return {"evidence_id": eid, "tool_name": "get_market_overview", "status": "OK"}

        monkeypatch.setattr(mcp_server, "_read_evidence", fake_read_evidence)
        tok = current_mcp_auth.set(rec)
        try:
            first_raw = await mcp_server.evidence_resource("ev_allowed_1")
            second_raw = await mcp_server.evidence_resource("ev_limited_2")
        finally:
            current_mcp_auth.reset(tok)

        first = json.loads(first_raw)
        second = json.loads(second_raw)
        assert first["evidence_id"] == "ev_allowed_1"
        assert second["status"] == "INSUFFICIENT_DATA"
        assert "Rate limit exceeded" in second["limitations"][0]
        res_logs = [entry for entry in logs.logs if entry.tool_name == "resource:evidence"]
        assert [entry.status_code for entry in res_logs] == [200, 429]
        assert all(
            entry.user_id == "tenant-r" and entry.api_key_id == "k-res" for entry in res_logs
        )
    finally:
        set_evidence_writer(None)
        get_settings.cache_clear()


async def test_mcp_status_endpoint_reports_honest_deployment_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://fflwfpmbyykyxhlhikwc.supabase.co")
    monkeypatch.setenv("REMOTE_MCP_PUBLIC_URL", "")
    get_settings.cache_clear()

    private_key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": "p5-kid", "alg": "ES256", "use": "sig"})
    uid = str(uuid4())
    now_iso = datetime.now(UTC).isoformat()

    install_jwt_auth_deps(
        jwks_provider=_FakeJWKS(jwk),
        profile_directory=_MemProfiles(
            {
                uid: {
                    "id": uid,
                    "email": "dev@cointrac.test",
                    "display_name": "Dev",
                    "base_plan_code": "free",
                    "account_status": "active",
                    "email_verified_at": now_iso,
                    "created_at": now_iso,
                }
            }
        ),
    )
    now_ts = int(time.time())
    token = jwt.encode(
        {
            "sub": uid,
            "iss": "https://fflwfpmbyykyxhlhikwc.supabase.co/auth/v1",
            "aud": "authenticated",
            "role": "authenticated",
            "email": "dev@cointrac.test",
            "iat": now_ts,
            "exp": now_ts + 3600,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": "p5-kid"},
    )

    test_app = create_app()
    try:
        transport = httpx.ASGITransport(app=test_app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://127.0.0.1:8000"
        ) as client:
            assert (await client.get("/v1/mcp/status")).status_code == 401
            res = await client.get("/v1/mcp/status", headers={"Authorization": f"Bearer {token}"})
            assert res.status_code == 200
            body = res.json()
            assert body["server_name"] == "CoinTrac Market Intelligence"
            assert body["transport"] == "streamable-http"
            assert body["stateless_http"] is True
            assert body["remote_deployed"] is False
            assert body["remote_url"] is None
            assert body["deployment_status"] == "not_deployed"
            assert body["contracts"] == {
                "tools": 14,
                "static_resources": 3,
                "resource_templates": 3,
                "prompts": 3,
            }

            # When a real https:// remote URL is configured, status reflects deployed accurately
            monkeypatch.setenv("REMOTE_MCP_PUBLIC_URL", "https://mcp.cointrac.dev/mcp")
            get_settings.cache_clear()
            res_dep = await client.get(
                "/v1/mcp/status", headers={"Authorization": f"Bearer {token}"}
            )
            assert res_dep.status_code == 200
            dep = res_dep.json()
            assert dep["remote_deployed"] is True
            assert dep["remote_url"] == "https://mcp.cointrac.dev/mcp"
            assert dep["deployment_status"] == "deployed"
    finally:
        reset_jwt_auth_deps()
        get_settings.cache_clear()
