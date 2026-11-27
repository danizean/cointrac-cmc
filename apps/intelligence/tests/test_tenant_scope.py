from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from tests.test_services import Book, Caps, Scripted, common_handlers

from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    RateStoreUnavailable,
    current_mcp_auth,
    install_jwt_resolver,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.main import app
from app.services.evidence import MemoryEvidence
from app.services.intelligence import SectorBook, ServiceDeps, install_deps

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
KEY_A = "tenant-a-key-0001"
KEY_A_TWO = "tenant-a-key-0002"
KEY_B = "tenant-b-key-0001"
KEY_OPEN = "tenant-open-key-01"


class RecordingRateStore(MemoryRateStore):
    def __init__(self) -> None:
        super().__init__()
        self.principals: list[str] = []

    async def consume(self, principal_id: str, limit: int) -> int | None:
        self.principals.append(principal_id)
        return await super().consume(principal_id, limit)


class DownRateStore:
    async def consume(self, principal_id: str, limit: int) -> int | None:
        del principal_id, limit
        raise RateStoreUnavailable("down")


class EvidenceQuery:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.filters: list[tuple[str, str]] = []
        self.columns = "*"

    def select(self, columns: str) -> "EvidenceQuery":
        self.columns = columns
        return self

    def eq(self, key: str, value: str) -> "EvidenceQuery":
        self.filters.append((key, value))
        return self

    def order(self, *_args: object, **_kwargs: object) -> "EvidenceQuery":
        return self

    def limit(self, _count: int) -> "EvidenceQuery":
        return self

    def execute(self) -> object:
        matched = [
            row for row in self.rows if all(row.get(key) == value for key, value in self.filters)
        ]
        if self.columns != "*":
            names = [name.strip() for name in self.columns.split(",")]
            matched = [{name: row.get(name) for name in names} for row in matched]

        class Result:
            data = matched

        return Result()


class EvidenceClient:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.queries: list[EvidenceQuery] = []

    def table(self, name: str) -> EvidenceQuery:
        assert name == "evidence_records"
        query = EvidenceQuery(self.rows)
        self.queries.append(query)
        return query


def _client(records: list[ApiKeyRecord], store: RecordingRateStore | DownRateStore) -> TestClient:
    install_keys(MemoryKeyDirectory(records))
    install_rate_store(store)
    install_deps(
        ServiceDeps(
            gateway=Scripted(common_handlers()),
            evidence=MemoryEvidence(),
            assets=Book(),
            sectors=SectorBook(),
            capabilities=Caps(),
            now=lambda: datetime(2026, 11, 22, 15, tzinfo=UTC),
        )
    )
    return TestClient(app)


def _owned(key_id: str, raw_key: str, user_id: str | None, limit: int = 10) -> ApiKeyRecord:
    return ApiKeyRecord(
        key_id=key_id,
        key_hash=key_hash(raw_key),
        rate_limit_per_min=limit,
        is_active=True,
        user_id=user_id,
    )


def test_unscoped_and_revoked_keys_do_not_read_tenant_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = EvidenceClient(
        [
            {
                "evidence_id": "ev_tg521null",
                "user_id": None,
                "tool_name": "get_market_overview",
                "raw_excerpt": {"secret": "archive"},
            }
        ]
    )
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)
    store = RecordingRateStore()
    api = _client(
        [
            _owned("open", KEY_OPEN, None),
            ApiKeyRecord("dead", key_hash("revoked-key-00001"), 10, True, USER_A, True),
            ApiKeyRecord("off", key_hash("inactive-key-0001"), 10, False, USER_A, False),
        ],
        store,
    )
    try:
        unscoped = api.get("/v1/evidence", headers={"x-cointrac-key": KEY_OPEN})
        revoked = api.get("/v1/evidence", headers={"x-cointrac-key": "revoked-key-00001"})
        inactive = api.get("/v1/evidence", headers={"x-cointrac-key": "inactive-key-0001"})
        missing = api.get("/v1/evidence", headers={"x-user-id": USER_A})
    finally:
        install_deps(None)
    assert unscoped.status_code == 200
    assert unscoped.json()["records"] == []
    assert client.queries == []
    assert "archive" not in unscoped.text
    assert revoked.status_code == 401
    assert inactive.status_code == 401
    assert missing.status_code == 401
    assert store.principals == ["api_key:open"]


def test_evidence_list_and_detail_are_owner_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [
        {
            "evidence_id": "ev_tg521owna",
            "user_id": USER_A,
            "tool_name": "compare_assets",
            "raw_excerpt": {"owner": "a"},
            "methodology": {},
            "limitations": [],
            "credit_cost": 1,
        },
        {
            "evidence_id": "ev_tg521ownb",
            "user_id": USER_B,
            "tool_name": "compare_assets",
            "raw_excerpt": {"owner": "b"},
            "methodology": {},
            "limitations": [],
            "credit_cost": 1,
        },
    ]
    client = EvidenceClient(rows)
    monkeypatch.setattr("app.core.db.supabase_client", lambda: client)
    api = _client([_owned("a", KEY_A, USER_A), _owned("b", KEY_B, USER_B)], RecordingRateStore())
    try:
        listed = api.get(
            "/v1/evidence",
            headers={"x-cointrac-key": KEY_A, "x-user-id": USER_B, "x-tenant-id": USER_B},
        )
        own = api.get("/v1/evidence/ev_tg521owna", headers={"x-cointrac-key": KEY_A})
        other = api.get("/v1/evidence/ev_tg521ownb", headers={"x-cointrac-key": KEY_A})
        unknown = api.get("/v1/evidence/ev_tg521none", headers={"x-cointrac-key": KEY_A})
    finally:
        install_deps(None)
    assert [row["evidence_id"] for row in listed.json()["records"]] == ["ev_tg521owna"]
    assert "owner" not in listed.text
    assert own.json()["raw_excerpt"] == {"owner": "a"}
    assert other.status_code == 404
    assert unknown.status_code == 404
    assert other.json() == unknown.json()
    assert all(("user_id", USER_A) in query.filters for query in client.queries)


def test_telemetry_ignores_spoofed_owner_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    class LogQuery:
        def __init__(self, table_name: str) -> None:
            self.table_name = table_name
            self.filters: list[tuple[str, str]] = []

        def select(self, _columns: str) -> "LogQuery":
            return self

        def eq(self, key: str, value: str) -> "LogQuery":
            self.filters.append((key, value))
            return self

        def order(self, *_args: object, **_kwargs: object) -> "LogQuery":
            return self

        def limit(self, _count: int) -> "LogQuery":
            return self

        def execute(self) -> object:
            rows = (
                [{"surface": "rest", "cache_hit": True, "credit_cost": 2, "latency_ms": 10}]
                if self.table_name == "request_logs"
                else []
            )

            class Result:
                data = rows

            return Result()

    queries: list[LogQuery] = []

    class Client:
        def table(self, name: str) -> LogQuery:
            assert name in {"request_logs", "hg_scan_runs"}
            query = LogQuery(name)
            queries.append(query)
            return query

    monkeypatch.setattr("app.core.db.supabase_client", lambda: Client())
    api = _client(
        [_owned("a", KEY_A, USER_A), _owned("open", KEY_OPEN, None)], RecordingRateStore()
    )
    try:
        scoped = api.get(
            "/v1/telemetry/summary",
            headers={"x-cointrac-key": KEY_A, "x-user-id": USER_B, "x-tg-surface": "playground"},
        )
        empty = api.get(
            "/v1/telemetry/summary",
            headers={"x-cointrac-key": KEY_OPEN, "x-tenant-id": USER_A},
        )
    finally:
        install_deps(None)
    assert scoped.status_code == 200
    assert scoped.json()["calls_by_surface"]["rest"] == 1
    assert [q.table_name for q in queries] == ["request_logs", "hg_scan_runs"]
    assert all(q.filters == [("user_id", USER_A)] for q in queries)
    assert empty.json()["calls_by_surface"] == {"mcp": 0, "rest": 0, "playground": 0}
    assert empty.json()["cache_hit_rate_pct"] is None
    assert empty.json()["average_latency_ms"] is None
    assert len(queries) == 2


def test_two_keys_share_one_tenant_window_and_store_failure_is_closed() -> None:
    store = RecordingRateStore()
    api = _client(
        [_owned("a1", KEY_A, USER_A, 1), _owned("a2", KEY_A_TWO, USER_A, 60)],
        store,
    )
    try:
        first = api.get("/v1/intelligence/market-overview", headers={"x-cointrac-key": KEY_A})
        second = api.get(
            "/v1/intelligence/market-overview",
            headers={"x-cointrac-key": KEY_A_TWO, "x-user-id": USER_B},
        )
        install_rate_store(DownRateStore())
        failed = api.get("/v1/intelligence/market-overview", headers={"x-cointrac-key": KEY_A})
        missing = api.get("/v1/intelligence/market-overview")
    finally:
        install_deps(None)
    assert first.status_code == 200
    assert second.status_code == 429
    assert store.principals == [f"user:{USER_A}", f"user:{USER_A}"]
    assert failed.status_code == 503
    assert missing.status_code == 401


@pytest.mark.asyncio
async def test_mcp_evidence_resource_requires_the_authenticated_owner() -> None:
    from app.mcp.server import _query_evidence, _read_evidence

    token = current_mcp_auth.set(_owned("open", KEY_OPEN, None))
    try:
        denied = await _read_evidence("ev_tg521ownb")
    finally:
        current_mcp_auth.reset(token)
    assert denied["status"] == "INSUFFICIENT_DATA"
    assert "was not found" in str(denied["limitations"])

    client = EvidenceClient(
        [{"evidence_id": "ev_tg521owna", "user_id": USER_A, "raw_excerpt": {"owner": "a"}}]
    )
    with pytest.raises(ValueError, match="owner is required"):
        await _query_evidence(client, "ev_tg521owna", "")
    row = await _query_evidence(client, "ev_tg521owna", USER_A)
    assert row is not None
    assert "raw_excerpt" not in row
    assert client.queries[-1].filters == [
        ("evidence_id", "ev_tg521owna"),
        ("user_id", USER_A),
    ]


@pytest.mark.asyncio
async def test_verified_jwt_owns_the_rate_window(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(token: str) -> dict[str, str]:
        assert token == "aaa.bbb.ccc"
        return {"sub": USER_A}

    async def profile(_self: object, _user_id: str) -> dict[str, str]:
        return {"account_status": "active"}

    install_jwt_resolver(resolve)
    monkeypatch.setattr("app.api.jwt_auth.SupabaseProfileDirectory.get_profile", profile)
    store = RecordingRateStore()
    api = _client([_owned("a", KEY_A, USER_A, 60)], store)
    try:
        response = api.get(
            "/v1/intelligence/market-overview",
            headers={"authorization": "Bearer aaa.bbb.ccc", "x-user-id": USER_B},
        )
    finally:
        install_jwt_resolver(None)
        install_deps(None)
    assert response.status_code == 200
    assert store.principals == [f"user:{USER_A}"]
