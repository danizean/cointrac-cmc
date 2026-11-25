"""Disposable PostgreSQL 16 integration tests for MCP OAuth (Migration 007).

These tests are skipped unless COINTRAC_TEST_DATABASE_URL is set to a local,
disposable PostgreSQL 16 database. Hosted Supabase DSNs are explicitly refused.

Example local run:
    createdb cointrac_oauth_test
    set COINTRAC_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/cointrac_oauth_test
    .venv\\Scripts\\python.exe -m pytest -v tests/test_postgres_oauth_integration.py
"""

from __future__ import annotations

import base64
import hashlib
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from mcp.client.streamable_http import streamable_http_client
from tests.test_mcp import research_deps

from app.api.deps import (
    MemoryKeyDirectory,
    MemoryRateStore,
    install_jwt_resolver,
    install_keys,
    install_rate_store,
)
from app.core.config import get_settings
from app.main import create_app
from app.mcp.server import set_evidence_writer, set_service_deps
from app.oauth.bootstrap import install_from_settings
from app.oauth.consent import install_consent_authenticator
from app.oauth.identity import install_account_status
from app.oauth.runtime import (
    AuthorizationCode,
    OAuthClient,
    RefreshToken,
    SigningKey,
    hash_secret,
    pkce_s256,
)
from app.oauth.store import open_store
from mcp import ClientSession

ROOT = Path(__file__).resolve().parents[3]
MIGRATION_007 = ROOT / "supabase" / "migrations" / "007_mcp_oauth_grants.sql"
DSN = os.environ.get("COINTRAC_TEST_DATABASE_URL", "").strip()
_FORBIDDEN = ("supabase.co", "fflwfpmbyykyxhlhikwc", "udprwjbmrfknulngsjid")

USER_ID = "11111111-1111-4111-8111-111111111111"
ISSUER = "https://api.cointrac.test"
RESOURCE = "https://mcp.cointrac.test/mcp"
REDIRECT = "https://gemini.google.com/oauth/callback"

pytestmark = pytest.mark.skipif(
    not DSN,
    reason="COINTRAC_TEST_DATABASE_URL is not set; disposable Postgres 16 was not run",
)


def _require_disposable_dsn() -> str:
    lowered = DSN.lower()
    if any(token in lowered for token in _FORBIDDEN):
        pytest.fail("COINTRAC_TEST_DATABASE_URL points at a hosted Supabase database")
    return DSN


def _verifier() -> str:
    digest = hashlib.sha256(b"cointrac-pg-pkce").digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


@pytest.fixture(scope="module")
def pg_oauth_dsn():
    psycopg = pytest.importorskip("psycopg")
    dsn = _require_disposable_dsn()
    conn = psycopg.connect(dsn, autocommit=True)
    conn.execute("CREATE SCHEMA IF NOT EXISTS private")
    conn.execute(
        """
        DO $$ BEGIN
            CREATE ROLE anon NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        DO $$ BEGIN
            CREATE ROLE authenticated NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        DO $$ BEGIN
            CREATE ROLE service_role NOLOGIN BYPASSRLS;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
        """
    )
    conn.execute(MIGRATION_007.read_text(encoding="utf-8"))
    try:
        yield dsn
    finally:
        for tbl in (
            "oauth_consents",
            "oauth_access_denylist",
            "oauth_refresh_tokens",
            "oauth_authorization_codes",
            "oauth_authorization_requests",
            "oauth_clients",
        ):
            conn.execute(f"DROP TABLE IF EXISTS private.{tbl} CASCADE")
        conn.close()


def test_pg_concurrent_single_use_code_and_refresh_rotation(pg_oauth_dsn: str) -> None:
    store = open_store(pg_oauth_dsn)
    try:
        store.save_client(OAuthClient("pg-client-1", (REDIRECT,), "PG Concurrent"))
        raw_code = f"pg-code-{uuid4().hex}"
        code_hash = hash_secret(raw_code)
        store.save_code(
            AuthorizationCode(
                code_hash=code_hash,
                client_id="pg-client-1",
                redirect_uri=REDIRECT,
                code_challenge="b" * 43,
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 60,
            )
        )

        def take_once(_idx: int):
            s = open_store(pg_oauth_dsn)
            try:
                return s.take_code(code_hash)
            finally:
                s.close()

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(take_once, range(4)))
        assert sum(1 for r in results if r is not None) == 1

        raw_refresh = f"pg-refresh-{uuid4().hex}"
        store.save_refresh(
            RefreshToken(
                token_hash=hash_secret(raw_refresh),
                family_id=str(uuid4()),
                client_id="pg-client-1",
                user_id=USER_ID,
                scope="mcp:tools",
                resource=RESOURCE,
                expires_at=time.time() + 3600,
            )
        )

        def rotate_once(_idx: int):
            s = open_store(pg_oauth_dsn)
            try:
                return s.rotate_refresh(raw_refresh)
            finally:
                s.close()

        with ThreadPoolExecutor(max_workers=4) as pool:
            rotations = list(pool.map(rotate_once, range(4)))
        winners = [r for r in rotations if r is not None]
        assert len(winners) == 1
        # Subsequent replay revokes the family
        assert store.rotate_refresh(winners[0][0]) is None
    finally:
        store.close()


async def test_pg_full_oauth_and_mcp_tool_call(
    pg_oauth_dsn: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = SigningKey.generate()
    directory = Path(tempfile.gettempdir()) / "cointrac-oauth-pg-tests"
    directory.mkdir(exist_ok=True)
    pem_path = directory / "cointrac-mcp-pg.pem"
    pem_path.write_text(key.private_pem, encoding="utf-8")

    monkeypatch.setenv("OAUTH_ISSUER", ISSUER)
    monkeypatch.setenv("OAUTH_RESOURCE", RESOURCE)
    monkeypatch.setenv("OAUTH_SIGNING_KID", "cointrac-mcp-pg")
    monkeypatch.setenv("OAUTH_SIGNING_KEY_PATH", str(pem_path))
    monkeypatch.setenv("OAUTH_DATABASE_URL", pg_oauth_dsn)
    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    get_settings.cache_clear()

    async def _claims(_token: str) -> dict[str, str]:
        return {"sub": USER_ID}

    async def _active(_uid: str) -> str:
        return "active"

    async def _login(_email: str, _password: str) -> str:
        return "pg-session"

    install_jwt_resolver(_claims)
    install_account_status(_active)
    install_consent_authenticator(_login)
    install_keys(MemoryKeyDirectory([]))
    install_rate_store(MemoryRateStore())
    deps, logs = research_deps()
    set_service_deps(deps)
    set_evidence_writer(logs)

    app = create_app()
    transport = httpx.ASGITransport(app=app)
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
            ) as client:
                reg = await client.post(
                    "/oauth/register",
                    json={"client_name": "Gemini PG", "redirect_uris": [REDIRECT]},
                )
                assert reg.status_code == 201
                cid = reg.json()["client_id"]
                auth = await client.get(
                    "/oauth/authorize",
                    params={
                        "client_id": cid,
                        "redirect_uri": REDIRECT,
                        "code_challenge": pkce_s256(_verifier()),
                        "code_challenge_method": "S256",
                        "state": "pg-state-1234",
                        "resource": RESOURCE,
                    },
                    follow_redirects=False,
                )
                assert auth.status_code == 302
                req_id = auth.headers["location"].split("request_id=")[1]
                csrf = client.cookies["cointrac_oauth_csrf"]
                await client.post(
                    "/oauth/consent/session",
                    data={
                        "request_id": req_id,
                        "csrf": csrf,
                        "email": "user@example.test",
                        "password": "secret",
                    },
                )
                approved = await client.post(
                    "/oauth/consent/decision",
                    data={"request_id": req_id, "csrf": csrf, "approve": "yes"},
                    follow_redirects=False,
                )
                code = approved.headers["location"].split("code=")[1].split("&")[0]
                token = await client.post(
                    "/oauth/token",
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "code_verifier": _verifier(),
                        "client_id": cid,
                        "redirect_uri": REDIRECT,
                    },
                )
                assert token.status_code == 200
                access_token = token.json()["access_token"]

                async with httpx.AsyncClient(
                    transport=transport,
                    base_url="http://127.0.0.1:8000",
                    headers={"Authorization": f"Bearer {access_token}"},
                ) as mcp_http:
                    async with streamable_http_client(
                        "http://127.0.0.1:8000/mcp",
                        http_client=mcp_http,
                    ) as (read, write):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            listed = await session.list_tools()
                            assert "get_market_overview" in {t.name for t in listed.tools}
                            res = await session.call_tool("get_market_overview", {})
                            assert res.is_error is False
    finally:
        install_jwt_resolver(None)
        install_account_status(None)
        install_consent_authenticator(None)
        set_service_deps(None)
        set_evidence_writer(None)
        get_settings.cache_clear()
        install_from_settings(get_settings())
