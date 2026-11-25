"""Cancellation must keep a server-key reservation and must still propagate."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.adapters.cmc_client import CMCClient
from app.services.budget import BudgetController, MemoryBudgetStore


class _EmptySnapshots:
    async def get_by_key(self, key: str) -> None:
        del key
        return None

    async def list_endpoint(self, endpoint: str) -> list[object]:
        del endpoint
        return []

    async def upsert(self, snapshot: object) -> None:
        del snapshot


class _CancelOnGet:
    async def get(self, *args: object, **kwargs: object) -> None:
        del args, kwargs
        raise asyncio.CancelledError


@pytest.mark.asyncio
async def test_cancelled_upstream_call_holds_unknown_and_reraises() -> None:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: now,
    )
    client = CMCClient(
        api_key="server-key",
        base_url="https://pro-api.coinmarketcap.com",
        snapshot_store=_EmptySnapshots(),  # type: ignore[arg-type]
        budget_controller=budget,
        simulate_basic_tier=False,
        now=lambda: now,
        client=_CancelOnGet(),  # type: ignore[arg-type]
    )
    with pytest.raises(asyncio.CancelledError):
        await client.fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})
    assert len(store.events) == 1
    event = store.events[0]
    assert event.credit_status == "unknown"
    assert event.released is False
    assert event.error_category == "transient_error"
    assert event.reservation_credits == 1
    assert event.idempotency_key
    assert event.idempotency_key.startswith("cmc:")


class _CancelBeforeReserve(MemoryBudgetStore):
    async def reserve(self, **kwargs: object) -> object:
        del kwargs
        raise asyncio.CancelledError


class _CancelDuringReserve(MemoryBudgetStore):
    def __init__(self) -> None:
        super().__init__()
        self.entered = False

    async def reserve(self, **kwargs: object) -> object:
        del kwargs
        self.entered = True
        raise asyncio.CancelledError


class _CommitThenLoseResponse(MemoryBudgetStore):
    async def reserve(self, **kwargs: object) -> object:
        await super().reserve(**kwargs)  # type: ignore[arg-type]
        raise asyncio.CancelledError


def _client(store: MemoryBudgetStore, http: object) -> CMCClient:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: now,
    )
    return CMCClient(
        api_key="server-key",
        base_url="https://pro-api.coinmarketcap.com",
        snapshot_store=_EmptySnapshots(),  # type: ignore[arg-type]
        budget_controller=budget,
        simulate_basic_tier=False,
        now=lambda: now,
        client=http,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_cancel_before_reservation_rpc_creates_no_hold() -> None:
    store = _CancelBeforeReserve()
    with pytest.raises(asyncio.CancelledError):
        await _client(store, _CancelOnGet()).fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})
    assert store.events == []


@pytest.mark.asyncio
async def test_cancel_during_reservation_does_not_invent_a_hold() -> None:
    store = _CancelDuringReserve()
    with pytest.raises(asyncio.CancelledError):
        await _client(store, _CancelOnGet()).fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})
    assert store.entered is True
    assert store.events == []


@pytest.mark.asyncio
async def test_lost_reservation_response_is_reconciled_under_the_same_key() -> None:
    store = _CommitThenLoseResponse()
    with pytest.raises(asyncio.CancelledError):
        await _client(store, _CancelOnGet()).fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})
    assert len(store.events) == 1
    event = store.events[0]
    assert event.idempotency_key
    assert event.credit_status == "unknown"
    assert event.released is False
    assert event.credit_cost == 1


@pytest.mark.asyncio
async def test_same_idempotency_key_does_not_double_charge() -> None:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: now,
    )
    first = await budget.reserve_upstream(
        endpoint="/v2/cryptocurrency/quotes/latest",
        idempotency_key="cmc:sameattempt",
    )
    second = await budget.reserve_upstream(
        endpoint="/v2/cryptocurrency/quotes/latest",
        idempotency_key="cmc:sameattempt",
    )
    assert first.allowed and second.allowed
    assert first.idempotency_key == second.idempotency_key == "cmc:sameattempt"
    assert len(store.events) == 1
    assert sum(event.reservation_credits for event in store.events) == 1


@pytest.mark.asyncio
async def test_successful_reconcile_records_actual_credits() -> None:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    store = MemoryBudgetStore()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: now,
    )
    decision = await budget.reserve_upstream(
        endpoint="/v2/cryptocurrency/quotes/latest",
        idempotency_key="cmc:knownattempt",
    )
    await budget.reconcile_upstream(
        idempotency_key="cmc:knownattempt",
        outcome="known",
        actual_credits=2,
        error_category=None,
        reservation_credits=decision.reservation_credits,
        endpoint="/v2/cryptocurrency/quotes/latest",
        cache_status="MISS",
        caller="user",
        attempt_no=1,
    )
    assert store.events[0].credit_status == "known"
    assert store.events[0].credit_cost == 2


class _ReconcileFails(MemoryBudgetStore):
    async def reconcile(self, **kwargs: object) -> None:
        del kwargs
        raise RuntimeError("ledger down")


@pytest.mark.asyncio
async def test_failed_reconcile_keeps_the_traceable_hold() -> None:
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    store = _ReconcileFails()
    budget = BudgetController(
        quota_profile="basic",
        monthly_budget=10_000,
        store=store,
        now=lambda: now,
    )
    await budget.reserve_upstream(
        endpoint="/v2/cryptocurrency/quotes/latest",
        idempotency_key="cmc:heldattempt",
    )
    await budget.reconcile_upstream(
        idempotency_key="cmc:heldattempt",
        outcome="known",
        actual_credits=2,
        error_category=None,
        reservation_credits=1,
        endpoint="/v2/cryptocurrency/quotes/latest",
        cache_status="MISS",
        caller="user",
        attempt_no=1,
    )
    event = store.events[0]
    assert event.credit_status == "reserved"
    assert event.credit_cost == 1
    assert event.idempotency_key == "cmc:heldattempt"
    assert event.released is False


class _SlowReconcile(MemoryBudgetStore):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()

    async def reconcile(self, **kwargs: object) -> None:
        self.started.set()
        await asyncio.sleep(0.05)
        await super().reconcile(**kwargs)  # type: ignore[arg-type]


class _OkGet:
    async def get(self, *args: object, **kwargs: object) -> object:
        del args, kwargs
        return httpx.Response(
            200,
            json={"status": {"error_code": 0, "credit_count": 1}, "data": {}},
        )


@pytest.mark.asyncio
async def test_cancel_during_reconcile_still_finishes_and_reraises() -> None:
    store = _SlowReconcile()

    async def run() -> None:
        await _client(store, _OkGet()).fetch("/v2/cryptocurrency/quotes/latest", {"id": "1"})

    task = asyncio.create_task(run())
    await store.started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.1)
    assert len(store.events) == 1
    assert store.events[0].credit_status == "known"
    assert store.events[0].credit_cost == 1
    assert store.events[0].idempotency_key


def test_migration_012_blocks_delete_without_touching_insert() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "supabase"
        / "migrations"
        / "012_daily_asset_closes_no_delete.sql"
    )
    sql = path.read_text(encoding="utf-8")
    statements = [line.strip() for line in sql.splitlines() if not line.strip().startswith("--")]
    body = "\n".join(statements)
    assert "private.prevent_daily_asset_close_delete" in body
    assert "BEFORE DELETE ON public.daily_asset_closes" in body
    assert "SET search_path = ''" in body
    assert "ERRCODE = '55000'" in body
    assert "REVOKE DELETE, TRUNCATE ON TABLE public.daily_asset_closes" in body
    assert "BEFORE TRUNCATE ON public.daily_asset_closes" in body
    assert "service_role" in body
    assert "GRANT DELETE" not in body
    assert "DELETE FROM public.daily_asset_closes" not in body
