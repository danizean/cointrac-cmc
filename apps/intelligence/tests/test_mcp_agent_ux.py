"""Langkah 3 — MCP agent UX: capabilities, path token, and workflow prompts."""

from __future__ import annotations

import logging

import httpx
import pytest
from mcp.client.streamable_http import streamable_http_client
from tests.test_mcp import research_deps

from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
from app.main import create_app
from app.mcp.server import mcp, set_evidence_writer, set_service_deps
from app.services.budget import BudgetController, MemoryBudgetStore, install_budget_controller
from app.services.evidence import MemoryEvidence
from mcp import ClientSession

TOKEN = "ct_live_unit_test_path_token_001"


@pytest.mark.asyncio
async def test_get_capabilities_uses_no_cmc_credits() -> None:
    controller = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=MemoryBudgetStore(),
    )
    install_budget_controller(controller)
    deps, evidence = research_deps()
    set_service_deps(deps)
    set_evidence_writer(MemoryEvidence())
    try:
        result = await mcp.call_tool("get_capabilities", {})
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        install_budget_controller(None)
    assert result.is_error is False
    rendered = result.model_dump_json()
    assert '"cmc_credit_cost":0' in rendered or '"cmc_credit_cost": 0' in rendered
    assert '"cmc_endpoints_called":[]' in rendered or '"cmc_endpoints_called": []' in rendered
    assert "fallback" in rendered
    assert evidence.records[-1].tool_name == "get_capabilities"
    assert evidence.records[-1].credit_cost == 0
    assert evidence.records[-1].endpoints_called == []
    prompts = await mcp.list_prompts()
    by_name = {item.name: item for item in prompts}
    assert (
        "briefing" in (await mcp.get_prompt("daily-market-briefing", {})).messages[0].content.text
    )
    assert (
        "due diligence"
        in (await mcp.get_prompt("asset-due-diligence", {"symbol": "SOL", "peers": "ETH"}))
        .messages[0]
        .content.text
    )
    assert (
        "rotasi sektor"
        in (await mcp.get_prompt("market-risk-review", {"symbols": "BTC"})).messages[0].content.text
    )
    assert set(by_name) == {
        "daily-market-briefing",
        "asset-due-diligence",
        "market-risk-review",
    }


@pytest.mark.asyncio
async def test_path_token_authenticates_without_leaking_and_revoked_key_fails() -> None:
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="path-token",
                    key_hash=key_hash(TOKEN),
                    rate_limit_per_min=30,
                    is_active=True,
                )
            ]
        )
    )
    deps, _evidence = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)
    captured: list[str] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            captured.append(record.getMessage())

    handler = _Capture()
    logger = logging.getLogger("cointrac")
    logger.addHandler(handler)
    test_app = create_app()
    try:
        async with test_app.router.lifespan_context(test_app):
            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(
                transport=transport, base_url="http://127.0.0.1:8000"
            ) as http_client:
                denied = await http_client.post(
                    "/mcp/u/ct_live_revoked_token_value",
                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                )
                assert denied.status_code == 401
                assert "ct_live_revoked_token_value" not in denied.text
                leaked = await http_client.post(
                    "/mcp?token=" + TOKEN,
                    headers={"Accept": "application/json, text/event-stream"},
                )
                assert leaked.status_code == 400
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp/u/" + TOKEN,
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.call_tool("get_capabilities", {})
                        assert result.is_error is False
    finally:
        logger.removeHandler(handler)
        set_service_deps(None)
        set_evidence_writer(None)
    joined = "\n".join(captured)
    assert TOKEN not in joined
    assert all(TOKEN not in (entry.tool_name or "") for entry in logs.logs)
