"""Persistent OAuth grants.

SQLite is used only when the issuer host ends in ``.test``. A PostgreSQL URL
verifies that the private OAuth tables from migration 007 already exist and
never creates or alters tables at runtime.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any
from uuid import uuid4

from app.oauth.errors import OAuthConfigurationError, OAuthTransactionAmbiguousError
from app.oauth.runtime import (
    REFRESH_TTL_SECONDS,
    AuthorizationCode,
    AuthorizationRequest,
    OAuthClient,
    RefreshToken,
    hash_secret,
)

_OAUTH_TABLES = (
    "oauth_clients",
    "oauth_authorization_requests",
    "oauth_authorization_codes",
    "oauth_refresh_tokens",
    "oauth_access_denylist",
    "oauth_consents",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
    request_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    state TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_requests_expires_idx
    ON oauth_authorization_requests (expires_at);
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);
CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);
CREATE INDEX IF NOT EXISTS oauth_refresh_family_idx ON oauth_refresh_tokens (family_id);
CREATE TABLE IF NOT EXISTS oauth_access_denylist (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_consents (
    user_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, client_id, scope)
);
"""


def _import_psycopg() -> Any:
    try:
        import psycopg

        return psycopg
    except ImportError as exc:
        raise OAuthConfigurationError(
            "PostgreSQL OAuth storage requires psycopg v3 to be installed."
        ) from exc


class RelationalOAuthStore:
    def __init__(
        self,
        location: str,
        *,
        dialect: str,
        pg_connect: Any | None = None,
    ) -> None:
        self.location = location
        self.dialect = dialect
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None
        self._pg_conn: Any | None = None
        self._pg_connect = pg_connect

    def _table(self, name: str) -> str:
        return f"private.{name}" if self.dialect == "postgres" else name

    def _sql(self, query: str) -> str:
        if self.dialect == "postgres":
            return query.replace("?", "%s")
        return query

    def ensure_schema(self) -> None:
        if self.dialect != "sqlite":
            raise OAuthConfigurationError("Refusing to create OAuth tables on PostgreSQL.")
        with self._lock:
            self._sqlite_connection().executescript(_SCHEMA)

    def require_schema(self) -> None:
        if self.dialect != "postgres":
            raise OAuthConfigurationError("require_schema is only valid for PostgreSQL.")
        checks = ", ".join(f"to_regclass('private.{t}') IS NOT NULL" for t in _OAUTH_TABLES)
        try:
            with self._lock:
                conn = self._postgres_connection()
                row = conn.execute(f"SELECT {checks}").fetchone()
        except OAuthConfigurationError:
            raise
        except Exception as exc:
            self.close()
            raise OAuthConfigurationError(
                "PostgreSQL OAuth storage is unavailable. "
                "Verify OAUTH_DATABASE_URL and network connectivity."
            ) from exc
        if row is None or not all(bool(item) for item in row):
            self.close()
            raise OAuthConfigurationError(
                "PostgreSQL OAuth tables are missing. "
                "Apply supabase/migrations/007_mcp_oauth_grants.sql before enabling OAuth."
            )

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None
            if self._pg_conn is not None:
                try:
                    self._pg_conn.close()
                finally:
                    self._pg_conn = None

    def save_client(self, client: OAuthClient) -> None:
        table = self._table("oauth_clients")
        self._write(
            f"""
            INSERT INTO {table} (client_id, client_name, redirect_uris, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (client.client_id, client.client_name, json.dumps(client.redirect_uris), _now()),
        )

    def get_client(self, client_id: str) -> OAuthClient | None:
        table = self._table("oauth_clients")
        row = self._read_one(
            f"SELECT client_id, client_name, redirect_uris FROM {table} WHERE client_id = ?",
            (client_id,),
        )
        if row is None:
            return None
        return OAuthClient(str(row[0]), tuple(json.loads(str(row[2]))), str(row[1]))

    def save_request(self, request: AuthorizationRequest) -> None:
        table = self._table("oauth_authorization_requests")
        self._write(
            f"""
            INSERT INTO {table} (
                request_id, client_id, redirect_uri, code_challenge, state, scope,
                resource, csrf_token, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                request.request_id,
                request.client_id,
                request.redirect_uri,
                request.code_challenge,
                request.state,
                request.scope,
                request.resource,
                request.csrf_token,
                int(request.expires_at),
            ),
        )

    def get_pending(self, request_id: str) -> AuthorizationRequest | None:
        table = self._table("oauth_authorization_requests")
        row = self._read_one(
            f"""
            SELECT request_id, client_id, redirect_uri, code_challenge, state, scope,
                   resource, csrf_token, expires_at
            FROM {table}
            WHERE request_id = ? AND expires_at > ?
            """,
            (request_id, _now()),
        )
        if row is None:
            return None
        return _request_from_row(row)

    def pop_request(self, request_id: str) -> AuthorizationRequest | None:
        table = self._table("oauth_authorization_requests")
        now = _now()
        del_valid = self._sql(
            f"""
            DELETE FROM {table}
            WHERE request_id = ? AND expires_at > ?
            RETURNING request_id, client_id, redirect_uri, code_challenge, state,
                      scope, resource, csrf_token, expires_at
            """
        )
        del_expired = self._sql(f"DELETE FROM {table} WHERE request_id = ? AND expires_at <= ?")
        if self.dialect == "postgres":
            row = self._pg_tx(
                lambda conn: (
                    conn.execute(del_valid, (request_id, now)).fetchone(),
                    conn.execute(del_expired, (request_id, now)),
                )[0],
                idempotent=False,
            )
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    row = conn.execute(del_valid, (request_id, now)).fetchone()
                    conn.execute(del_expired, (request_id, now))
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
        if row is None:
            return None
        return _request_from_row(row)

    def save_code(self, code: AuthorizationCode) -> None:
        table = self._table("oauth_authorization_codes")
        self._write(
            f"""
            INSERT INTO {table} (
                code_hash, client_id, redirect_uri, code_challenge, user_id, scope,
                resource, expires_at, used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
            """,
            (
                code.code_hash,
                code.client_id,
                code.redirect_uri,
                code.code_challenge,
                code.user_id,
                code.scope,
                code.resource,
                int(code.expires_at),
            ),
        )

    def take_code(self, code_hash: str) -> AuthorizationCode | None:
        table = self._table("oauth_authorization_codes")
        now = _now()
        query = self._sql(
            f"""
            UPDATE {table}
            SET used_at = ?
            WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
            RETURNING code_hash, client_id, redirect_uri, code_challenge, user_id,
                      scope, resource, expires_at
            """
        )
        if self.dialect == "postgres":
            row = self._pg_tx(
                lambda conn: conn.execute(query, (now, code_hash, now)).fetchone(),
                idempotent=False,
            )
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    row = conn.execute(query, (now, code_hash, now)).fetchone()
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
        if row is None:
            return None
        return AuthorizationCode(
            code_hash=str(row[0]),
            client_id=str(row[1]),
            redirect_uri=str(row[2]),
            code_challenge=str(row[3]),
            user_id=str(row[4]),
            scope=str(row[5]),
            resource=str(row[6]),
            expires_at=float(row[7]),
            used=True,
        )

    def save_refresh(self, token: RefreshToken) -> None:
        table = self._table("oauth_refresh_tokens")
        insert_sql = self._sql(
            f"""
            INSERT INTO {table} (
                token_hash, family_id, client_id, user_id, scope, resource, expires_at, used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            """
        )
        params = (
            token.token_hash,
            token.family_id,
            token.client_id,
            token.user_id,
            token.scope,
            token.resource,
            int(token.expires_at),
        )
        if self.dialect == "postgres":
            self._pg_tx(lambda conn: conn.execute(insert_sql, params), idempotent=False)
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    conn.execute(insert_sql, params)
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

    def rotate_refresh(
        self,
        raw_token: str,
        *,
        expected_client_id: str | None = None,
    ) -> tuple[str, RefreshToken] | None:
        """Claim a refresh token and insert its replacement in one atomic transaction."""
        token_hash = hash_secret(raw_token)
        table = self._table("oauth_refresh_tokens")
        now = _now()
        claim_sql = (
            self._sql(
                f"""
                UPDATE {table}
                SET used_at = ?
                WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND client_id = ?
                RETURNING family_id, client_id, user_id, scope, resource
                """
            )
            if expected_client_id is not None
            else self._sql(
                f"""
                UPDATE {table}
                SET used_at = ?
                WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
                RETURNING family_id, client_id, user_id, scope, resource
                """
            )
        )
        claim_params: tuple[object, ...] = (
            (now, token_hash, now, expected_client_id)
            if expected_client_id is not None
            else (now, token_hash, now)
        )
        lookup_sql = self._sql(f"SELECT family_id, client_id FROM {table} WHERE token_hash = ?")
        revoke_sql = self._sql(
            f"UPDATE {table} SET used_at = COALESCE(used_at, ?), expires_at = 0 WHERE family_id = ?"
        )
        insert_sql = self._sql(
            f"""
            INSERT INTO {table} (
                token_hash, family_id, client_id, user_id, scope, resource, expires_at, used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
            """
        )

        def _execute(conn: Any) -> tuple[str, RefreshToken] | None:
            row = conn.execute(claim_sql, claim_params).fetchone()
            if row is None:
                found = conn.execute(lookup_sql, (token_hash,)).fetchone()
                if found is not None:
                    if expected_client_id is not None and str(found[1]) != expected_client_id:
                        return None
                    conn.execute(revoke_sql, (now, str(found[0])))
                return None
            raw, token = _new_refresh_row(
                family_id=str(row[0]),
                client_id=str(row[1]),
                user_id=str(row[2]),
                scope=str(row[3]),
                resource=str(row[4]),
            )
            conn.execute(
                insert_sql,
                (
                    token.token_hash,
                    token.family_id,
                    token.client_id,
                    token.user_id,
                    token.scope,
                    token.resource,
                    int(token.expires_at),
                ),
            )
            return raw, token

        if self.dialect == "postgres":
            return self._pg_tx(_execute)
        with self._lock:
            conn = self._sqlite_connection()
            conn.execute("BEGIN IMMEDIATE")
            try:
                result = _execute(conn)
                conn.commit()
                return result
            except Exception:
                conn.rollback()
                raise

    def revoke_refresh(self, raw_token: str) -> None:
        token_hash = hash_secret(raw_token)
        table = self._table("oauth_refresh_tokens")
        now = _now()
        lookup_sql = self._sql(f"SELECT family_id FROM {table} WHERE token_hash = ?")
        revoke_sql = self._sql(
            f"UPDATE {table} SET used_at = COALESCE(used_at, ?), expires_at = 0 WHERE family_id = ?"
        )
        if self.dialect == "postgres":

            def _revoke(conn: Any) -> None:
                found = conn.execute(lookup_sql, (token_hash,)).fetchone()
                if found is not None:
                    conn.execute(revoke_sql, (now, str(found[0])))

            self._pg_tx(_revoke, idempotent=True)
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    found = conn.execute(lookup_sql, (token_hash,)).fetchone()
                    if found is not None:
                        conn.execute(revoke_sql, (now, str(found[0])))
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

    def revoke_access(self, jti: str, expires_at: int) -> None:
        table = self._table("oauth_access_denylist")
        self._write(
            f"""
            INSERT INTO {table} (jti, expires_at) VALUES (?, ?)
            ON CONFLICT(jti) DO UPDATE SET expires_at = excluded.expires_at
            """,
            (jti, expires_at),
            idempotent=True,
        )

    def access_revoked(self, jti: str) -> bool:
        table = self._table("oauth_access_denylist")
        row = self._read_one(
            f"SELECT 1 FROM {table} WHERE jti = ? AND expires_at > ?",
            (jti, _now()),
        )
        return row is not None

    def save_consent(self, user_id: str, client_id: str, scope: str) -> None:
        table = self._table("oauth_consents")
        self._write(
            f"""
            INSERT INTO {table} (user_id, client_id, scope, approved_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, client_id, scope) DO UPDATE SET approved_at = excluded.approved_at
            """,
            (user_id, client_id, scope, _now()),
            idempotent=True,
        )

    def cleanup(self) -> None:
        now = _now()
        req_tbl = self._table("oauth_authorization_requests")
        code_tbl = self._table("oauth_authorization_codes")
        ref_tbl = self._table("oauth_refresh_tokens")
        deny_tbl = self._table("oauth_access_denylist")
        stmts = (
            self._sql(f"DELETE FROM {req_tbl} WHERE expires_at <= ?"),
            self._sql(f"DELETE FROM {code_tbl} WHERE expires_at <= ?"),
            self._sql(f"DELETE FROM {ref_tbl} WHERE expires_at <= ?"),
            self._sql(f"DELETE FROM {deny_tbl} WHERE expires_at <= ?"),
        )
        if self.dialect == "postgres":

            def _cleanup(conn: Any) -> None:
                for stmt in stmts:
                    conn.execute(stmt, (now,))

            self._pg_tx(_cleanup, idempotent=True)
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    for stmt in stmts:
                        conn.execute(stmt, (now,))
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

    def _sqlite_connection(self) -> sqlite3.Connection:
        if self.dialect != "sqlite":
            raise OAuthConfigurationError("SQLite connection requested for non-SQLite store.")
        if self._conn is None:
            conn = sqlite3.connect(
                self.location,
                check_same_thread=False,
                isolation_level=None,
                timeout=5,
            )
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=5000")
            self._conn = conn
        return self._conn

    def _postgres_connection(self) -> Any:
        if self.dialect != "postgres":
            raise OAuthConfigurationError("PostgreSQL connection requested for non-Postgres store.")
        if self._pg_conn is None or getattr(self._pg_conn, "closed", False):
            if self._pg_connect is not None:
                self._pg_conn = self._pg_connect(self.location)
            else:
                psycopg = _import_psycopg()
                self._pg_conn = psycopg.connect(self.location, autocommit=True, connect_timeout=5)
        return self._pg_conn

    def _reset_pg_conn(self) -> None:
        if self._pg_conn is not None:
            try:
                self._pg_conn.close()
            except Exception:
                pass
            finally:
                self._pg_conn = None

    def _pg_tx(self, fn: Any, *, idempotent: bool = False) -> Any:
        with self._lock:
            for attempt in range(2):
                conn = self._postgres_connection()
                tx = conn.transaction()
                phase = "begin"
                try:
                    tx.__enter__()
                    phase = "in_tx"
                    result = fn(conn)
                    phase = "commit"
                    tx.__exit__(None, None, None)
                    return result
                except BaseException as exc:
                    if phase == "in_tx":
                        try:
                            tx.__exit__(type(exc), exc, exc.__traceback__)
                        except Exception:
                            pass
                    if isinstance(exc, Exception) and _is_transient_pg_disconnect(exc):
                        self._reset_pg_conn()
                        if phase == "begin" and attempt == 0:
                            continue
                        if phase == "in_tx" and idempotent and attempt == 0:
                            continue
                        if phase == "commit" and not idempotent:
                            raise OAuthTransactionAmbiguousError(
                                "PostgreSQL connection lost during commit; "
                                "transaction outcome is unknown and requires reconciliation."
                            ) from exc
                        if phase == "commit" and idempotent and attempt == 0:
                            continue
                    raise

    def _write(self, sql: str, params: tuple[object, ...], *, idempotent: bool = False) -> None:
        compiled = self._sql(sql)
        if self.dialect == "postgres":
            self._pg_tx(lambda conn: conn.execute(compiled, params), idempotent=idempotent)
        else:
            with self._lock:
                conn = self._sqlite_connection()
                conn.execute("BEGIN IMMEDIATE")
                try:
                    conn.execute(compiled, params)
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

    def _read_one(self, sql: str, params: tuple[object, ...]) -> Any:
        compiled = self._sql(sql)
        if self.dialect == "postgres":
            with self._lock:
                for attempt in range(2):
                    conn = self._postgres_connection()
                    try:
                        return conn.execute(compiled, params).fetchone()
                    except Exception as exc:
                        if attempt == 0 and _is_transient_pg_disconnect(exc):
                            self._reset_pg_conn()
                            continue
                        raise
        with self._lock:
            return self._sqlite_connection().execute(compiled, params).fetchone()


def open_store(database_url: str, *, pg_connect: Any | None = None) -> RelationalOAuthStore:
    if database_url.startswith("sqlite:///"):
        store = RelationalOAuthStore(database_url.removeprefix("sqlite:///"), dialect="sqlite")
        store.ensure_schema()
        return store
    if database_url.startswith(("postgres://", "postgresql://")):
        store = RelationalOAuthStore(database_url, dialect="postgres", pg_connect=pg_connect)
        store.require_schema()
        return store
    raise OAuthConfigurationError(
        "OAUTH_DATABASE_URL must be a sqlite URL for .test issuers or a postgres URL."
    )


def _now() -> int:
    return int(time.time())


def _is_transient_pg_disconnect(exc: Exception) -> bool:
    name = exc.__class__.__name__
    return name in {"OperationalError", "InterfaceError"}


def _request_from_row(row: Any) -> AuthorizationRequest:
    return AuthorizationRequest(
        request_id=str(row[0]),
        client_id=str(row[1]),
        redirect_uri=str(row[2]),
        code_challenge=str(row[3]),
        state=str(row[4]),
        scope=str(row[5]),
        resource=str(row[6]),
        csrf_token=str(row[7]),
        expires_at=float(row[8]),
    )


def _new_refresh_row(
    *,
    family_id: str,
    client_id: str,
    user_id: str,
    scope: str,
    resource: str,
) -> tuple[str, RefreshToken]:
    import secrets

    raw = secrets.token_urlsafe(48)
    token = RefreshToken(
        token_hash=hash_secret(raw),
        family_id=family_id,
        client_id=client_id,
        user_id=user_id,
        scope=scope,
        resource=resource,
        expires_at=time.time() + REFRESH_TTL_SECONDS,
    )
    return raw, token


def new_family_id() -> str:
    return str(uuid4())
