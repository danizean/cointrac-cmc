"""OAuth startup, persistent grants, browser consent, and MCP authorization."""

from __future__ import annotations

import base64
import hashlib
import tempfile
import threading
import time
from pathlib import Path

import httpx
import jwt
import pytest
from mcp.client.streamable_http import streamable_http_client
from tests.test_mcp import research_deps

from app.api.deps import (
    ApiKeyRecord,
    MemoryKeyDirectory,
    MemoryRateStore,
    SupabaseKeyDirectory,
    SupabaseRateStore,
    install_jwt_resolver,
    install_keys,
    install_rate_store,
    key_hash,
)
from app.core.config import get_settings
from app.main import create_app
from app.mcp.server import set_evidence_writer, set_service_deps
from app.oauth.bootstrap import install_from_settings
from app.oauth.consent import install_consent_authenticator
from app.oauth.errors import OAuthConfigurationError
from app.oauth.identity import install_account_status
from app.oauth.runtime import (
    OAuthClient,
    RefreshToken,
    SigningKey,
    get_oauth_runtime,
    hash_secret,
    new_refresh,
    pkce_s256,
)
from app.oauth.store import open_store
from mcp import ClientSession

USER_ID = "11111111-1111-4111-8111-111111111111"
OTHER_USER = "22222222-2222-4222-8222-222222222222"
ISSUER = "https://issuer.test"
RESOURCE = "https://mcp.test/mcp"
REDIRECT = "http://127.0.0.1:9/callback"


async def _claims(_token: str) -> dict[str, str]:
    return {"sub": USER_ID}


async def _active(_user_id: str) -> str:
    return "active"


async def _login(_email: str, _password: str) -> str:
    return "session-token"


def _verifier() -> str:
    digest = hashlib.sha256(b"cointrac-pkce").digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _pem_file(kid: str) -> tuple[Path, SigningKey]:
    key = SigningKey.generate()
    key.kid = kid
    key.public_jwk = {**key.public_jwk, "kid": kid}
    directory = Path(tempfile.gettempdir()) / "cointrac-oauth-tests"
    directory.mkdir(exist_ok=True)
    path = directory / f"{kid}.pem"
    path.write_text(key.private_pem, encoding="utf-8")
    return path, key


def _enable(
    monkeypatch: pytest.MonkeyPatch,
    database: Path,
    kid: str = "cointrac-mcp-1",
) -> SigningKey:
    path, key = _pem_file(kid)
    monkeypatch.setenv("OAUTH_ISSUER", ISSUER)
    monkeypatch.setenv("OAUTH_RESOURCE", RESOURCE)
    monkeypatch.setenv("OAUTH_SIGNING_KID", kid)
    monkeypatch.setenv("OAUTH_SIGNING_KEY_PATH", str(path))
    monkeypatch.setenv("OAUTH_DATABASE_URL", f"sqlite:///{database.as_posix()}")
    monkeypatch.setenv("MCP_STATELESS_HTTP", "true")
    get_settings.cache_clear()
    return key


def _restore() -> None:
    import app.api.deps as deps

    install_jwt_resolver(None)
    install_account_status(None)
    install_consent_authenticator(None)
    deps._directory = SupabaseKeyDirectory()
    deps._rate_store = SupabaseRateStore()
    set_service_deps(None)
    set_evidence_writer(None)
    get_settings.cache_clear()
    install_from_settings(get_settings())


class RecordingRate(MemoryRateStore):
    def __init__(self) -> None:
        super().__init__()
        self.principals: list[str] = []

    async def consume(self, principal_id: str, limit: int) -> int | None:
        self.principals.append(principal_id)
        if len(self.principals) > 2:
            return 1
        return await super().consume(principal_id, limit)


async def _consent_and_token(client: httpx.AsyncClient) -> dict[str, object]:
    registered = await client.post(
        "/oauth/register",
        json={"client_name": "Browser MCP", "redirect_uris": [REDIRECT]},
    )
    assert registered.status_code == 201
    client_id = registered.json()["client_id"]
    started = await client.get(
        "/oauth/authorize",
        params={
            "client_id": client_id,
            "redirect_uri": REDIRECT,
            "code_challenge": pkce_s256(_verifier()),
            "code_challenge_method": "S256",
            "state": "state-value",
            "scope": "mcp:tools",
            "resource": RESOURCE,
        },
        follow_redirects=False,
    )
    assert started.status_code == 302
    request_id = started.headers["location"].split("request_id=")[1]
    csrf = client.cookies.get("cointrac_oauth_csrf")
    assert csrf
    page = await client.get("/oauth/consent", params={"request_id": request_id})
    assert page.status_code == 200
    assert "Sign in" in page.text
    signed = await client.post(
        "/oauth/consent/session",
        data={
            "request_id": request_id,
            "csrf": csrf,
            "email": "user@example.test",
            "password": "secret",
        },
        follow_redirects=True,
    )
    assert signed.status_code == 200
    assert USER_ID in signed.text
    decision = await client.post(
        "/oauth/consent/decision",
        data={
            "request_id": request_id,
            "csrf": csrf,
            "approve": "yes",
            "user_id": OTHER_USER,
        },
        follow_redirects=False,
    )
    assert decision.status_code == 302
    location = decision.headers["location"]
    assert location.startswith(REDIRECT)
    assert "state=state-value" in location
    code = location.split("code=")[1].split("&")[0]
    issued = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": _verifier(),
            "client_id": client_id,
            "redirect_uri": REDIRECT,
        },
    )
    assert issued.status_code == 200
    read_back = await client.get(f"/oauth/register/{client_id}")
    assert read_back.status_code == 200
    return issued.json()


@pytest.fixture
def oauth_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    key = _enable(monkeypatch, tmp_path / "oauth.db")
    install_jwt_resolver(_claims)
    install_account_status(_active)
    install_consent_authenticator(_login)
    install_keys(MemoryKeyDirectory([]))
    app = create_app()
    try:
        yield app, key
    finally:
        _restore()


def test_incomplete_oauth_configuration_refuses_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OAUTH_ISSUER", ISSUER)
    get_settings.cache_clear()
    try:
        with pytest.raises(OAuthConfigurationError, match="Missing: OAUTH_RESOURCE"):
            create_app()
    finally:
        monkeypatch.delenv("OAUTH_ISSUER", raising=False)
        get_settings.cache_clear()
        _restore()


async def test_disabled_oauth_does_not_advertise_metadata() -> None:
    get_settings.cache_clear()
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://127.0.0.1:8000",
    ) as client:
        response = await client.get("/.well-known/oauth-authorization-server")
    assert response.status_code == 404
    _restore()


def test_sqlite_grants_survive_restart_and_refresh_reuse(tmp_path: Path) -> None:
    url = f"sqlite:///{(tmp_path / 'grants.db').as_posix()}"
    first = open_store(url)
    first.save_client(OAuthClient("client-1", (REDIRECT,), "Persisted"))
    raw, token = new_refresh(
        client_id="client-1",
        user_id=USER_ID,
        scope="mcp:tools",
        resource=RESOURCE,
        family_id="family-1",
    )
    first.save_refresh(token)
    first.close()
    second = open_store(url)
    assert second.get_client("client-1") is not None
    rotated = second.rotate_refresh(raw)
    assert rotated is not None
    replacement, _current = rotated
    assert second.rotate_refresh(raw) is None
    assert second.rotate_refresh(replacement) is None
    second.close()


def test_two_connections_serialize_refresh_rotation(tmp_path: Path) -> None:
    url = f"sqlite:///{(tmp_path / 'shared.db').as_posix()}"
    left = open_store(url)
    right = open_store(url)
    raw = "refresh-token-raw-value"
    left.save_refresh(
        RefreshToken(
            token_hash=hash_secret(raw),
            family_id="family-shared",
            client_id="client-1",
            user_id=USER_ID,
            scope="mcp:tools",
            resource=RESOURCE,
            expires_at=time.time() + 3600,
        )
    )
    results: list[object] = []

    def rotate(store: object) -> None:
        results.append(store.rotate_refresh(raw))

    threads = [
        threading.Thread(target=rotate, args=(left,)),
        threading.Thread(target=rotate, args=(right,)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    winners = [item for item in results if item is not None]
    assert len(winners) == 1
    winner_raw = winners[0][0]
    assert left.rotate_refresh(winner_raw) is None
    left.close()
    right.close()


async def test_browser_consent_pkce_and_rejection_paths(oauth_app) -> None:
    app, key = oauth_app
    del key
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://127.0.0.1:8000",
    ) as client:
        metadata = await client.get("/.well-known/oauth-authorization-server")
        assert metadata.status_code == 200
        assert metadata.json()["issuer"] == ISSUER
        oidc = await client.get("/.well-known/openid-configuration")
        assert oidc.status_code == 200
        assert oidc.json()["issuer"] == ISSUER
        resource = await client.get("/.well-known/oauth-protected-resource/mcp")
        assert resource.json()["resource"] == RESOURCE
        assert resource.json()["authorization_servers"] == [ISSUER]
        body = await _consent_and_token(client)
        registered = await client.post(
            "/oauth/register",
            json={"redirect_uris": ["http://evil.example/callback"]},
        )
        assert registered.status_code == 400
        denied = await client.post("/mcp", json={})
        assert denied.status_code == 401
        challenge = denied.headers["www-authenticate"]
        assert "resource_metadata=" in challenge
        assert "https://mcp.test/.well-known/oauth-protected-resource/mcp" in challenge
        forged = await client.post("/mcp", headers={"Authorization": "Bearer a.b.c"})
        assert forged.status_code == 401
        bad_grant = await client.post(
            "/oauth/token",
            data={"grant_type": "client_credentials"},
        )
        assert bad_grant.status_code == 400
        assert bad_grant.json()["error"] == "unsupported_grant_type"
        reused = await client.post(
            "/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": body["refresh_token"]},
        )
        assert reused.status_code == 200
        replay = await client.post(
            "/oauth/token",
            data={"grant_type": "refresh_token", "refresh_token": body["refresh_token"]},
        )
        assert replay.status_code == 400
        assert replay.json()["error"] == "invalid_grant"
        runtime = get_oauth_runtime()
        assert runtime is not None
        expired = jwt.encode(
            {
                "iss": ISSUER,
                "sub": USER_ID,
                "aud": RESOURCE,
                "scope": "mcp:tools",
                "iat": 1,
                "exp": 2,
                "jti": "expired-jti",
            },
            runtime.signing.private_pem,
            algorithm="ES256",
            headers={"kid": runtime.signing.kid},
        )
        wrong_audience = jwt.encode(
            {
                "iss": ISSUER,
                "sub": USER_ID,
                "aud": "https://evil.test/mcp",
                "scope": "mcp:tools",
                "iat": int(time.time()),
                "exp": int(time.time()) + 60,
                "jti": "aud-jti",
            },
            runtime.signing.private_pem,
            algorithm="ES256",
            headers={"kid": runtime.signing.kid},
        )
        wrong_scope = jwt.encode(
            {
                "iss": ISSUER,
                "sub": USER_ID,
                "aud": RESOURCE,
                "scope": "other",
                "iat": int(time.time()),
                "exp": int(time.time()) + 60,
                "jti": "scope-jti",
            },
            runtime.signing.private_pem,
            algorithm="ES256",
            headers={"kid": runtime.signing.kid},
        )
        for token in (expired, wrong_audience):
            rejected = await client.post("/mcp", headers={"Authorization": f"Bearer {token}"})
            assert rejected.status_code == 401
        scoped = await client.post("/mcp", headers={"Authorization": f"Bearer {wrong_scope}"})
        assert scoped.status_code == 403

        async def _suspended(_user_id: str) -> str:
            return "suspended"

        install_account_status(_suspended)
        suspended = await client.post(
            "/mcp",
            headers={"Authorization": f"Bearer {body['access_token']}"},
        )
        assert suspended.status_code == 403
        install_account_status(_active)
        revoked = await client.post("/oauth/revoke", data={"token": body["access_token"]})
        assert revoked.status_code == 200
        runtime = get_oauth_runtime()
        assert runtime is not None
        claims = jwt.decode(str(body["access_token"]), options={"verify_signature": False})
        assert runtime.store.access_revoked(str(claims["jti"])) is True


async def test_consent_deny_csrf_and_pkce_failure(oauth_app) -> None:
    app, _key = oauth_app
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://127.0.0.1:8000",
    ) as client:
        registered = await client.post(
            "/oauth/register",
            json={"client_name": "Deny", "redirect_uris": [REDIRECT]},
        )
        client_id = registered.json()["client_id"]
        started = await client.get(
            "/oauth/authorize",
            params={
                "client_id": client_id,
                "redirect_uri": REDIRECT,
                "code_challenge": pkce_s256(_verifier()),
                "code_challenge_method": "S256",
                "state": "deny-state",
            },
            follow_redirects=False,
        )
        request_id = started.headers["location"].split("request_id=")[1]
        csrf = client.cookies["cointrac_oauth_csrf"]
        missing = await client.post(
            "/oauth/consent/decision",
            data={"request_id": request_id, "csrf": "wrong", "approve": "yes"},
        )
        assert missing.status_code == 400
        await client.post(
            "/oauth/consent/session",
            data={
                "request_id": request_id,
                "csrf": csrf,
                "email": "user@example.test",
                "password": "secret",
            },
        )
        denied = await client.post(
            "/oauth/consent/decision",
            data={"request_id": request_id, "csrf": csrf, "approve": "no"},
            follow_redirects=False,
        )
        assert denied.status_code == 302
        assert "error=access_denied" in denied.headers["location"]
        assert "state=deny-state" in denied.headers["location"]


async def test_mcp_tool_call_quota_and_api_key_regression(
    oauth_app,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _key = oauth_app
    rate = RecordingRate()
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="legacy-key",
                    key_hash=key_hash("ct_live_oauth_regression_key_1234567890abcd"),
                    rate_limit_per_min=60,
                    is_active=True,
                    user_id=USER_ID,
                )
            ]
        )
    )
    install_rate_store(rate)
    deps, logs = research_deps()
    research = deps
    set_service_deps(deps)
    set_evidence_writer(logs)
    from app.services import intelligence as workflows

    original = workflows.get_market_overview

    async def stub_overview(
        quote_currency: str = "USD",
        *,
        override_cmc_key: str | None = None,
        deps: object = None,
    ):
        del deps
        return await original(
            quote_currency,
            override_cmc_key=override_cmc_key,
            deps=research,
        )

    monkeypatch.setattr(workflows, "get_market_overview", stub_overview)
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:8000",
        ) as client:
            token = await _consent_and_token(client)
            both = await client.post(
                "/mcp",
                headers={
                    "Authorization": f"Bearer {token['access_token']}",
                    "x-cointrac-key": "ct_live_oauth_regression_key_1234567890abcd",
                },
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            )
            assert both.status_code == 401
            assert "not both" in both.text
            rest_key = await client.get(
                "/v1/intelligence/market-overview",
                params={"quote_currency": "USD"},
                headers={"x-cointrac-key": "ct_live_oauth_regression_key_1234567890abcd"},
            )
            assert rest_key.status_code == 200
            rest_oauth = await client.get(
                "/v1/intelligence/market-overview",
                params={"quote_currency": "USD"},
                headers={"Authorization": f"Bearer {token['access_token']}"},
            )
            assert rest_oauth.status_code == 401
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"Authorization": f"Bearer {token['access_token']}"},
            ) as http_client:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp",
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        listed = await session.list_tools()
                        names = {item.name for item in listed.tools}
                        assert "get_market_overview" in names
                        called = await session.call_tool("get_market_overview", {})
                        assert called.is_error is False
                        limited = await session.call_tool("get_market_overview", {})
                        assert limited.is_error is True
    assert rate.principals[0] == f"user:{USER_ID}"
    assert logs.logs[0].user_id == USER_ID
    assert logs.logs[0].tool_name == "get_market_overview"


async def test_oauth_all_ten_tools_and_pkce_wrong_verifier(oauth_app) -> None:
    app, _key = oauth_app
    deps, logs = research_deps()
    set_service_deps(deps)
    set_evidence_writer(logs)
    install_rate_store(MemoryRateStore())

    tool_calls: list[tuple[str, dict[str, object]]] = [
        ("get_market_overview", {"quote_currency": "USD"}),
        ("analyze_market_regime", {"quote_currency": "USD"}),
        ("scan_market_movers", {"quote_currency": "USD", "limit": 5}),
        ("compare_assets", {"symbols": ["BTC", "ETH"], "quote_currency": "USD"}),
        ("analyze_asset", {"symbol": "BTC", "quote_currency": "USD"}),
        ("analyze_momentum", {"symbols": ["BTC", "SOL"], "quote_currency": "USD"}),
        ("detect_market_anomalies", {"quote_currency": "USD", "universe_size": 20}),
        ("analyze_sector_rotation", {"quote_currency": "USD"}),
        ("get_historical_performance", {"symbol": "SOL", "quote_currency": "USD", "count": 10}),
        ("analyze_derivatives", {"symbol": "BTC", "quote_currency": "USD"}),
    ]

    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://127.0.0.1:8000",
        ) as client:
            # Verify PKCE wrong verifier returns RFC 6749 invalid_grant JSON
            reg = await client.post(
                "/oauth/register",
                json={"client_name": "Gemini Probe", "redirect_uris": [REDIRECT]},
            )
            assert reg.status_code == 201
            cid = reg.json()["client_id"]
            auth_start = await client.get(
                "/oauth/authorize",
                params={
                    "client_id": cid,
                    "redirect_uri": REDIRECT,
                    "response_type": "code",
                    "code_challenge": pkce_s256(_verifier()),
                    "code_challenge_method": "S256",
                    "state": "gemini-state-1234",
                    "scope": "",
                    "resource": RESOURCE,
                },
                follow_redirects=False,
            )
            assert auth_start.status_code == 302
            req_id = auth_start.headers["location"].split("request_id=")[1]
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
            bad_pkce = await client.post(
                "/oauth/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "code_verifier": "wrong-verifier-value-that-fails-s256-check",
                    "client_id": cid,
                    "redirect_uri": REDIRECT,
                },
            )
            assert bad_pkce.status_code == 400
            assert bad_pkce.json()["error"] == "invalid_grant"

            # Complete valid OAuth flow with a fresh client and call all 10 intelligence tools
            client.cookies.clear()
            token = await _consent_and_token(client)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://127.0.0.1:8000",
                headers={"Authorization": f"Bearer {token['access_token']}"},
            ) as http_client:
                async with streamable_http_client(
                    "http://127.0.0.1:8000/mcp",
                    http_client=http_client,
                ) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        listed = await session.list_tools()
                        names = {item.name for item in listed.tools}
                        for tool_name, _ in tool_calls:
                            assert tool_name in names
                        for tool_name, args in tool_calls:
                            res = await session.call_tool(tool_name, args)
                            assert res.is_error is False, f"{tool_name} failed: {res}"
    assert all(entry.user_id == USER_ID for entry in logs.logs)
    assert {entry.tool_name for entry in logs.logs} == {name for name, _ in tool_calls}


async def test_cross_client_refresh_rejected_without_revoking_family(oauth_app) -> None:
    app, _key = oauth_app
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://127.0.0.1:8000",
    ) as client:
        reg_a = await client.post(
            "/oauth/register",
            json={"client_name": "Client A", "redirect_uris": [REDIRECT]},
        )
        client_a = reg_a.json()["client_id"]
        reg_b = await client.post(
            "/oauth/register",
            json={"client_name": "Client B", "redirect_uris": [REDIRECT]},
        )
        client_b = reg_b.json()["client_id"]

        verifier = _verifier()
        started = await client.get(
            "/oauth/authorize",
            params={
                "client_id": client_a,
                "redirect_uri": REDIRECT,
                "code_challenge": pkce_s256(verifier),
                "code_challenge_method": "S256",
                "state": "cross-state",
            },
            follow_redirects=False,
        )
        req_id = started.headers["location"].split("request_id=")[1]
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
        token_resp = await client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "client_id": client_a,
                "redirect_uri": REDIRECT,
            },
        )
        assert token_resp.status_code == 200
        refresh_a = token_resp.json()["refresh_token"]

        # Client B tries to use Client A's refresh token -> RFC 400 invalid_grant, no leak
        mismatch = await client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_a,
                "client_id": client_b,
            },
        )
        assert mismatch.status_code == 400
        assert mismatch.json() == {
            "error": "invalid_grant",
            "error_description": "Refresh token is invalid, expired, or reused.",
        }

        # Client A's token family remains active and refreshes normally
        ok_a = await client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_a,
                "client_id": client_a,
            },
        )
        assert ok_a.status_code == 200
        new_refresh_a = ok_a.json()["refresh_token"]
        assert new_refresh_a != refresh_a

        # Genuine replay of used refresh_a still revokes the entire family
        replay = await client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_a,
                "client_id": client_a,
            },
        )
        assert replay.status_code == 400
        revoked_next = await client.post(
            "/oauth/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": new_refresh_a,
                "client_id": client_a,
            },
        )
        assert revoked_next.status_code == 400
