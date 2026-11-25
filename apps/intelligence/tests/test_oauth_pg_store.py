"""Unit tests for the PostgreSQL OAuth store (private.oauth_* schema & psycopg3 contract)."""

from __future__ import annotations

import re
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.oauth.bootstrap import resolve_startup
from app.oauth.errors import OAuthConfigurationError, OAuthTransactionAmbiguousError
from app.oauth.runtime import (
    AuthorizationCode,
    AuthorizationRequest,
    OAuthClient,
    RefreshToken,
    SigningKey,
    hash_secret,
)
from app.oauth.store import _OAUTH_TABLES, RelationalOAuthStore, open_store

USER_ID = "11111111-1111-4111-8111-111111111111"
RESOURCE = "https://mcp.cointrac.xyz/mcp"
REDIRECT = "https://gemini.google.com/oauth/callback"

_TO_REGCLASS = re.compile(r"to_regclass\('private\.([a-z_]+)'\)\s+IS\s+NOT\s+NULL")


class _PgCursorProxy:
    def __init__(self, row: sqlite3.Row | None) -> None:
        self._row = row

    def fetchone(self) -> sqlite3.Row | None:
        return self._row


class _FakePsycopg3Connection:
    """Mimics psycopg3 connection + transaction() over an attached SQLite `private` schema."""

    def __init__(self, *, missing_table: str | None = None) -> None:
        self.closed = False
        self.queries: list[tuple[str, tuple[object, ...]]] = []
        self._conn = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("ATTACH DATABASE ':memory:' AS private")
        tables = {
            "oauth_clients": """
                CREATE TABLE private.oauth_clients (
                    client_id TEXT PRIMARY KEY,
                    client_name TEXT NOT NULL,
                    redirect_uris TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                )
            """,
            "oauth_authorization_requests": """
                CREATE TABLE private.oauth_authorization_requests (
                    request_id TEXT PRIMARY KEY,
                    client_id TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    code_challenge TEXT NOT NULL,
                    state TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    csrf_token TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                )
            """,
            "oauth_authorization_codes": """
                CREATE TABLE private.oauth_authorization_codes (
                    code_hash TEXT PRIMARY KEY,
                    client_id TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    code_challenge TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    used_at INTEGER
                )
            """,
            "oauth_refresh_tokens": """
                CREATE TABLE private.oauth_refresh_tokens (
                    token_hash TEXT PRIMARY KEY,
                    family_id TEXT NOT NULL,
                    client_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    expires_at INTEGER NOT NULL,
                    used_at INTEGER
                )
            """,
            "oauth_access_denylist": """
                CREATE TABLE private.oauth_access_denylist (
                    jti TEXT PRIMARY KEY,
                    expires_at INTEGER NOT NULL
                )
            """,
            "oauth_consents": """
                CREATE TABLE private.oauth_consents (
                    user_id TEXT NOT NULL,
                    client_id TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    approved_at INTEGER NOT NULL,
                    PRIMARY KEY (user_id, client_id, scope)
                )
            """,
        }
        for name, ddl in tables.items():
            if name != missing_table:
                self._conn.execute(ddl)

    @contextmanager
    def transaction(self):
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> _PgCursorProxy:
        self.queries.append((sql, params))
        if "to_regclass" in sql:
            names = _TO_REGCLASS.findall(sql)
            existing = {
                row[0]
                for row in self._conn.execute(
                    "SELECT name FROM private.sqlite_master WHERE type='table'"
                ).fetchall()
            }
            return _PgCursorProxy(tuple(name in existing for name in names))  # type: ignore[arg-type]
        translated = sql.replace("%s", "?")
        row = self._conn.execute(translated, params).fetchone()
        return _PgCursorProxy(row)

    def close(self) -> None:
        self.closed = True
        self._conn.close()


def test_postgres_store_refuses_ensure_schema() -> None:
    store = RelationalOAuthStore(
        "postgresql://user:secret@db.internal:5432/postgres",
        dialect="postgres",
        pg_connect=lambda _dsn: _FakePsycopg3Connection(),
    )
    with pytest.raises(OAuthConfigurationError, match="Refusing to create OAuth tables"):
        store.ensure_schema()


def test_postgres_store_requires_all_migration_007_tables() -> None:
    for missing in _OAUTH_TABLES:
        with pytest.raises(OAuthConfigurationError, match="007_mcp_oauth_grants.sql"):
            open_store(
                "postgresql://user:secret@db.internal:5432/postgres",
                pg_connect=lambda _dsn, m=missing: _FakePsycopg3Connection(missing_table=m),
            )


def test_postgres_store_unreachable_error_never_leaks_dsn() -> None:
    secret_dsn = "postgresql://postgres:super-secret-password@127.0.0.1:59999/cointrac"

    def _fail(_dsn: str):
        raise RuntimeError(f"failed connecting to {secret_dsn}")

    with pytest.raises(OAuthConfigurationError) as exc_info:
        open_store(secret_dsn, pg_connect=_fail)
    assert "super-secret-password" not in str(exc_info.value)
    assert "PostgreSQL OAuth storage is unavailable" in str(exc_info.value)


def test_postgres_store_crud_atomic_code_refresh_replay_and_cleanup() -> None:
    fake = _FakePsycopg3Connection()
    store = open_store(
        "postgresql://postgres:pass@127.0.0.1:5432/cointrac",
        pg_connect=lambda _dsn: fake,
    )
    try:
        client = OAuthClient("client-pg", (REDIRECT,), "Gemini MCP")
        store.save_client(client)
        loaded_client = store.get_client("client-pg")
        assert loaded_client == client

        req = AuthorizationRequest(
            request_id="req-pg-1",
            client_id="client-pg",
            redirect_uri=REDIRECT,
            code_challenge="a" * 43,
            state="state-pg-1",
            scope="mcp:tools",
            resource=RESOURCE,
            csrf_token="csrf-pg-1",
            expires_at=time.time() + 300,
        )
        store.save_request(req)
        assert store.get_pending("req-pg-1") is not None
        popped = store.pop_request("req-pg-1")
        assert popped is not None and popped.request_id == "req-pg-1"
        assert store.pop_request("req-pg-1") is None

        raw_code = "raw-auth-code-pg"
        code = AuthorizationCode(
            code_hash=hash_secret(raw_code),
            client_id="client-pg",
            redirect_uri=REDIRECT,
            code_challenge="a" * 43,
            user_id=USER_ID,
            scope="mcp:tools",
            resource=RESOURCE,
            expires_at=time.time() + 60,
        )
        store.save_code(code)
        taken = store.take_code(hash_secret(raw_code))
        assert taken is not None and taken.user_id == USER_ID and taken.used is True
        # Single-use enforced
        assert store.take_code(hash_secret(raw_code)) is None

        # Refresh token rotation + replay detection revokes entire family
        raw_refresh = "raw-refresh-pg-1"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(raw_refresh),
                family_id="11111111-1111-4111-8111-111111111112",
                client_id="client-pg",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )
        rotated = store.rotate_refresh(raw_refresh)
        assert rotated is not None
        next_refresh, _token_row = rotated
        assert next_refresh != raw_refresh
        # Replay of old refresh token returns None AND revokes next_refresh in same family
        assert store.rotate_refresh(raw_refresh) is None
        assert store.rotate_refresh(next_refresh) is None

        # Cross-client refresh attempt is rejected WITHOUT revoking Client A's family
        cross_raw = "raw-refresh-cross-client"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(cross_raw),
                family_id="11111111-1111-4111-8111-111111111113",
                client_id="client-pg",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )
        assert store.rotate_refresh(cross_raw, expected_client_id="other-client") is None
        # Client A can still refresh normally
        rotated_ok = store.rotate_refresh(cross_raw, expected_client_id="client-pg")
        assert rotated_ok is not None
        next_cross, _ = rotated_ok
        # Replaying the genuinely used token still revokes the entire family
        assert store.rotate_refresh(cross_raw, expected_client_id="client-pg") is None
        assert store.rotate_refresh(next_cross, expected_client_id="client-pg") is None

        # Denylist & consent
        store.revoke_access("jti-pg-1", int(time.time()) + 300)
        assert store.access_revoked("jti-pg-1") is True
        assert store.access_revoked("jti-pg-unknown") is False
        store.save_consent(USER_ID, "client-pg", "mcp:tools")

        # Cleanup runs cleanly across all private.oauth_* tables
        store.cleanup()

        # Verify all queries targeted private.oauth_* and used %s placeholders
        non_init_queries = [sql for sql, _ in fake.queries if "to_regclass" not in sql]
        assert non_init_queries
        assert all("private.oauth_" in sql for sql in non_init_queries)
        assert all("?" not in sql for sql in non_init_queries)
    finally:
        store.close()


def test_production_issuer_rejects_sqlite_and_accepts_postgres(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    key = SigningKey.generate()
    pem = tmp_path / "oauth-test.pem"
    pem.write_text(key.private_pem, encoding="utf-8")

    monkeypatch.setenv("OAUTH_ISSUER", "https://api.cointrac.xyz")
    monkeypatch.setenv("OAUTH_RESOURCE", "https://mcp.cointrac.xyz/mcp")
    monkeypatch.setenv("OAUTH_SIGNING_KID", "cointrac-mcp-1")
    monkeypatch.setenv("OAUTH_SIGNING_KEY_PATH", str(pem))
    monkeypatch.setenv("OAUTH_DATABASE_URL", f"sqlite:///{(tmp_path / 'prod.db').as_posix()}")
    get_settings.cache_clear()
    try:
        with pytest.raises(OAuthConfigurationError, match="SQLite OAuth storage is only allowed"):
            resolve_startup(get_settings())

        monkeypatch.setenv(
            "OAUTH_DATABASE_URL",
            "postgresql://postgres:secret@127.0.0.1:5432/postgres",
        )
        get_settings.cache_clear()
        startup = resolve_startup(get_settings())
        assert startup is not None
        assert startup.database_url.startswith("postgresql://")
    finally:
        for var in (
            "OAUTH_ISSUER",
            "OAUTH_RESOURCE",
            "OAUTH_SIGNING_KID",
            "OAUTH_SIGNING_KEY_PATH",
            "OAUTH_DATABASE_URL",
        ):
            monkeypatch.delenv(var, raising=False)
        get_settings.cache_clear()


def test_disposable_postgres_guards_refuse_hosted_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests import test_postgres_budget_integration as budget_mod
    from tests import test_postgres_oauth_integration as oauth_mod

    hosted = "postgresql://postgres@fflwfpmbyykyxhlhikwc.supabase.co/postgres"
    monkeypatch.setattr(oauth_mod, "DSN", hosted)
    monkeypatch.setattr(budget_mod, "DSN", hosted)
    with pytest.raises(BaseException, match="hosted Supabase"):
        oauth_mod._require_disposable_dsn()
    with pytest.raises(BaseException, match="hosted Supabase"):
        budget_mod._require_disposable_dsn()


class _OperationalError(Exception):
    pass


_OperationalError.__name__ = "OperationalError"


class _FaultySharedDbConnection:
    """Psycopg3-like wrapper over a shared SQLite connection with injectable disconnect faults."""

    def __init__(self, shared_sqlite: sqlite3.Connection, fault_mode: str | None = None) -> None:
        self._conn = shared_sqlite
        self.fault_mode = fault_mode
        self.closed = False

    @contextmanager
    def transaction(self):
        if self.fault_mode == "disconnect_before_tx":
            self.fault_mode = None
            raise _OperationalError("connection closed before BEGIN")
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            yield
            if self.fault_mode == "commit_succeeds_response_lost":
                self._conn.execute("COMMIT")
                self.fault_mode = None
                raise _OperationalError("socket dropped after COMMIT")
            self._conn.execute("COMMIT")
        except Exception:
            if self._conn.in_transaction:
                self._conn.execute("ROLLBACK")
            raise

    def execute(self, sql: str, params: tuple[object, ...] = ()) -> _PgCursorProxy:
        if "to_regclass" in sql:
            names = _TO_REGCLASS.findall(sql)
            existing = {
                row[0]
                for row in self._conn.execute(
                    "SELECT name FROM private.sqlite_master WHERE type='table'"
                ).fetchall()
            }
            return _PgCursorProxy(tuple(name in existing for name in names))  # type: ignore[arg-type]
        if self.fault_mode == "disconnect_in_tx" and "UPDATE" in sql:
            self.fault_mode = None
            raise _OperationalError("connection lost mid-transaction")
        translated = sql.replace("%s", "?")
        row = self._conn.execute(translated, params).fetchone()
        return _PgCursorProxy(row)

    def close(self) -> None:
        self.closed = True


def _shared_fault_store(fault_modes: list[str | None]) -> tuple[RelationalOAuthStore, list[int]]:
    base = _FakePsycopg3Connection()
    connect_calls: list[int] = []

    def _connect(_dsn: str) -> _FaultySharedDbConnection:
        idx = len(connect_calls)
        connect_calls.append(idx)
        mode = fault_modes[idx] if idx < len(fault_modes) else None
        return _FaultySharedDbConnection(base._conn, fault_mode=mode)

    store = open_store(
        "postgresql://postgres:pass@127.0.0.1:5432/cointrac",
        pg_connect=_connect,
    )
    return store, connect_calls


def test_pg_disconnect_before_tx_reconnects_and_rotates_cleanly() -> None:
    store, connect_calls = _shared_fault_store([None, "disconnect_before_tx", None])
    try:
        raw = "raw-before-tx"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(raw),
                family_id="11111111-1111-4111-8111-111111111120",
                client_id="client-a",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )
        # Force next call to hit fault_mode="disconnect_before_tx"
        store._reset_pg_conn()
        rotated = store.rotate_refresh(raw, expected_client_id="client-a")
        assert rotated is not None
        assert len(connect_calls) == 3
    finally:
        store.close()


def test_pg_disconnect_in_tx_fails_closed_without_retry_or_family_revocation() -> None:
    store, connect_calls = _shared_fault_store([None, "disconnect_in_tx", None])
    try:
        raw = "raw-in-tx"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(raw),
                family_id="11111111-1111-4111-8111-111111111121",
                client_id="client-a",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )
        store._reset_pg_conn()
        with pytest.raises(_OperationalError):
            store.rotate_refresh(raw, expected_client_id="client-a")
        # Reconnects on next call and token family is still intact
        rotated = store.rotate_refresh(raw, expected_client_id="client-a")
        assert rotated is not None
        assert len(connect_calls) == 3
    finally:
        store.close()


def test_pg_ambiguous_commit_does_not_retry_or_falsely_revoke_family() -> None:
    store, connect_calls = _shared_fault_store([None, "commit_succeeds_response_lost", None])
    try:
        raw = "raw-ambiguous-commit"
        family_id = "11111111-1111-4111-8111-111111111122"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(raw),
                family_id=family_id,
                client_id="client-a",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )
        store._reset_pg_conn()
        with pytest.raises(OAuthTransactionAmbiguousError, match="requires reconciliation"):
            store.rotate_refresh(raw, expected_client_id="client-a")

        # Verify commit DID happen on server and retry did NOT run & revoke the replacement token!
        assert len(connect_calls) == 2
        conn = store._postgres_connection()
        rows = conn._conn.execute(
            "SELECT token_hash, used_at, expires_at "
            "FROM private.oauth_refresh_tokens WHERE family_id = ?",
            (family_id,),
        ).fetchall()
        assert len(rows) == 2
        active_rows = [r for r in rows if r["used_at"] is None and r["expires_at"] > 0]
        assert len(active_rows) == 1
        assert len(connect_calls) == 3
    finally:
        store.close()
