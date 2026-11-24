"""Phase 4A quota RPC cutover.

Unit tests prove SupabaseRateStore calls only cointrac_consume_rate_window and
fails closed. Live tests run only when SUPABASE_URL is the Development project
fflwfpmbyykyxhlhikwc, and they use disposable principals that are not real users.
"""

from __future__ import annotations

import asyncio
import uuid
from urllib.parse import urlparse

import pytest

from app.api.deps import RATE_WINDOW_RPC, RateStoreUnavailable, SupabaseRateStore
from app.core.config import get_settings
from app.core.db import supabase_client

DEVELOPMENT_HOST = "fflwfpmbyykyxhlhikwc.supabase.co"
FORBIDDEN_REF = "udprwjbmrfknulngsjid"
LEGACY_RPC = "tradeguard_consume_rate_window"
_TEST_PREFIX = "c04a0000-0000-4000-8000-"


class _Result:
    def __init__(self, data: object) -> None:
        self.data = data


class _RpcCall:
    def __init__(self, action) -> None:
        self._action = action

    def execute(self) -> _Result:
        outcome = self._action()
        if isinstance(outcome, Exception):
            raise outcome
        return _Result(outcome)


class _FakeClient:
    def __init__(self, action) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self._action = action

    def rpc(self, name: str, params: dict[str, object]) -> _RpcCall:
        self.calls.append((name, params))
        return _RpcCall(self._action)


def _principal(kind: str = "user") -> str:
    suffix = uuid.uuid4().hex[:12]
    return f"{kind}:{_TEST_PREFIX}{suffix}"


def _development_client():
    url = get_settings().supabase_url.strip()
    if FORBIDDEN_REF in url:
        pytest.fail("refusing the unrelated Supabase project")
    host = urlparse(url).hostname or ""
    if host != DEVELOPMENT_HOST:
        pytest.skip("Development Supabase URL is not configured")
    return supabase_client()


def test_store_calls_canonical_rpc_for_a_valid_principal(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient(lambda: [{"allowed": True, "retry_after": 0}])
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)
    principal = _principal()

    assert asyncio.run(SupabaseRateStore().consume(principal, 30)) is None

    assert client.calls == [(RATE_WINDOW_RPC, {"p_principal": principal, "p_limit": 30})]
    assert LEGACY_RPC not in {name for name, _params in client.calls}


def test_store_forwards_an_invalid_principal_and_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeClient(lambda: RuntimeError("invalid rate principal"))
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)

    with pytest.raises(RateStoreUnavailable):
        asyncio.run(SupabaseRateStore().consume("not-a-principal", 30))

    assert client.calls == [(RATE_WINDOW_RPC, {"p_principal": "not-a-principal", "p_limit": 30})]


def test_store_allows_requests_at_and_under_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient(lambda: [{"allowed": True, "retry_after": 0}])
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)

    store = SupabaseRateStore()
    assert asyncio.run(store.consume(_principal(), 2)) is None
    assert asyncio.run(store.consume(_principal("api_key"), 2)) is None
    assert all(name == RATE_WINDOW_RPC for name, _params in client.calls)


def test_store_returns_retry_after_when_the_limit_is_exceeded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeClient(lambda: [{"allowed": False, "retry_after": 17}])
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)

    assert asyncio.run(SupabaseRateStore().consume(_principal(), 1)) == 17


def test_missing_retry_after_stays_fail_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient(lambda: [{"allowed": False}])
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)

    retry_after = asyncio.run(SupabaseRateStore().consume(_principal(), 1))

    assert retry_after is not None
    assert retry_after >= 1


def test_empty_or_malformed_rpc_payload_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    for payload in ([], [None], [{"retry_after": "later"}]):
        client = _FakeClient(lambda payload=payload: payload)
        monkeypatch.setattr("app.core.db.supabase_client", lambda client=client: client)
        with pytest.raises(RateStoreUnavailable):
            asyncio.run(SupabaseRateStore().consume(_principal(), 1))
        assert [name for name, _params in client.calls] == [RATE_WINDOW_RPC]


def test_rpc_exception_fails_closed_without_legacy_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _FakeClient(lambda: ConnectionError("database unavailable"))
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)

    with pytest.raises(RateStoreUnavailable):
        asyncio.run(SupabaseRateStore().consume(_principal(), 5))

    assert len(client.calls) == 1
    assert client.calls[0][0] == RATE_WINDOW_RPC


def test_live_development_window_limit_retry_and_shared_storage() -> None:
    client = _development_client()
    store = SupabaseRateStore()
    principal = _principal()

    invalid = client.rpc(RATE_WINDOW_RPC, {"p_principal": "not-a-principal", "p_limit": 1})
    with pytest.raises(Exception) as invalid_call:
        invalid.execute()
    assert "22023" in str(invalid_call.value) or "invalid rate principal" in str(invalid_call.value)

    retired = client.rpc(LEGACY_RPC, {"p_principal": "not-a-principal", "p_limit": 1})
    with pytest.raises(Exception) as retired_call:
        retired.execute()
    retired_text = str(retired_call.value)
    assert "PGRST202" in retired_text or "Could not find the function" in retired_text

    assert asyncio.run(store.consume(principal, 3)) is None
    assert asyncio.run(store.consume(principal, 3)) is None
    assert asyncio.run(store.consume(principal, 3)) is None
    denied = asyncio.run(store.consume(principal, 3))
    assert denied is not None
    assert denied >= 1


def test_live_development_concurrent_requests_share_one_window() -> None:
    _development_client()
    store = SupabaseRateStore()
    principal = _principal("api_key")

    async def burst() -> list[int | None]:
        return list(await asyncio.gather(*(store.consume(principal, 5) for _ in range(8))))

    results = asyncio.run(burst())
    allowed = [item for item in results if item is None]
    denied = [item for item in results if item is not None]
    assert len(allowed) == 5
    assert len(denied) == 3
    assert all(item >= 1 for item in denied)
