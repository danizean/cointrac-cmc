from datetime import UTC, datetime

from fastapi.testclient import TestClient
from tests.test_services import Book, Caps, Scripted, common_handlers

from app.api.deps import ApiKeyRecord, MemoryKeyDirectory, install_keys, key_hash
from app.main import app
from app.services.evidence import MemoryEvidence
from app.services.intelligence import SectorBook, ServiceDeps, install_deps

SANDBOX = "ct_live_unit_test_fixture_001"


def use_sandbox(limit: int) -> TestClient:
    install_keys(
        MemoryKeyDirectory(
            [
                ApiKeyRecord(
                    key_id="sandbox",
                    key_hash=key_hash(SANDBOX),
                    rate_limit_per_min=limit,
                    is_active=True,
                )
            ]
        )
    )
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


def test_market_overview_requires_a_key() -> None:
    install_keys(MemoryKeyDirectory([]))
    response = TestClient(app).get("/v1/intelligence/market-overview")
    assert response.status_code == 401
    assert SANDBOX not in response.text


def test_authorized_compare_returns_evidence() -> None:
    api = use_sandbox(10)
    try:
        response = api.post(
            "/v1/intelligence/compare-assets",
            headers={
                "x-cointrac-key": SANDBOX,
                "x-cmc-api-key": "caller-owned-key",
            },
            json={"symbols": ["SOL", "AVAX"]},
        )
    finally:
        install_deps(None)
    assert response.status_code == 200
    body = response.json()
    assert body["tool"] == "compare_assets"
    assert body["evidence"]["evidence_id"].startswith("ev_")
    assert body["methodology"]["annualization_basis"] == "365d"
    assert "caller-owned-key" not in response.text


def test_rate_limit_returns_retry_after() -> None:
    api = use_sandbox(1)
    headers = {"x-cointrac-key": SANDBOX}
    try:
        first = api.get("/v1/intelligence/market-overview", headers=headers)
        second = api.get("/v1/intelligence/market-overview", headers=headers)
    finally:
        install_deps(None)
    assert first.status_code == 200
    assert first.headers["x-ratelimit-limit"] == "1"
    assert first.headers["x-ratelimit-remaining"] == "0"
    assert first.headers["x-content-type-options"] == "nosniff"
    assert second.status_code == 429
    assert second.headers["retry-after"]
    assert second.headers["x-ratelimit-limit"] == "1"
    assert second.headers["x-ratelimit-remaining"] == "0"
    assert second.headers["x-content-type-options"] == "nosniff"


def test_invalid_byok_header_returns_400_instead_of_silent_fallback() -> None:
    api = use_sandbox(10)
    try:
        response = api.get(
            "/v1/intelligence/market-overview",
            headers={
                "x-cointrac-key": SANDBOX,
                "x-cmc-api-key": "bad key!@#",
            },
        )
    finally:
        install_deps(None)
    assert response.status_code == 400
    assert "x-cmc-api-key" in response.json()["detail"]


def test_mcp_mount_enforces_api_key_and_rate_limit() -> None:
    use_sandbox(1)
    try:
        with TestClient(app) as api:
            unauth = api.post(
                "/mcp/",
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            )
            unauth_delete = api.delete("/mcp/")
            # limit=1 gives transport allowance of 4 frames/min; 5th POST must return 429
            statuses = [
                api.post(
                    "/mcp/",
                    headers={
                        "Authorization": f"Bearer {SANDBOX}",
                        "Accept": "application/json, text/event-stream",
                    },
                    json={"jsonrpc": "2.0", "id": idx, "method": "tools/list"},
                ).status_code
                for idx in range(1, 5)
            ]
            throttled = api.post(
                "/mcp/",
                headers={
                    "x-cointrac-key": SANDBOX,
                    "Accept": "application/json, text/event-stream",
                },
                json={"jsonrpc": "2.0", "id": 5, "method": "tools/list"},
            )
            # Authenticated DELETE teardown uses an isolated bucket and must not 429
            teardown = api.delete("/mcp/", headers={"x-cointrac-key": SANDBOX})
    finally:
        install_deps(None)
    assert unauth.status_code == 401
    assert unauth_delete.status_code == 401
    assert all(code != 401 and code != 429 for code in statuses)
    assert throttled.status_code == 429
    assert throttled.headers["retry-after"]
    assert teardown.status_code != 401
    assert teardown.status_code != 429


def test_invalid_symbol_and_quote_currency_return_422() -> None:
    api = use_sandbox(20)
    headers = {"x-cointrac-key": SANDBOX}
    try:
        bad_dash = api.get("/v1/intelligence/assets/BTC-USD", headers=headers)
        bad_len = api.get("/v1/intelligence/assets/" + ("A" * 25), headers=headers)
        bad_hist = api.get("/v1/intelligence/assets/BTC-USD/historical", headers=headers)
        bad_deriv = api.get("/v1/intelligence/assets/BTC-USD/derivatives", headers=headers)
        bad_quote_ov = api.get(
            "/v1/intelligence/market-overview",
            params={"quote_currency": "XXX"},
            headers=headers,
        )
        bad_quote_asset = api.get(
            "/v1/intelligence/assets/BTC",
            params={"quote_currency": "XXX"},
            headers=headers,
        )
        bad_neg_mcap = api.post(
            "/v1/intelligence/scan-movers",
            json={"min_market_cap_usd": -1},
            headers=headers,
        )
        bad_str_limit = api.post(
            "/v1/intelligence/scan-movers",
            json={"limit": "10"},
            headers=headers,
        )
        bad_ev_id = api.get("/v1/evidence/notanid", headers=headers)
        jwt_only = api.get("/v1/keys", headers=headers)
        unauth_caps = TestClient(app).get("/v1/capabilities")
        auth_caps = api.get("/v1/capabilities", headers=headers)
    finally:
        install_deps(None)
    assert bad_dash.status_code == 422
    assert bad_len.status_code == 422
    assert bad_hist.status_code == 422
    assert bad_deriv.status_code == 422
    assert bad_quote_ov.status_code == 422
    assert bad_quote_asset.status_code == 422
    assert bad_neg_mcap.status_code == 422
    assert bad_str_limit.status_code == 422
    assert bad_ev_id.status_code == 422
    assert jwt_only.status_code == 401
    assert "JWT bearer token" in jwt_only.json()["detail"]
    assert unauth_caps.status_code == 401
    assert auth_caps.status_code == 200
