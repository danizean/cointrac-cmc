"""Phase 1 MCP tests: read-only Hidden Gems tools, auth isolation, pagination, and outcomes."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import httpx
import pytest
from mcp.client.streamable_http import streamable_http_client
from mcp.server.mcpserver.exceptions import ToolError
from tests.test_hidden_gems_phase4 import _setup_phase4
from tests.test_hidden_gems_pipeline import KEY_A, KEY_B, KEY_LEGACY, NOW, USER_A, USER_B

from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    current_mcp_auth,
    install_keys,
    key_hash,
)
from app.main import create_app
from app.mcp.server import mcp, set_evidence_writer, set_service_deps
from app.schemas.hidden_gems import CreateScanRequest
from app.services.budget import reset_budget_controller
from app.services.evidence import MemoryEvidence
from app.services.hidden_gems import install_hidden_gem_store, reset_hidden_gem_store
from app.services.telegram import reset_telegram_notifier
from mcp import ClientSession


def _payload(res: object) -> dict[str, object]:
    text = res.content[0].text  # type: ignore[attr-defined]
    return json.loads(text)


async def test_hidden_gems_mcp_requires_scoped_user_fail_closed() -> None:
    evidence = MemoryEvidence()
    set_evidence_writer(evidence)
    try:
        # Anonymous caller (no auth context) must fail closed
        for tool_name, args in (
            ("list_hidden_gem_candidates", {}),
            ("get_hidden_gem_detail", {"candidate_id": "cand-1"}),
            ("get_hidden_gem_quality_stats", {}),
        ):
            with pytest.raises(ToolError) as exc_info:
                await mcp.call_tool(tool_name, args)
            assert "Authentication required" in str(exc_info.value)

        # Key without user_id (unscoped legacy key) must fail closed too
        token = current_mcp_auth.set(
            ApiKeyRecord(
                key_id="legacy-id",
                key_hash=key_hash(KEY_LEGACY),
                rate_limit_per_min=60,
                is_active=True,
                user_id=None,
            )
        )
        try:
            with pytest.raises(ToolError) as exc_info:
                await mcp.call_tool("list_hidden_gem_candidates", {})
            assert "Authentication required" in str(exc_info.value)
        finally:
            current_mcp_auth.reset(token)

        # Resource template must also fail closed without user_id
        res = await mcp.read_resource("cointrac://hidden-gems/candidates/cand-1")
        raw = json.loads(res[0].content)  # type: ignore[attr-defined]
        assert raw["status"] == "INSUFFICIENT_DATA"
        assert "authentication" in raw["limitations"][0].lower()
    finally:
        set_evidence_writer(None)


async def test_hidden_gems_mcp_validation_errors_are_sanitized() -> None:
    token = current_mcp_auth.set(
        ApiKeyRecord(
            key_id="key-a",
            key_hash=key_hash(KEY_A),
            rate_limit_per_min=60,
            is_active=True,
            user_id=USER_A,
        )
    )
    try:
        bad_cases = [
            ("list_hidden_gem_candidates", {"limit": 0}, "limit"),
            ("list_hidden_gem_candidates", {"min_score": 150.0}, "min_score"),
            ("list_hidden_gem_candidates", {"offset": -1}, "offset"),
            ("get_hidden_gem_detail", {"candidate_id": "   "}, "candidate_id"),
            ("get_hidden_gem_quality_stats", {"track": "UNKNOWN"}, "track"),
        ]
        for tool_name, args, expected_field in bad_cases:
            with pytest.raises(ToolError) as exc_info:
                await mcp.call_tool(tool_name, args)
            msg = str(exc_info.value)
            assert expected_field in msg
            assert "Traceback" not in msg
            assert "apps/" not in msg and "apps\\" not in msg
    finally:
        current_mcp_auth.reset(token)


async def test_hidden_gems_mcp_list_detail_outcomes_and_tenant_isolation() -> None:
    clock, store, svc = _setup_phase4()
    logs = MemoryEvidence()
    set_service_deps(svc.deps)
    set_evidence_writer(logs)
    try:
        # Empty account returns INSUsFFICIENT_DATA for quality stats and empty OK for candidates
        tok_a = current_mcp_auth.set(
            ApiKeyRecord(
                key_id="key-a",
                key_hash=key_hash(KEY_A),
                rate_limit_per_min=60,
                is_active=True,
                user_id=USER_A,
            )
        )
        try:
            empty_stats = _payload(await mcp.call_tool("get_hidden_gem_quality_stats", {}))
            assert empty_stats["status"] == "INSUFFICIENT_DATA"
            assert empty_stats["data"]["total_groups"] == 0
            assert empty_stats["evidence"]["cmc_credit_cost"] == 0
        finally:
            current_mcp_auth.reset(tok_a)

        # Populate scans for USER_A and USER_B separately
        await svc.enqueue_scan(
            user_id=USER_A,
            req=CreateScanRequest(track="BOTH", horizon="BOTH", universe_limit=200),
            run_inline=True,
        )
        await svc.enqueue_scan(
            user_id=USER_B,
            req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
            run_inline=True,
        )

        # Insert +7d snapshots for tracked assets & BTC, advance clock, and evaluate checkpoints
        rest_all = await svc.list_candidates(USER_A, limit=50, offset=0)
        assert len(rest_all) >= 2
        ts_7d = NOW + timedelta(days=7, hours=1)
        clock["now"] = ts_7d
        btc_asset_id = next(
            (
                aid
                for aid, row in store.assets.items()
                if str(row.get("canonical_provider_id")) == "1"
                or str(row.get("symbol")) == "BTC"
            ),
            None,
        )
        assert btc_asset_id is not None
        snap_rows = [
            {
                "asset_id": btc_asset_id,
                "ingest_batch_id": "mcp-eval-7d",
                "price": 95_000.0,
                "observed_at": ts_7d.isoformat(),
                "fetched_at": ts_7d.isoformat(),
                "source_timestamp": ts_7d.isoformat(),
            }
        ]
        seen_assets = {btc_asset_id}
        for cand in rest_all:
            if cand.asset_id in seen_assets:
                continue
            seen_assets.add(cand.asset_id)
            snap_rows.append(
                {
                    "asset_id": cand.asset_id,
                    "ingest_batch_id": "mcp-eval-7d",
                    "price": (cand.price or 1.0) * 1.25,
                    "observed_at": ts_7d.isoformat(),
                    "fetched_at": ts_7d.isoformat(),
                    "source_timestamp": ts_7d.isoformat(),
                }
            )
        await store.insert_snapshots(snap_rows)
        evaluated = await svc.evaluate_outcome_checkpoints()
        assert evaluated > 0

        tok_a = current_mcp_auth.set(
            ApiKeyRecord(
                key_id="key-a",
                key_hash=key_hash(KEY_A),
                rate_limit_per_min=60,
                is_active=True,
                user_id=USER_A,
            )
        )
        try:
            # Pagination & deterministic score ordering parity with REST/service
            page_1 = _payload(
                await mcp.call_tool("list_hidden_gem_candidates", {"limit": 1, "offset": 0})
            )
            page_2 = _payload(
                await mcp.call_tool("list_hidden_gem_candidates", {"limit": 1, "offset": 1})
            )
            assert page_1["data"]["count"] == 1
            assert page_1["data"]["has_more"] is True
            assert page_2["data"]["count"] == 1
            assert page_1["data"]["candidates"][0]["id"] == rest_all[0].id
            assert page_2["data"]["candidates"][0]["id"] == rest_all[1].id

            # Filtered list matches REST filters
            early_only = _payload(
                await mcp.call_tool("list_hidden_gem_candidates", {"track": "EARLY", "limit": 20})
            )
            assert all(c["discovery_track"] == "EARLY" for c in early_only["data"]["candidates"])

            # Candidate detail includes breakdown, evidence, and matured outcome_checkpoint
            target_id = rest_all[0].id
            detail_env = _payload(
                await mcp.call_tool("get_hidden_gem_detail", {"candidate_id": target_id})
            )
            assert detail_env["data"]["found"] is True
            detail = detail_env["data"]["detail"]
            assert detail["candidate"]["id"] == target_id
            assert detail["component_scores"]
            assert detail["effective_weights"]
            assert detail["evidence"]
            assert detail["outcome_checkpoint"] is not None
            # Matured T+7d exists while unmatured T+30d stays None (never 0)
            assert detail["outcome_checkpoint"]["ret_7d"] is not None
            assert detail["outcome_checkpoint"]["ret_30d"] is None

            # Resource template matches detail envelope
            res_read = await mcp.read_resource(f"cointrac://hidden-gems/candidates/{target_id}")
            res_env = json.loads(res_read[0].content)  # type: ignore[attr-defined]
            assert res_env["data"]["detail"]["candidate"]["id"] == target_id

            # Quality stats parity with REST service
            rest_stats = await svc.get_quality_stats(USER_A, track="EARLY")
            mcp_stats = _payload(
                await mcp.call_tool("get_hidden_gem_quality_stats", {"track": "EARLY"})
            )
            assert mcp_stats["status"] == "OK"
            assert mcp_stats["data"]["rows"] == [r.model_dump(mode="json") for r in rest_stats]
            assert mcp_stats["evidence"]["cmc_credit_cost"] == 0
            assert mcp_stats["evidence"]["cmc_endpoints_called"] == []
            assert mcp_stats["evidence"]["evidence_id"].startswith("ev_")
        finally:
            current_mcp_auth.reset(tok_a)

        # USER_B cannot inspect USER_A's candidate detail via tool or resource (fail closed)
        tok_b = current_mcp_auth.set(
            ApiKeyRecord(
                key_id="key-b",
                key_hash=key_hash(KEY_B),
                rate_limit_per_min=60,
                is_active=True,
                user_id=USER_B,
            )
        )
        try:
            cross = _payload(
                await mcp.call_tool("get_hidden_gem_detail", {"candidate_id": target_id})
            )
            assert cross["status"] == "INSUFFICIENT_DATA"
            assert cross["data"]["found"] is False
            assert cross["data"]["detail"] is None

            cross_res = await mcp.read_resource(f"cointrac://hidden-gems/candidates/{target_id}")
            cross_res_env = json.loads(cross_res[0].content)  # type: ignore[attr-defined]
            assert cross_res_env["status"] == "INSUFFICIENT_DATA"
            assert cross_res_env["data"]["found"] is False
        finally:
            current_mcp_auth.reset(tok_b)

        assert all(entry.surface == "mcp" for entry in logs.logs)
        assert logs.records  # EvidenceDraft records persisted
    finally:
        set_service_deps(None)
        set_evidence_writer(None)
        reset_hidden_gem_store()
        reset_telegram_notifier()
        reset_budget_controller()


@pytest.mark.asyncio
async def test_hidden_gems_mcp_streamable_http_end_to_end() -> None:
    _clock, store, svc = _setup_phase4()
    await svc.enqueue_scan(
        user_id=USER_A,
        req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
        run_inline=True,
    )
    install_hidden_gem_store(store)
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="key-a",
                    key_hash=key_hash(KEY_A),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id=USER_A,
                )
            ]
        )
    )
    logs = MemoryEvidence()
    set_service_deps(svc.deps)
    set_evidence_writer(logs)
    app = create_app()
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"x-cointrac-key": KEY_A},
            ) as http_client:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp",
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        listed = _payload(
                            await session.call_tool("list_hidden_gem_candidates", {"limit": 5})
                        )
                        assert listed["tool"] == "list_hidden_gem_candidates"
                        assert listed["data"]["count"] >= 1
                        cid = listed["data"]["candidates"][0]["id"]
                        detail = _payload(
                            await session.call_tool(
                                "get_hidden_gem_detail", {"candidate_id": cid}
                            )
                        )
                        assert detail["data"]["found"] is True
                        stats = _payload(
                            await session.call_tool("get_hidden_gem_quality_stats", {})
                        )
                        assert stats["tool"] == "get_hidden_gem_quality_stats"
                        assert stats["status"] in {"OK", "PARTIAL"}
    finally:
        install_keys(None)
        set_service_deps(None)
        set_evidence_writer(None)
        reset_hidden_gem_store()
        reset_telegram_notifier()
        reset_budget_controller()
