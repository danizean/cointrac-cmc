"""Phase 4 tests: Scheduled rescan, 6h alert dedup, T+1/3/7/14/30d outcomes, and Telegram."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from tests.test_hidden_gems_pipeline import (
    KEY_A,
    NOW,
    USER_A,
    _FakeAssets,
    _FakeCaps,
    _RecordingGateway,
)

from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
from app.main import app
from app.quant.hidden_gems import HIDDEN_GEM_SCORE_VERSION
from app.schemas.hidden_gems import CreateScanRequest, ScanConfigCreate
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
from app.services.telegram import (
    TelegramNotifier,
    install_telegram_notifier,
    reset_telegram_notifier,
)
from app.services.tier_detection import TierDetector, TierObservation


def _setup_phase4(
    *,
    send_hook=None,
    bot_token: str = "",
    chat_id: str = "",
    cutoff: bool = False,
) -> tuple[dict[str, datetime], MemoryHiddenGemStore, HiddenGemService]:
    clock = {"now": NOW}
    gw = _RecordingGateway(ohlcv_403=False)
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
        now=lambda: clock["now"],
        daily_closes=close_store,
    )
    bstore = MemoryBudgetStore()
    budget = BudgetController(store=bstore, quota_profile="startup")
    if cutoff:
        asyncio.run(
            budget.record_upstream_call(
                endpoint="/v1/cryptocurrency/listings/latest",
                credit_cost=budget.monthly_budget,
            )
        )
    detector = TierDetector()
    detector._observation = TierObservation("startup", "Startup", 450_000, NOW)
    notifier = TelegramNotifier(
        bot_token=bot_token,
        default_chat_id=chat_id,
        send_hook=send_hook,
    )

    install_deps(deps)
    install_hidden_gem_store(store)
    install_budget_controller(budget)
    install_telegram_notifier(notifier)
    install_keys(
        MemoryKeyDirectory([ApiKeyRecord("key-a", key_hash(KEY_A), 120, True, user_id=USER_A)])
    )
    svc = HiddenGemService(
        store=store,
        deps=deps,
        budget=budget,
        tier_detector=detector,
        telegram=notifier,
    )
    return clock, store, svc


def _teardown() -> None:
    install_deps(None)
    reset_hidden_gem_store()
    reset_budget_controller()
    reset_telegram_notifier()
    install_keys(None)


def test_alert_deduplication_and_telegram_dispatch() -> None:
    sent_messages: list[tuple[str, str]] = []

    async def _mock_send(chat: str, text: str) -> bool:
        sent_messages.append((chat, text))
        return True

    clock, store, svc = _setup_phase4(send_hook=_mock_send, chat_id="123456")
    try:
        # First scan with track="BOTH", horizon="BOTH" must send AT MOST 1 Telegram message for GEMX
        asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="BOTH", horizon="BOTH", universe_limit=200),
                run_inline=True,
            )
        )
        alerts_t0 = asyncio.run(svc.list_alerts(USER_A))
        assert len(alerts_t0) >= 1
        allowed_ev = ("NEW_DISCOVERY", "CONFIRMATION", "SCORE_UPGRADE")
        assert all(a.event_type in allowed_ev for a in alerts_t0)
        tg_sent = [
            a
            for a in alerts_t0
            if a.delivery_channel == "TELEGRAM" and a.delivery_status == "SENT"
        ]
        assert len(tg_sent) == 1
        assert len(sent_messages) == 1
        assert "GEMX" in sent_messages[0][1]
        assert "Price:" in sent_messages[0][1]
        assert "RS vs BTC 7d:" in sent_messages[0][1]

        # Re-scan 10 minutes later (< 6h dedup window): zero duplicate alerts & zero Telegram spam
        clock["now"] = NOW + timedelta(minutes=10)
        count_before = len(store.alerts)
        asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="BOTH", horizon="BOTH", universe_limit=200),
                run_inline=True,
            )
        )
        assert len(store.alerts) == count_before
        assert len(sent_messages) == 1

        # Simulate 7h expiry while GEMX stays ELIGIBLE: still no NEW_DISCOVERY re-spam!
        for existing in store.alerts:
            existing["created_at"] = (clock["now"] - timedelta(hours=7)).isoformat()
            existing["delivered_at"] = (clock["now"] - timedelta(hours=7)).isoformat()
        asyncio.run(
            svc.enqueue_scan(
                user_id=USER_A,
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                run_inline=True,
            )
        )
        assert len(sent_messages) == 1

        # Failed Telegram dispatch on a new account/discovery records FAILED cleanly without crash
        async def _fail_send(_chat: str, _text: str) -> bool:
            return False

        svc._telegram = TelegramNotifier(send_hook=_fail_send, default_chat_id="123456")
        asyncio.run(
            svc.enqueue_scan(
                user_id="00000000-0000-0000-0000-000000000099",
                req=CreateScanRequest(track="EARLY", horizon="SWING", universe_limit=200),
                run_inline=True,
            )
        )
        assert any(a["delivery_status"] == "FAILED" for a in store.alerts)
    finally:
        _teardown()


def test_forward_outcome_checkpoints_t1_to_t30_and_quality_stats() -> None:
    clock, store, svc = _setup_phase4()
    try:
        asset_ids = asyncio.run(
            store.upsert_assets(
                [
                    {
                        "canonical_provider": "coinmarketcap",
                        "canonical_provider_id": "1",
                        "symbol": "BTC",
                        "name": "Bitcoin",
                    },
                    {
                        "canonical_provider": "coinmarketcap",
                        "canonical_provider_id": "9001",
                        "symbol": "GEMX",
                        "name": "GemX Protocol",
                    },
                ]
            )
        )
        btc_id = asset_ids["1"]
        gem_id = asset_ids["9001"]
        cp_id = "cp-9001"
        store.checkpoints[cp_id] = {
            "id": cp_id,
            "user_id": USER_A,
            "candidate_result_id": "cand-9001",
            "asset_id": gem_id,
            "discovery_track": "EARLY",
            "trading_horizon": "SWING",
            "score_version": HIDDEN_GEM_SCORE_VERSION,
            "entry_price": 1.0,
            "entry_btc_price": 90_000.0,
            "entry_observed_at": NOW.isoformat(),
        }

        async def _eval_at(days: int, gem_price: float, btc_price: float) -> None:
            ts = NOW + timedelta(days=days, hours=1)
            clock["now"] = ts
            await store.insert_snapshots(
                [
                    {
                        "asset_id": gem_id,
                        "ingest_batch_id": f"b-{days}",
                        "price": gem_price,
                        "observed_at": ts.isoformat(),
                        "fetched_at": ts.isoformat(),
                        "source_timestamp": ts.isoformat(),
                    },
                    {
                        "asset_id": btc_id,
                        "ingest_batch_id": f"b-{days}",
                        "price": btc_price,
                        "observed_at": ts.isoformat(),
                        "fetched_at": ts.isoformat(),
                        "source_timestamp": ts.isoformat(),
                    },
                ]
            )
            await svc.evaluate_outcome_checkpoints()

        asyncio.run(_eval_at(1, 1.12, 91_800.0))  # +12%, BTC +2%
        asyncio.run(_eval_at(3, 0.95, 89_100.0))  # -5% MAE
        asyncio.run(_eval_at(7, 1.32, 99_000.0))  # +32%, BTC +10% => rel_btc_7d = +20%
        asyncio.run(_eval_at(14, 1.40, 100_000.0))
        asyncio.run(_eval_at(30, 1.50, 108_000.0))

        cp = store.checkpoints[cp_id]
        assert cp["ret_1d"] == 12.0
        assert cp["ret_3d"] == -5.0
        assert cp["ret_7d"] == 32.0
        assert cp["rel_btc_7d"] == 20.0
        assert cp["ret_14d"] == 40.0
        assert cp["ret_30d"] == 50.0
        assert cp["mfe_30d"] == 50.0
        assert cp["mae_30d"] == -5.0

        stats = asyncio.run(svc.get_quality_stats(USER_A))
        assert len(stats) == 1
        assert stats[0].evaluated_7d == 1
        assert stats[0].positive_7d_rate == 1.0
        assert stats[0].avg_rel_btc_7d == 20.0
        assert stats[0].mean_mae_30d == -5.0
    finally:
        _teardown()


def test_scheduled_rescan_coordinator_respects_interval_overlap_and_cutoff() -> None:
    clock, store, svc = _setup_phase4(cutoff=False)
    try:
        cfg = asyncio.run(
            svc.create_config(
                USER_A,
                ScanConfigCreate(
                    name="6h Auto Scan",
                    discovery_track="EARLY",
                    trading_horizon="SWING",
                    schedule_config={"enabled": True, "interval_minutes": 360},
                ),
            )
        )
        # First pass triggers scan cleanly
        assert asyncio.run(svc.run_due_scheduled_scans(run_inline=True)) == 1
        assert len(store.runs) == 1

        # Inside interval (< 360 min) must skip
        clock["now"] = NOW + timedelta(minutes=120)
        assert asyncio.run(svc.run_due_scheduled_scans(run_inline=True)) == 0

        # Active RUNNING scan blocks overlapping scheduled trigger
        clock["now"] = NOW + timedelta(minutes=370)
        asyncio.run(
            store.create_scan_run(
                {"user_id": USER_A, "status": "RUNNING", "heartbeat_at": clock["now"].isoformat()}
            )
        )
        assert asyncio.run(svc.run_due_scheduled_scans(run_inline=True)) == 0

        # After active scan finishes and config re-enabled past interval, it triggers again
        for r in store.runs.values():
            r["status"] = "COMPLETED"
        store.configs[cfg.id]["schedule_config"]["last_triggered_at"] = NOW.isoformat()
        clock["now"] = NOW + timedelta(minutes=730)
        assert asyncio.run(svc.run_due_scheduled_scans(run_inline=True)) == 1
    finally:
        _teardown()

    # Budget CUTOFF skips scheduled scans cleanly
    _, _, svc_cutoff = _setup_phase4(cutoff=True)
    try:
        asyncio.run(
            svc_cutoff.create_config(
                USER_A,
                ScanConfigCreate(
                    name="Paused On Cutoff",
                    schedule_config={"enabled": True, "interval_minutes": 60},
                ),
            )
        )
        assert asyncio.run(svc_cutoff.run_due_scheduled_scans(run_inline=True)) == 0
    finally:
        _teardown()


def test_phase4_rest_endpoints_evaluate_outcomes_and_telegram_test() -> None:
    _, _, _ = _setup_phase4()
    client = TestClient(app)
    try:
        ev_resp = client.post(
            "/v1/hidden-gems/outcomes/evaluate",
            headers={"x-cointrac-key": KEY_A},
        )
        assert ev_resp.status_code == 200
        assert ev_resp.json() == {"evaluated": 0}

        tg_resp = client.post(
            "/v1/hidden-gems/alerts/test-telegram",
            headers={"x-cointrac-key": KEY_A},
        )
        assert tg_resp.status_code == 200
        assert tg_resp.json()["configured"] is False
        assert tg_resp.json()["attempted"] is False
    finally:
        _teardown()
