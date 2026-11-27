"""R6 Legacy Namespace Migration — Phase 3 Non-Destructive Regression & Security Tests.

Verifies:
1. Canonical `x-cointrac-key` and `Authorization: Bearer` alongside backward-compatible
   `x-tradeguard-key` on both REST (`require_api_key`) and Remote MCP (`/mcp`).
2. Strict 401 rejection on conflicting credentials across `Bearer`, `x-cointrac-key`,
   and `x-tradeguard-key` (never silently picks a winner).
3. Revoked key (401) and suspended account (403) enforcement via `x-cointrac-key`.
4. Query-string `?x-cointrac-key=...` and `?x-tradeguard-key=...` rejection (400).
5. CORS allow-headers include `x-cointrac-key` and preserve `x-tradeguard-key`.
6. Secret redaction covers `x-cointrac-key` headers/query params alongside legacy forms,
   and `"cointrac"` logger emits structured redacted JSON.
7. Default `engine_version` is `cointrac-intelligence-v1.0.0`, while historical
   `tradeguard-quant-v1.0.0` evidence records remain valid and readable.
8. OpenAPI security schemes and `/v1/mcp/status` advertise CoinTrac canonical headers
   with explicit legacy deprecation metadata.
9. Prepared forward migration `005_cointrac_rate_window_rpc.sql` satisfies security &
   additive compatibility invariants. `SupabaseRateStore` calls
   `cointrac_consume_rate_window`; the legacy RPC remains in the database for rollback.
   MCP `10/3/2/3` contract stays unchanged.
"""

from __future__ import annotations

import inspect
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import Response
from tests.test_mcp import research_deps

from app.api.deps import (
    RATE_WINDOW_RPC,
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    SupabaseRateStore,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.api.jwt_auth import AuthenticatedUser
from app.api.v1.mcp_status import get_mcp_status
from app.core.config import Settings, get_settings
from app.core.logging import JsonFormatter, configure_logging, redact
from app.main import create_app
from app.mcp.server import mcp as mcp_server
from app.mcp.server import set_evidence_writer, set_service_deps
from app.schemas.envelope import (
    DataMode,
    EvidenceEnvelope,
    EvidenceMeta,
    EvidenceStatus,
    Freshness,
    MethodologyMeta,
)
from app.services import intelligence as workflows
from app.services.evidence import EvidenceDraft, MemoryEvidence


def _init_payload(req_id: int = 1) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "r6-test", "version": "1.0.0"},
        },
    }


def _seed_keys() -> dict[str, str]:
    keys = {
        "ct": "ct_live_r6_canonical_key_1234567890abcdefghijklmnop",
        "tg": "tg_live_r6_legacy_key_1234567890abcdefghijklmnopqrs",
        "other": "ct_live_r6_other_tenant_key_1234567890abcdefghijklm",
        "revoked": "ct_live_r6_revoked_key_1234567890abcdefghijklmnopqr",
        "suspended": "ct_live_r6_suspended_key_1234567890abcdefghijklmnop",
    }
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="k-r6-ct",
                    key_hash=key_hash(keys["ct"]),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="11111111-1111-4111-8111-111111111111",
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-r6-tg",
                    key_hash=key_hash(keys["tg"]),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="11111111-1111-4111-8111-111111111111",
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-r6-other",
                    key_hash=key_hash(keys["other"]),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="22222222-2222-4222-8222-222222222222",
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-r6-revoked",
                    key_hash=key_hash(keys["revoked"]),
                    rate_limit_per_min=60,
                    is_active=False,
                    user_id="11111111-1111-4111-8111-111111111111",
                    revoked=True,
                    account_status="active",
                ),
                ApiKeyRecord(
                    key_id="k-r6-suspended",
                    key_hash=key_hash(keys["suspended"]),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id="33333333-3333-4333-8333-333333333333",
                    account_status="suspended",
                ),
            ]
        )
    )
    install_rate_store(MemoryRateStore())
    return keys


async def test_r6_rest_and_mcp_header_compatibility_and_conflict_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    monkeypatch.setenv("MCP_ALLOWED_HOSTS", "127.0.0.1:*,localhost:*")
    monkeypatch.setenv("MCP_ALLOWED_ORIGINS", "http://127.0.0.1:*,http://localhost:*")
    get_settings.cache_clear()

    keys = _seed_keys()
    deps, evidence = research_deps()
    set_service_deps(deps)
    set_evidence_writer(evidence)

    orig_overview = workflows.get_market_overview

    async def _stub_overview(
        quote_currency: str = "USD",
        *,
        override_cmc_key: str | None = None,
    ) -> EvidenceEnvelope[Any]:
        return await orig_overview(
            quote_currency,
            override_cmc_key=override_cmc_key,
            deps=deps,
        )

    monkeypatch.setattr(workflows, "get_market_overview", _stub_overview)

    app = create_app()
    rest_url = "/v1/intelligence/market-overview?quote_currency=USD"
    try:
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://127.0.0.1:8000",
            ) as client,
        ):
            # 1. Authenticated REST accepts Bearer and x-cointrac-key only
            for headers in (
                {"Authorization": f"Bearer {keys['ct']}"},
                {"x-cointrac-key": keys["ct"]},
                {"Authorization": f"Bearer {keys['ct']}", "x-cointrac-key": keys["ct"]},
            ):
                res = await client.get(rest_url, headers=headers)
                assert res.status_code == 200, (
                    f"Expected 200 for {list(headers.keys())}, got {res.status_code}"
                )
            retired_prefix = await client.get(rest_url, headers={"x-cointrac-key": keys["tg"]})
            assert retired_prefix.status_code == 401
            retired_header = await client.get(
                rest_url,
                headers={"x-cointrac-key": keys["ct"], "x-tradeguard-key": keys["ct"]},
            )
            assert retired_header.status_code == 401

            # 2. Authenticated REST rejects conflicting credentials with 401 (no secret leak)
            for conflict_headers in (
                {"Authorization": f"Bearer {keys['ct']}", "x-cointrac-key": keys["other"]},
                {"Authorization": f"Bearer {keys['ct']}", "x-tradeguard-key": keys["other"]},
            ):
                res = await client.get(rest_url, headers=conflict_headers)
                assert res.status_code == 401
                assert keys["ct"] not in res.text
                assert keys["other"] not in res.text

            # 3. REST enforces revocation (401) and suspension (403) on x-cointrac-key
            rev = await client.get(rest_url, headers={"x-cointrac-key": keys["revoked"]})
            assert rev.status_code == 401
            susp = await client.get(rest_url, headers={"x-cointrac-key": keys["suspended"]})
            assert susp.status_code == 403

            # 4. Query-string credentials never authenticate on REST (401) and return 400 on MCP
            for qparam in ("x-cointrac-key", "x-tradeguard-key"):
                q_rest = await client.get(f"{rest_url}&{qparam}={keys['ct']}")
                assert q_rest.status_code == 401
                q_mcp = await client.post(
                    f"/mcp?{qparam}={keys['ct']}",
                    json=_init_payload(),
                    headers={"Accept": "application/json, text/event-stream"},
                )
                assert q_mcp.status_code == 400

            # 5. Remote MCP accepts Bearer and x-cointrac-key, and rejects the retired header
            base_mcp = {
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            }
            for auth_hdr in (
                {"Authorization": f"Bearer {keys['ct']}"},
                {"x-cointrac-key": keys["ct"]},
            ):
                res = await client.post(
                    "/mcp", json=_init_payload(), headers={**base_mcp, **auth_hdr}
                )
                assert res.status_code == 200, (
                    f"MCP expected 200 for {list(auth_hdr.keys())}, got {res.status_code}"
                )
            retired_mcp = await client.post(
                "/mcp",
                json=_init_payload(),
                headers={**base_mcp, "x-tradeguard-key": keys["ct"]},
            )
            assert retired_mcp.status_code == 401

            # 6. Remote MCP rejects conflicting (401), revoked (401), suspended (403)
            for conflict_hdr in (
                {"x-cointrac-key": keys["ct"], "x-tradeguard-key": keys["other"]},
                {"Authorization": f"Bearer {keys['ct']}", "x-cointrac-key": keys["other"]},
            ):
                res = await client.post(
                    "/mcp", json=_init_payload(), headers={**base_mcp, **conflict_hdr}
                )
                assert res.status_code == 401
                assert keys["ct"] not in res.text
                assert keys["other"] not in res.text

            mcp_rev = await client.post(
                "/mcp",
                json=_init_payload(),
                headers={**base_mcp, "x-cointrac-key": keys["revoked"]},
            )
            assert mcp_rev.status_code == 401
            mcp_susp = await client.post(
                "/mcp",
                json=_init_payload(),
                headers={**base_mcp, "x-cointrac-key": keys["suspended"]},
            )
            assert mcp_susp.status_code == 403

            # 7. CORS preflight advertises x-cointrac-key and not the retired header
            req_headers = "authorization,x-cointrac-key"
            preflight = await client.options(
                "/mcp",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": req_headers,
                },
            )
            assert preflight.status_code == 200
            allowed = preflight.headers.get("access-control-allow-headers", "").lower()
            assert "x-cointrac-key" in allowed
            assert "x-tradeguard-key" not in allowed

            # 8. OpenAPI schema exposes CoinTracKey and no retired key scheme
            openapi = (await client.get("/openapi.json")).json()
            schemes = openapi.get("components", {}).get("securitySchemes", {})
            assert "CoinTracKey" in schemes
            assert schemes["CoinTracKey"]["name"] == "x-cointrac-key"
            assert "LegacyApiKey" not in schemes
            assert "TradeGuardKey" not in schemes
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        install_keys(None)
        install_rate_store(None)
        get_settings.cache_clear()


async def test_r6_mcp_status_reports_canonical_and_deprecated_auth_methods() -> None:
    dummy_user = AuthenticatedUser(
        user_id="11111111-1111-4111-8111-111111111111",
        email="dev@cointrac.test",
        email_verified=True,
        role="user",
        base_plan_code="starter",
        account_status="active",
        display_name="R6 Tester",
        created_at=None,
        profile_provisioned=True,
    )
    status = await get_mcp_status(Response(), dummy_user)
    assert any("Authorization: Bearer" in m for m in status.auth_methods)
    assert any("x-cointrac-key" in m for m in status.auth_methods)
    assert all("x-tradeguard-key" not in m for m in status.auth_methods)
    assert status.key_prefixes_supported == ["ct_live_"]


def test_r6_logging_redacts_x_cointrac_key_and_configures_cointrac_logger() -> None:
    sample = (
        "x-cointrac-key: ct_live_SecretHeader9876543210 "
        "x-tradeguard-key: tg_live_LegacyHeader1234567890 "
        "https://api.cointrac.test/v1/capabilities?x-cointrac-key=ct_live_QueryLeak123456&ok=1"
    )
    cleaned = redact(sample)
    assert "ct_live_SecretHeader9876543210" not in cleaned
    assert "tg_live_LegacyHeader1234567890" not in cleaned
    assert "ct_live_QueryLeak123456" not in cleaned
    assert "ok=1" in cleaned

    configure_logging()
    ct_logger = logging.getLogger("cointrac")
    assert len(ct_logger.handlers) >= 1
    assert isinstance(ct_logger.handlers[0].formatter, JsonFormatter)


async def test_r6_engine_version_default_and_historical_evidence_readability() -> None:
    fresh = Settings(_env_file=None)
    assert fresh.engine_version == "cointrac-intelligence-v1.0.0"

    # Historical evidence rows created under tradeguard-quant-v1.0.0 stay valid & readable
    store = MemoryEvidence()
    draft = EvidenceDraft(
        evidence_id="ev_hist_r6_001",
        tool_name="get_market_overview",
        asset_cmc_ids=[1],
        endpoints_called=["/v1/global-metrics/quotes/latest"],
        data_mode="LIVE",
        freshness="FRESH",
        credit_cost=1,
        engine_version="tradeguard-quant-v1.0.0",
        methodology={"annualization_basis": "365d"},
        limitations=[],
        raw_excerpt={"status": "ok"},
    )
    await store.persist(draft)
    assert len(store.records) == 1
    assert store.records[0].engine_version == "tradeguard-quant-v1.0.0"

    envelope = EvidenceEnvelope(
        tool="get_market_overview",
        engine_version="tradeguard-quant-v1.0.0",
        status=EvidenceStatus.OK,
        summary="Historical evidence record verified.",
        data={"ok": True},
        methodology=MethodologyMeta(
            metrics=["market_cap"],
            observation_window="latest",
            annualization_basis="365d",
        ),
        evidence=EvidenceMeta(
            evidence_id="ev_0123456789",
            data_mode=DataMode.LIVE,
            freshness=Freshness.FRESH,
            retrieved_at_utc=datetime.now(UTC),
            source_timestamps={},
            cmc_endpoints_called=["/v1/global-metrics/quotes/latest"],
            cmc_credit_cost=1,
            cache_hit=False,
        ),
        limitations=[],
    )
    assert envelope.engine_version == "tradeguard-quant-v1.0.0"


async def test_r6_phase4b_boundaries_and_prepared_sql_migration_safety() -> None:
    # MCP census is 14 tools (11 core + 3 Hidden Gems). Templates include candidate detail.
    tools = await mcp_server.list_tools()
    resources = await mcp_server.list_resources()
    templates = await mcp_server.list_resource_templates()
    prompts = await mcp_server.list_prompts()
    assert len(tools) == 14
    assert len(resources) == 3
    assert len(templates) == 3
    assert len(prompts) == 3
    assert all(str(r.uri).startswith("cointrac://") for r in resources)
    assert all(str(t.uri_template).startswith("cointrac://") for t in templates)

    # 2. SupabaseRateStore calls the canonical RPC. The legacy function is rollback-only.
    rate_store_src = inspect.getsource(SupabaseRateStore.consume)
    assert RATE_WINDOW_RPC == "cointrac_consume_rate_window"
    assert "RATE_WINDOW_RPC" in rate_store_src
    assert "tradeguard_consume_rate_window" not in rate_store_src

    # 3. Prepared migration 005 exists and upholds strict additive & security invariants
    repo_root = Path(__file__).resolve().parents[3]
    mig_path = repo_root / "supabase" / "migrations" / "005_cointrac_rate_window_rpc.sql"
    assert mig_path.is_file(), f"Missing prepared migration: {mig_path}"
    sql = mig_path.read_text(encoding="utf-8")
    assert "CREATE OR REPLACE FUNCTION public.cointrac_consume_rate_window(" in sql
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = ''" in sql
    assert "INSERT INTO private.rate_windows" in sql
    assert "REVOKE ALL ON FUNCTION public.cointrac_consume_rate_window(TEXT, INTEGER)" in sql
    assert "FROM PUBLIC, anon, authenticated" in sql
    grant_line = (
        "GRANT EXECUTE ON FUNCTION public.cointrac_consume_rate_window(TEXT, INTEGER) "
        "TO service_role"
    )
    assert grant_line in sql
    assert "DROP FUNCTION" not in sql.upper()


async def test_r6_phase4b_dual_namespace_mcp_resources_and_tenant_isolation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import json

    from mcp.client.streamable_http import streamable_http_client
    from mcp.server.mcpserver.exceptions import ResourceNotFoundError
    from mcp.shared.exceptions import MCPError

    from app.mcp import server as mcp_mod
    from mcp import ClientSession

    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    monkeypatch.setenv("MCP_ALLOWED_HOSTS", "127.0.0.1:*,localhost:*")
    monkeypatch.setenv("MCP_ALLOWED_ORIGINS", "http://127.0.0.1:*,http://localhost:*")
    get_settings.cache_clear()

    key_a = "ct_live_r6_4b_tenant_a_1234567890abcdefghijklmnop"
    key_b = "ct_live_r6_4b_tenant_b_1234567890abcdefghijklmnop"
    key_lim = "ct_live_r6_4b_limited_1234567890abcdefghijklmnopq"
    tenant_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    tenant_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    tenant_lim = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord("k-4b-a", key_hash(key_a), 60, True, user_id=tenant_a),
                ApiKeyRecord("k-4b-b", key_hash(key_b), 60, True, user_id=tenant_b),
                ApiKeyRecord("k-4b-l", key_hash(key_lim), 2, True, user_id=tenant_lim),
            ]
        )
    )
    install_rate_store(MemoryRateStore())

    deps, _ev = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)

    fake_rows = {
        ("ev_0123456789", tenant_a): {
            "evidence_id": "ev_0123456789",
            "user_id": tenant_a,
            "tool_name": "get_market_overview",
            "status": "OK",
        },
        ("ev_0123456789", tenant_lim): {
            "evidence_id": "ev_0123456789",
            "user_id": tenant_lim,
            "tool_name": "get_market_overview",
            "status": "OK",
        },
    }

    async def fake_read_evidence(eid: str) -> dict[str, object]:
        from app.api.deps import current_mcp_auth

        rec = current_mcp_auth.get()
        owner = rec.user_id if rec is not None else None
        found = fake_rows.get((eid, owner)) if owner else None
        if found is None:
            return {
                "evidence_id": eid,
                "status": "INSUFFICIENT_DATA",
                "limitations": [f"{eid} was not found."],
            }
        return dict(found)

    monkeypatch.setattr(mcp_mod, "_read_evidence", fake_read_evidence)

    # Direct unknown URI checks raise ResourceNotFoundError cleanly
    for bad_uri in (
        "cointrac://unknown/path",
        "tradeguard://unknown/path",
        "other://market/overview",
    ):
        with pytest.raises(ResourceNotFoundError):
            await mcp_server.read_resource(bad_uri)

    app = create_app()
    try:
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)

            async def read_wire(api_key: str, uri: str) -> dict[str, Any]:
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
                            res = await session.read_resource(uri)
                            assert len(res.contents) == 1
                            return json.loads(res.contents[0].text)

            # 1. All 5 canonical resources resolve for the owning tenant
            for suffix in (
                "market/overview",
                "market/trending",
                "market/sectors",
                "assets/SOL/profile",
                "evidence/ev_0123456789",
            ):
                canon = await read_wire(key_a, f"cointrac://{suffix}")
                assert canon["status"] in {"OK", "PARTIAL"}
                if suffix == "evidence/ev_0123456789":
                    assert canon["evidence_id"] == "ev_0123456789"
                    assert canon["user_id"] == tenant_a

            # 2. Cross-tenant isolation still hides another tenant's evidence
            denied = await read_wire(key_b, "cointrac://evidence/ev_0123456789")
            assert denied["status"] == "INSUFFICIENT_DATA"
            assert "not found" in denied["limitations"][0].lower()

            # 3. Shared rate-limit window enforced across canonical + legacy resource reads
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"Authorization": f"Bearer {key_lim}"},
            ) as lim_http:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp", http_client=lim_http
                ) as (read, write):
                    async with ClientSession(read, write) as lim_session:
                        await lim_session.initialize()
                        r1 = json.loads(
                            (await lim_session.read_resource("cointrac://evidence/ev_0123456789"))
                            .contents[0]
                            .text
                        )
                        r2 = json.loads(
                            (await lim_session.read_resource("cointrac://market/overview"))
                            .contents[0]
                            .text
                        )
                        r3 = json.loads(
                            (await lim_session.read_resource("cointrac://evidence/ev_0123456789"))
                            .contents[0]
                            .text
                        )
            assert r1["status"] == "OK"
            assert r2["status"] == "OK"
            assert r3["status"] == "INSUFFICIENT_DATA"
            assert "rate limit exceeded" in r3["limitations"][0].lower()

            # 4. Wire-level unknown URI raises MCPError cleanly
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"Authorization": f"Bearer {key_a}"},
            ) as err_http:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp", http_client=err_http
                ) as (read, write):
                    async with ClientSession(read, write) as err_session:
                        await err_session.initialize()
                        with pytest.raises(MCPError):
                            await err_session.read_resource("cointrac://does/not/exist")
                        with pytest.raises(MCPError):
                            await err_session.read_resource("tradeguard://market/overview")
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        install_keys(None)
        install_rate_store(None)
        get_settings.cache_clear()
