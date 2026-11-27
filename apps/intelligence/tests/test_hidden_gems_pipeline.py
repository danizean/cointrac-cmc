"""Integration and security tests for Hidden Gem Discovery Engine (Phase 2)."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.adapters.cmc_client import CMCEndpointUnavailableError, FetchMeta
from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
from app.main import app
from app.quant.hidden_gems import HIDDEN_GEM_SCORE_VERSION
from app.schemas.hidden_gems import CreateScanRequest
from app.services.budget import (
    BudgetController,
    MemoryBudgetStore,
    install_budget_controller,
    reset_budget_controller,
)
from app.services.daily_closes import DailyCloseRow, MemoryDailyCloseStore
from app.services.evidence import MemoryEvidence
from app.services.hidden_gem_store import MemoryHiddenGemStore
from app.services.hidden_gems import (
    HiddenGemService,
    install_hidden_gem_store,
    reset_hidden_gem_store,
)
from app.services.intelligence import SectorBook, ServiceDeps, install_deps
from app.services.tier_detection import TierDetector, TierObservation

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
KEY_A = "ct_live_hg_user_a_key_001"
KEY_B = "ct_live_hg_user_b_key_002"
KEY_LEGACY = "ct_live_hg_legacy_unscoped_003"
NOW = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)


def _make_daily_v3_quotes(base: float = 1.0, count: int = 45) -> list[dict[str, object]]:
    rows = []
    for i in range(count):
        ts = NOW - timedelta(days=count - i)
        price = round(base * (1.0 + i * 0.008), 6)
        rows.append(
            {
                "timestamp": ts.isoformat(),
                "quote": {
                    "USD": {
                        "price": price,
                        "volume_24h": 6_000_000.0 + i * 50_000.0,
                        "market_cap": price * 80_000_000.0,
                    }
                },
            }
        )
    return rows


def _make_ohlcv_quotes(
    base: float = 1.0, count: int = 45, *, hourly: bool = False
) -> list[dict[str, object]]:
    rows = []
    step = timedelta(hours=1) if hourly else timedelta(days=1)
    for i in range(count):
        ts = NOW - step * (count - i)
        c = round(base * (1.0 + i * (0.001 if hourly else 0.008)), 6)
        rows.append(
            {
                "time_open": (ts - step).isoformat(),
                "time_close": ts.isoformat(),
                "quote": {
                    "USD": {
                        "open": round(c * 0.99, 6),
                        "high": round(c * 1.02, 6),
                        "low": round(c * 0.98, 6),
                        "close": c,
                        "volume": 5_000_000.0 + i * 25_000.0,
                    }
                },
            }
        )
    return rows


def _make_listings_payload() -> dict[str, object]:
    old_date = (NOW - timedelta(days=180)).isoformat()
    recent_date = (NOW - timedelta(days=5)).isoformat()
    rows: list[dict[str, object]] = [
        {
            "id": 1,
            "symbol": "BTC",
            "name": "Bitcoin",
            "slug": "bitcoin",
            "tags": ["pow"],
            "date_added": "2010-07-13T00:00:00.000Z",
            "num_market_pairs": 1200,
            "quote": {
                "USD": {
                    "price": 95000.0,
                    "market_cap": 1_850_000_000_000.0,
                    "volume_24h": 42_000_000_000.0,
                    "percent_change_1h": 0.2,
                    "percent_change_24h": 1.1,
                    "percent_change_7d": 2.0,
                    "percent_change_30d": 5.0,
                    "last_updated": NOW.isoformat(),
                }
            },
        },
        {
            "id": 1027,
            "symbol": "ETH",
            "name": "Ethereum",
            "slug": "ethereum",
            "tags": ["layer-1"],
            "date_added": "2015-08-07T00:00:00.000Z",
            "num_market_pairs": 900,
            "quote": {
                "USD": {
                    "price": 3200.0,
                    "market_cap": 380_000_000_000.0,
                    "volume_24h": 18_000_000_000.0,
                    "percent_change_1h": 0.3,
                    "percent_change_24h": 1.4,
                    "percent_change_7d": 2.5,
                    "percent_change_30d": 4.0,
                    "last_updated": NOW.isoformat(),
                }
            },
        },
        {
            "id": 9001,
            "symbol": "GEMX",
            "name": "GemX Protocol",
            "slug": "gemx-protocol",
            "tags": ["defi", "layer-2"],
            "date_added": None,  # Trigger Stage 4 info backfill
            "num_market_pairs": 28,
            "quote": {
                "USD": {
                    "price": 1.45,
                    "market_cap": 110_000_000.0,
                    "volume_24h": 8_800_000.0,
                    "percent_change_1h": 0.8,
                    "percent_change_24h": 7.5,
                    "percent_change_7d": 16.0,
                    "percent_change_30d": 22.0,
                    "last_updated": NOW.isoformat(),
                }
            },
        },
        {
            "id": 9002,
            "symbol": "GEMB",
            "name": "GemB Network",
            "slug": "gemb-network",
            "tags": ["ai-big-data"],
            "date_added": old_date,
            "num_market_pairs": 18,
            "quote": {
                "USD": {
                    "price": 2.1,
                    "market_cap": 75_000_000.0,
                    "volume_24h": 4_500_000.0,
                    "percent_change_1h": 0.4,
                    "percent_change_24h": 5.0,
                    "percent_change_7d": 11.0,
                    "percent_change_30d": 18.0,
                    "last_updated": NOW.isoformat(),
                }
            },
        },
        {
            "id": 9003,
            "symbol": "TOONEW",
            "name": "Too New Coin",
            "slug": "too-new",
            "tags": ["defi"],
            "date_added": recent_date,
            "num_market_pairs": 12,
            "quote": {
                "USD": {
                    "price": 0.5,
                    "market_cap": 45_000_000.0,
                    "volume_24h": 3_000_000.0,
                    "percent_change_1h": 0.1,
                    "percent_change_24h": 3.0,
                    "percent_change_7d": 8.0,
                    "percent_change_30d": 8.0,
                    "last_updated": NOW.isoformat(),
                }
            },
        },
    ]
    return {"status": {"timestamp": NOW.isoformat()}, "data": rows}


class _RecordingGateway:
    def __init__(
        self,
        *,
        ohlcv_403: bool = False,
        on_call: Any = None,
    ) -> None:
        self.ohlcv_403 = ohlcv_403
        self.on_call = on_call
        self.calls: list[tuple[str, dict[str, object]]] = []

    async def fetch(
        self,
        endpoint: str,
        params: dict[str, object],
        ttl_seconds: int | None = None,
        override_api_key: str | None = None,
        **_: object,
    ) -> tuple[dict[str, object], FetchMeta]:
        del ttl_seconds, override_api_key
        self.calls.append((endpoint, dict(params)))
        if self.on_call is not None:
            self.on_call(endpoint, params)

        meta = FetchMeta(
            data_mode="LIVE",
            freshness="FRESH",
            cache_hit=False,
            credit_cost=1,
            source_timestamp=NOW,
            retrieved_at=NOW,
        )
        if endpoint == "/v1/cryptocurrency/listings/latest":
            assert params.get("convert") == "USD"
            return _make_listings_payload(), meta
        if endpoint == "/v1/global-metrics/quotes/latest":
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {
                    "btc_dominance": 56.5,
                    "eth_dominance": 14.0,
                    "quote": {
                        "USD": {
                            "total_market_cap": 3_100_000_000_000.0,
                            "total_market_cap_yesterday_percentage_change": 1.2,
                            "altcoin_market_cap": 1_350_000_000_000.0,
                        }
                    },
                },
            }, meta
        if endpoint == "/v3/fear-and-greed/latest":
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {"value": 62, "value_classification": "Greed"},
            }, meta
        if endpoint == "/v2/cryptocurrency/info":
            old_date = (NOW - timedelta(days=240)).isoformat()
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {
                    "9001": {
                        "id": 9001,
                        "symbol": "GEMX",
                        "name": "GemX Protocol",
                        "category": "token",
                        "tags": ["defi", "layer-2"],
                        "date_added": old_date,
                        "urls": {"website": ["https://gemx.example"]},
                    }
                },
            }, meta
        if endpoint == "/v2/cryptocurrency/ohlcv/historical":
            if self.ohlcv_403:
                raise CMCEndpointUnavailableError(
                    endpoint,
                    "Simulated plan upgrade required",
                    category="tier_restricted",
                    http_status=403,
                    cmc_error_code=1006,
                )
            cid = str(params.get("id") or "9001")
            hourly = params.get("interval") == "1h"
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {cid: {"quotes": _make_ohlcv_quotes(count=60, hourly=hourly)}},
            }, meta
        if endpoint == "/v3/cryptocurrency/quotes/historical":
            cid = str(params.get("id") or "9001")
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {cid: {"quotes": _make_daily_v3_quotes(count=45)}},
            }, meta
        if endpoint == "/v5/cryptocurrency/derivatives/market-pairs/list/latest":
            return {
                "status": {"timestamp": NOW.isoformat()},
                "data": {
                    "open_interest": 22_000_000.0,
                    "market_pairs": [{"funding_rate": 0.0001}],
                },
            }, meta
        raise CMCEndpointUnavailableError(endpoint, "unmocked", category="client_error")


def _install_env(
    *,
    ohlcv_403: bool = False,
    startup_plan: bool = False,
    budget_cutoff: bool = False,
    on_call: Any = None,
) -> tuple[_RecordingGateway, MemoryHiddenGemStore, HiddenGemService]:
    gw = _RecordingGateway(ohlcv_403=ohlcv_403, on_call=on_call)
    store = MemoryHiddenGemStore()
    close_store = MemoryDailyCloseStore(
        [
            DailyCloseRow(
                cmc_id=9001,
                utc_date=(NOW - timedelta(days=40 - i)).date(),
                close_price=1.0 + i * 0.01,
                market_cap=80_000_000.0,
                volume_24h=4_000_000.0,
            )
            for i in range(35)
        ]
    )
    deps = ServiceDeps(
        gateway=gw,
        evidence=MemoryEvidence(),
        assets=_FakeAssets(),  # type: ignore[arg-type]
        sectors=SectorBook(),
        capabilities=_FakeCaps(),  # type: ignore[arg-type]
        now=lambda: NOW,
        daily_closes=close_store,
    )
    bstore = MemoryBudgetStore()
    budget = BudgetController(store=bstore, quota_profile="startup" if startup_plan else "basic")
    if budget_cutoff:
        asyncio.run(
            budget.record_upstream_call(
                endpoint="/v1/cryptocurrency/listings/latest",
                credit_cost=budget.monthly_budget,
            )
        )
    detector = TierDetector()
    if startup_plan:
        detector._observation = TierObservation("startup", "Startup", 450_000, NOW)
    else:
        detector._observation = TierObservation("basic", "Basic", 9_000, NOW)

    install_deps(deps)
    install_hidden_gem_store(store)
    install_budget_controller(budget)
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord("key-a", key_hash(KEY_A), 120, True, user_id=USER_A),
                ApiKeyRecord("key-b", key_hash(KEY_B), 120, True, user_id=USER_B),
                ApiKeyRecord("key-legacy", key_hash(KEY_LEGACY), 120, True, user_id=None),
            ]
        )
    )
    svc = HiddenGemService(store=store, deps=deps, budget=budget, tier_detector=detector)
    return gw, store, svc


class _FakeAssets:
    async def resolve(self, symbols: list[str]) -> Any:
        from app.adapters.normalizer import SymbolResolution

        return SymbolResolution({}, [])


class _FakeCaps:
    def can_call(self, endpoint: str, credential: str | None = None) -> bool:
        del endpoint, credential
        return True


def _cleanup() -> None:
    install_deps(None)
    reset_hidden_gem_store()
    reset_budget_controller()
    install_keys(None)


def test_single_pass_listings_shared_across_five_concurrent_scans() -> None:
    gw, store, svc = _install_env(ohlcv_403=True, startup_plan=False)
    try:
        async def _run_five() -> list[Any]:
            users = [f"user-{i}" for i in range(5)]
            return await asyncio.gather(
                *(
                    svc.enqueue_scan(
                        user_id=uid,
                        req=CreateScanRequest(track="BOTH", horizon="SWING", universe_limit=250),
                        run_inline=True,
                    )
                    for uid in users
                )
            )

        responses = asyncio.run(_run_five())
        assert len(responses) == 5
        listings_calls = [c for c in gw.calls if c[0] == "/v1/cryptocurrency/listings/latest"]
        stage2_calls = [c for c in listings_calls if c[1].get("limit") == 250]
        assert len(stage2_calls) == 1
        assert len(listings_calls) <= 2
        assert stage2_calls[0][1]["convert"] == "USD"
        assert store.candidates
    finally:
        _cleanup()


def test_capability_switching_startup_vs_basic_403_downgrade() -> None:
    gw_basic, store_basic, svc_basic = _install_env(ohlcv_403=True, startup_plan=True)
    try:
        resp = asyncio.run(
            svc_basic.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="BOTH", horizon="BOTH", universe_limit=200),
                run_inline=True,
            )
        )
        run = asyncio.run(store_basic.get_scan(USER_A, resp.scan_run_id))
        assert run is not None
        assert run["status"] == "PARTIAL"
        assert run["evaluation_profile"] == "BASIC_CAPABILITY_PROFILE"
        endpoints = {ep for ep, _ in gw_basic.calls}
        assert "/v3/cryptocurrency/quotes/historical" in endpoints
    finally:
        _cleanup()

    gw_up, store_up, svc_up = _install_env(ohlcv_403=False, startup_plan=True)
    try:
        resp_up = asyncio.run(
            svc_up.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="CONFIRMED", horizon="SHORT_TERM", universe_limit=200),
                run_inline=True,
            )
        )
        run_up = asyncio.run(store_up.get_scan(USER_A, resp_up.scan_run_id))
        assert run_up is not None
        assert run_up["status"] == "COMPLETED"
        assert run_up["evaluation_profile"] == "STARTUP_CAPABILITY_PROFILE"
        endpoints_up = {ep for ep, _ in gw_up.calls}
        assert "/v2/cryptocurrency/ohlcv/historical" in endpoints_up
        assert "/v5/cryptocurrency/derivatives/market-pairs/list/latest" in endpoints_up
    finally:
        _cleanup()


def test_budget_cutoff_uses_cached_batch_with_zero_cmc_calls() -> None:
    gw, store, svc = _install_env(budget_cutoff=True, startup_plan=False)
    try:
        asset_map = asyncio.run(
            store.upsert_assets(
                [
                    {
                        "canonical_provider": "coinmarketcap",
                        "canonical_provider_id": "9001",
                        "symbol": "GEMX",
                        "name": "GemX Protocol",
                        "tags": ["defi"],
                        "date_added": (NOW - timedelta(days=120)).isoformat(),
                    }
                ]
            )
        )
        asyncio.run(
            store.insert_snapshots(
                [
                    {
                        "asset_id": asset_map["9001"],
                        "ingest_batch_id": "cached-batch-1",
                        "price": 1.45,
                        "market_cap": 110_000_000.0,
                        "volume_24h": 8_800_000.0,
                        "vol_to_mcap": 0.08,
                        "return_24h": 7.0,
                        "return_7d": 15.0,
                        "rs_btc_7d": 12.0,
                        "source_timestamp": NOW.isoformat(),
                        "fetched_at": NOW.isoformat(),
                    }
                ]
            )
        )
        resp = asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                run_inline=True,
            )
        )
        run = asyncio.run(store.get_scan(USER_A, resp.scan_run_id))
        assert run is not None
        assert run["status"] == "COMPLETED"
        assert gw.calls == []
    finally:
        _cleanup()


def test_evidence_failure_marks_run_partial_and_cancellation_stops_run() -> None:
    _, store, svc = _install_env(ohlcv_403=False, startup_plan=True)
    try:
        store.fail_evidence_write = True
        resp = asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                run_inline=True,
            )
        )
        run = asyncio.run(store.get_scan(USER_A, resp.scan_run_id))
        assert run is not None
        assert run["status"] == "PARTIAL"
        assert "Partial persistence failure" in str(run.get("error_summary") or "")

        # Zombie watchdog converts stale RUNNING scans into FAILED
        stale_run = asyncio.run(
            store.create_scan_run(
                {
                    "user_id": USER_A,
                    "status": "RUNNING",
                    "heartbeat_at": (NOW - timedelta(minutes=15)).isoformat(),
                }
            )
        )
        cleaned = asyncio.run(svc.run_zombie_watchdog(stale_seconds=300))
        assert cleaned == 1
        updated_stale = asyncio.run(store.get_scan(USER_A, str(stale_run["id"])))
        assert updated_stale is not None
        assert updated_stale["status"] == "FAILED"
    finally:
        _cleanup()


def test_mid_run_cancellation_aborts_stage5() -> None:
    store_holder: dict[str, Any] = {}

    def _request_cancel_on_info(endpoint: str, _params: dict[str, object]) -> None:
        if endpoint == "/v2/cryptocurrency/info":
            for run in store_holder["store"].runs.values():
                run["cancel_requested_at"] = NOW.isoformat()

    gw, store, svc = _install_env(
        ohlcv_403=False, startup_plan=True, on_call=_request_cancel_on_info
    )
    store_holder["store"] = store
    try:
        resp = asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                run_inline=True,
            )
        )
        run = asyncio.run(store.get_scan(USER_A, resp.scan_run_id))
        assert run is not None
        assert run["status"] == "CANCELLED"
        assert not any(ep == "/v2/cryptocurrency/ohlcv/historical" for ep, _ in gw.calls)
    finally:
        _cleanup()


def test_rest_auth_idor_idempotency_and_lazy_explanation() -> None:
    _, store, svc = _install_env(ohlcv_403=False, startup_plan=True)
    client = TestClient(app)
    try:
        # Unscoped legacy API key must be rejected 401
        unscoped = client.post(
            "/v1/hidden-gems/scans",
            headers={"x-cointrac-key": KEY_LEGACY},
            json={"track": "EARLY", "horizon": "SWING"},
        )
        assert unscoped.status_code == 401

        # Client-supplied user_id rejected by extra="forbid"
        forbid = client.post(
            "/v1/hidden-gems/scans",
            headers={"x-cointrac-key": KEY_A},
            json={"track": "EARLY", "horizon": "SWING", "user_id": USER_B},
        )
        assert forbid.status_code == 422

        # Create scan inline directly so TestClient checks deterministic persisted rows
        first = asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                idempotency_key="idem-123",
                run_inline=True,
            )
        )
        replay = client.post(
            "/v1/hidden-gems/scans",
            headers={"x-cointrac-key": KEY_A, "Idempotency-Key": "idem-123"},
            json={"track": "EARLY", "horizon": "SWING", "universe_limit": 200},
        )
        assert replay.status_code == 202
        assert replay.json()["scan_run_id"] == first.scan_run_id
        assert replay.json()["idempotent_replay"] is True

        # User B cannot read User A's scan or candidates (404 / empty)
        assert (
            client.get(
                f"/v1/hidden-gems/scans/{first.scan_run_id}",
                headers={"x-cointrac-key": KEY_B},
            ).status_code
            == 404
        )
        assert (
            client.get(
                "/v1/hidden-gems/candidates",
                headers={"x-cointrac-key": KEY_B},
            ).json()
            == []
        )

        # User A lists candidates and verifies deterministic lazy explanation & citations
        cands = client.get(
            "/v1/hidden-gems/candidates",
            headers={"x-cointrac-key": KEY_A},
        )
        assert cands.status_code == 200
        rows = cands.json()
        assert len(rows) >= 1
        target_id = rows[0]["id"]
        # Clear explanation to exercise lazy fill path cleanly
        store.candidates[target_id]["explanation"] = None

        detail = client.get(
            f"/v1/hidden-gems/candidates/{target_id}",
            headers={"x-cointrac-key": KEY_A},
        )
        assert detail.status_code == 200
        body = detail.json()
        assert body["candidate"]["score_version"] == HIDDEN_GEM_SCORE_VERSION
        assert body["explanation"] is not None
        assert body["explanation"]["summary"]
        assert body["explanation"]["why_discovered"]
        assert body["explanation"]["why_discovered"][0]["evidence_id"] in {
            ev["id"] for ev in body["evidence"]
        }
        assert (
            client.get(
                f"/v1/hidden-gems/candidates/{target_id}",
                headers={"x-cointrac-key": KEY_B},
            ).status_code
            == 404
        )

        # Configs & Watchlist isolation
        cfg = client.post(
            "/v1/hidden-gems/configs",
            headers={"x-cointrac-key": KEY_A},
            json={"name": "Early Momentum Preset"},
        )
        assert cfg.status_code == 201
        cfg_id = cfg.json()["id"]
        assert (
            client.patch(
                f"/v1/hidden-gems/configs/{cfg_id}",
                headers={"x-cointrac-key": KEY_B},
                json={"name": "Hijacked"},
            ).status_code
            == 404
        )

        wl = client.post(
            "/v1/hidden-gems/watchlist",
            headers={"x-cointrac-key": KEY_A},
            json={"asset_id": rows[0]["asset_id"], "candidate_result_id": target_id},
        )
        assert wl.status_code == 201
        wl_id = wl.json()["id"]
        assert (
            client.delete(
                f"/v1/hidden-gems/watchlist/{wl_id}",
                headers={"x-cointrac-key": KEY_B},
            ).status_code
            == 404
        )
        assert (
            client.delete(
                f"/v1/hidden-gems/watchlist/{wl_id}",
                headers={"x-cointrac-key": KEY_A},
            ).status_code
            == 204
        )

        # Quality stats endpoint responds with valid list
        qstats = client.get(
            "/v1/hidden-gems/quality-stats",
            headers={"x-cointrac-key": KEY_A},
        )
        assert qstats.status_code == 200

        # Latest scan exposes honest stage-by-stage progress telemetry
        scans_resp = client.get("/v1/hidden-gems/scans", headers={"x-cointrac-key": KEY_A})
        assert scans_resp.status_code == 200
        prog = scans_resp.json()[0]["source_metadata"]["progress"]
        assert prog["stage_total"] == 5
        assert prog["stage_pct"] == 100.0
        assert len(prog["stages_completed"]) == 5
    finally:
        _cleanup()
