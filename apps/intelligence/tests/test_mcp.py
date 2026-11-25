from datetime import UTC, datetime

import httpx
from tests.test_services import Book, Caps, Scripted, coin, common_handlers, quotes

from app.adapters.normalizer import SymbolResolution
from app.main import app
from app.mcp.server import mcp, set_evidence_writer, set_service_deps
from app.services.evidence import MemoryEvidence
from app.services.intelligence import ServiceDeps


class ResearchBook(Book):
    async def resolve(self, symbols: list[str]):
        found = await super().resolve(symbols)
        if "NEAR" not in symbols:
            return found
        notes = [note for note in found.limitations if not note.startswith("NEAR ")]
        return SymbolResolution({**found.ids, "NEAR": 6535}, notes)


def quotes_with_near(params: dict[str, object]) -> dict[str, object]:
    payload = quotes(params)
    if "6535" in str(params.get("id", "")):
        data = payload["data"]
        if isinstance(data, dict):
            data["6535"] = coin(6535, "NEAR", 2.0)
    return payload


def research_deps() -> tuple[ServiceDeps, MemoryEvidence]:
    handlers = common_handlers()
    handlers["/v2/cryptocurrency/quotes/latest"] = quotes_with_near
    evidence = MemoryEvidence()
    deps = ServiceDeps(
        gateway=Scripted(handlers),
        evidence=evidence,
        assets=ResearchBook(),
        sectors=deps_sectors(),
        capabilities=Caps(),
        now=lambda: datetime(2026, 11, 22, 15, 0, tzinfo=UTC),
    )
    return deps, evidence


def deps_sectors():
    from app.services.intelligence import SectorBook

    return SectorBook()


async def test_mcp_registers_tools_resources_and_prompts() -> None:
    tools = await mcp.list_tools()
    resources = await mcp.list_resources()
    templates = await mcp.list_resource_templates()
    prompts = await mcp.list_prompts()
    tool_names = {tool.name for tool in tools}
    assert tool_names == {
        "get_market_overview",
        "analyze_market_regime",
        "scan_market_movers",
        "detect_market_anomalies",
        "compare_assets",
        "analyze_asset",
        "analyze_momentum",
        "analyze_sector_rotation",
        "get_historical_performance",
        "analyze_derivatives",
        "get_capabilities",
    }
    resource_uris = {resource.uri for resource in resources}
    template_uris = {template.uri_template for template in templates}
    assert resource_uris == {
        "cointrac://market/overview",
        "cointrac://market/trending",
        "cointrac://market/sectors",
    }
    assert template_uris == {
        "cointrac://assets/{symbol}/profile",
        "cointrac://evidence/{evidence_id}",
    }
    assert {prompt.name for prompt in prompts} == {
        "daily-market-briefing",
        "asset-due-diligence",
        "market-risk-review",
    }


async def test_mcp_tools_return_evidence_envelopes() -> None:
    deps, evidence = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)
    try:
        overview = await mcp.call_tool("get_market_overview", {})
        compared = await mcp.call_tool(
            "compare_assets",
            {"symbols": ["SOL", "AVAX", "NEAR"]},
        )
        sectors = await mcp.call_tool("analyze_sector_rotation", {})
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
    for result in (overview, compared, sectors):
        assert result.is_error is False
        rendered = result.model_dump_json()
        assert "ev_" in rendered
        assert "365d" in rendered
    assert [entry.surface for entry in logs.logs] == ["mcp", "mcp", "mcp"]
    assert evidence.records


async def test_health_route_stays_available_beside_mcp() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_mcp_tool_schemas_have_parameter_descriptions_and_clear_validation_errors() -> None:
    import pytest
    from mcp.server.mcpserver.exceptions import ToolError

    tools = await mcp.list_tools()
    assert len(tools) == 11
    for tool in tools:
        schema = tool.input_schema or {}
        props = schema.get("properties") or {}
        if tool.name == "get_capabilities":
            assert props == {}
            assert "Pakai tool ini untuk" in (tool.description or "")
            continue
        assert props, f"{tool.name} should declare parameters"
        for param_name, param_schema in props.items():
            assert param_schema.get("description"), (
                f"{tool.name}.{param_name} is missing JSON Schema description"
            )

    # Invalid symbol, too-short symbols list, duplicate symbols, invalid enum, out-of-range count
    cases = [
        ("analyze_asset", {"symbol": "BAD!!!"}, "symbol"),
        ("compare_assets", {"symbols": ["SOL"]}, "symbols"),
        ("compare_assets", {"symbols": ["SOL", "SOL"]}, "symbols"),
        ("scan_market_movers", {"rank_by": "not_a_metric"}, "rank_by"),
        ("scan_market_movers", {"max_7d_gain_pct": -150.0}, "max_7d_gain_pct"),
        ("scan_market_movers", {"max_7d_gain_pct": 25000.0}, "max_7d_gain_pct"),
        ("get_historical_performance", {"symbol": "SOL", "count": 500}, "count"),
    ]
    for tool_name, args, expected_field in cases:
        with pytest.raises(ToolError) as exc_info:
            await mcp.call_tool(tool_name, args)
        text = str(exc_info.value)
        assert expected_field in text
        assert "Traceback" not in text
        assert "apps/" not in text and "apps\\" not in text
        assert "server.py" not in text


async def test_mcp_full_streamable_http_session_completes_without_429() -> None:
    from mcp.client.streamable_http import streamable_http_client

    from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
    from app.main import create_app
    from mcp import ClientSession

    sandbox = "ct_live_unit_test_fixture_001"
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="sandbox",
                    key_hash=key_hash(sandbox),
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
    test_app = create_app()
    try:
        async with test_app.router.lifespan_context(test_app):
            transport = httpx.ASGITransport(app=test_app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"x-cointrac-key": sandbox},
            ) as http_client:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp/",
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        init = await session.initialize()
                        assert init.server_info.name == "CoinTrac Market Intelligence"
                        listed_tools = (await session.list_tools()).tools
                        listed_resources = (await session.list_resources()).resources
                        listed_templates = (
                            await session.list_resource_templates()
                        ).resource_templates
                        listed_prompts = (await session.list_prompts()).prompts

                        assert len(listed_tools) == len(await mcp.list_tools())
                        assert len(listed_resources) == len(await mcp.list_resources())
                        assert len(listed_templates) == len(await mcp.list_resource_templates())
                        assert len(listed_prompts) == len(await mcp.list_prompts())

                        # Multi-tool sequence + resource + prompt + wire-level validation error
                        for name, args in [
                            ("get_market_overview", {"quote_currency": "USD"}),
                            ("analyze_market_regime", {"quote_currency": "USD"}),
                            ("compare_assets", {"symbols": ["SOL", "AVAX", "NEAR"]}),
                            ("analyze_sector_rotation", {"quote_currency": "USD"}),
                            ("analyze_derivatives", {"symbol": "SOL"}),
                        ]:
                            res = await session.call_tool(name, args)
                            assert res.is_error is False

                        bad_wire = await session.call_tool("analyze_asset", {"symbol": "BAD!!!"})
                        assert bad_wire.is_error is True
                        bad_text = " ".join(getattr(b, "text", "") for b in bad_wire.content)
                        assert "symbol" in bad_text
                        assert "Traceback" not in bad_text

                        res_read = await session.read_resource("cointrac://market/overview")
                        assert res_read.contents
                        prompt_res = await session.get_prompt("daily-market-briefing", {})
                        assert prompt_res.messages
    finally:
        set_service_deps(None)
        set_evidence_writer(None)


async def test_mcp_business_tool_limit_enforced_while_teardown_succeeds() -> None:
    from mcp.client.streamable_http import streamable_http_client

    from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
    from app.main import create_app
    from mcp import ClientSession

    sandbox = "ct_live_limit_two_2026"
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="tight_sandbox",
                    key_hash=key_hash(sandbox),
                    rate_limit_per_min=2,
                    is_active=True,
                )
            ]
        )
    )
    deps, _evidence = research_deps()
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
                headers={"x-cointrac-key": sandbox},
            ) as http_client:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp/",
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        first = await session.call_tool("get_market_overview", {})
                        second = await session.call_tool("analyze_market_regime", {})
                        third = await session.call_tool("analyze_sector_rotation", {})
                        assert first.is_error is False
                        assert second.is_error is False
                        assert third.is_error is True
                        err_text = " ".join(getattr(b, "text", "") for b in third.content)
                        assert "Rate limit exceeded" in err_text
                        # Exiting context triggers DELETE session teardown, which must succeed!
    finally:
        set_service_deps(None)
        set_evidence_writer(None)


async def test_mcp_prompts_include_no_investment_advice_guardrails() -> None:
    briefing = await mcp.get_prompt("daily-market-briefing", {})
    diligence = await mcp.get_prompt("asset-due-diligence", {"symbol": "SOL", "peers": "AVAX"})
    risk = await mcp.get_prompt("market-risk-review", {"symbols": "BTC"})
    for prompt_result in (briefing, diligence, risk):
        text = " ".join(str(msg.content) for msg in prompt_result.messages).lower()
        assert "evidence_id" in text
        assert "do not" in text
        assert any(term in text for term in ("advice", "recommendations", "price targets"))


async def test_mcp_stage_4_3_additive_fields_and_backward_compatibility() -> None:
    import json

    deps, _evidence = research_deps()
    logs = MemoryEvidence()
    set_service_deps(deps)
    set_evidence_writer(logs)
    try:
        # Existing clients omitting max_7d_gain_pct work identically
        movers_default = await mcp.call_tool("scan_market_movers", {"limit": 5})
        movers_filtered = await mcp.call_tool(
            "scan_market_movers",
            {"limit": 5, "max_7d_gain_pct": 10.0},
        )
        asset_res = await mcp.call_tool("analyze_asset", {"symbol": "SOL"})
        sectors_res = await mcp.call_tool("analyze_sector_rotation", {})
    finally:
        set_service_deps(None)
        set_evidence_writer(None)

    assert movers_default.is_error is False
    assert movers_filtered.is_error is False
    assert asset_res.is_error is False
    assert sectors_res.is_error is False

    def _payload(res: object) -> dict[str, object]:
        text = res.content[0].text  # type: ignore[attr-defined]
        return json.loads(text)

    movers_data = _payload(movers_default)["data"]
    assert all("multi_horizon_risk" in row for row in movers_data["movers"])
    filtered_syms = {row["symbol"] for row in _payload(movers_filtered)["data"]["movers"]}
    assert "SOL" not in filtered_syms  # SOL has 7d=20% > 10%

    asset_data = _payload(asset_res)["data"]
    assert asset_data["percent_change_60d"] == 3.0
    assert asset_data["composite_momentum_score"] is not None
    assert asset_data["timeframes_available"] == 4

    sector_rows = _payload(sectors_res)["data"]["sectors"]
    assert all("excess_change_24h_vs_market_pct" in row for row in sector_rows)
    assert all("excess_change_7d_vs_market_pct" in row for row in sector_rows)
