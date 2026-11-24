import json
import logging
from contextlib import asynccontextmanager
from urllib.parse import parse_qsl

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser as McpAuthenticatedUser
from mcp.server.auth.provider import AccessToken as McpAccessToken
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import BaseModel, ConfigDict
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.routing import BaseRoute, Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app.adapters.cmc_client import CMCClient
from app.api.deps import (
    ApiKeyRecord,
    authenticate_mcp_key,
    check_mcp_transport_limit,
    context_from_key,
    current_mcp_auth,
    current_principal,
    resolve_api_key_headers,
)
from app.api.docs import render_swagger_docs
from app.api.v1.auth import router as auth_router
from app.api.v1.evidence import router as evidence_router
from app.api.v1.keys import router as keys_router
from app.api.v1.mcp_status import router as mcp_status_router
from app.api.v1.router import router as intelligence_router
from app.api.v1.telemetry import router as telemetry_router
from app.core.config import get_settings
from app.core.logging import configure_logging, register_secrets
from app.mcp.server import mcp
from app.services.intelligence import ServiceDeps, set_default_deps

_FORBIDDEN_QUERY_CREDENTIAL_PARAMS = frozenset(
    {"api_key", "apikey", "key", "token", "access_token", "x-cointrac-key", "x-tradeguard-key"}
)

OPENAPI_TAGS = [
    {
        "name": "Intelligence",
        "description": (
            "10 deterministic crypto market intelligence workflows returning canonical "
            "EvidenceEnvelope[T] payloads with 365d annualization and honest null handling."
        ),
    },
    {
        "name": "Evidence",
        "description": (
            "Persisted CoinMarketCap API provenance audit trail (endpoints, UTC timestamps, "
            "data mode, credit cost, methodology, and sanitized excerpts)."
        ),
    },
    {
        "name": "Telemetry",
        "description": "Call counts by surface (mcp/rest/playground), cache hit rate, and credits.",
    },
    {
        "name": "System",
        "description": "Health checks, live CoinMarketCap capability matrix, and MCP status.",
    },
    {
        "name": "Authentication",
        "description": "Verified Supabase JWT user identity and profile updates.",
    },
    {
        "name": "API Keys",
        "description": "Tenant-scoped CoinTrac API key creation (copy-once) and atomic revocation.",
    },
]

OPENAPI_DESCRIPTION = (
    "**CoinTrac Market Intelligence** is a deterministic crypto market intelligence MCP & REST "
    "platform powered by the CoinMarketCap API (0 server-side LLM calls, `sqrt(365)` volatility "
    "annualization, canonical numeric `cmc_id` resolution, and mandatory `EvidenceEnvelope` "
    "audit provenance).\n\n"
    "- **Authentication:** Pass your CoinTrac API key via `Authorization: Bearer <key>` or "
    "`x-cointrac-key`, or use a verified Supabase JWT.\n"
    "- **Optional BYOK:** Supply your own CoinMarketCap Pro key in `CoinMarketCapBYOK` "
    "(`x-cmc-api-key`) strictly in memory.\n"
    "- **MCP Endpoint:** Streamable HTTP mounted at `/mcp` (10 Tools, 5 Resources, 3 Prompts)."
)

logger = logging.getLogger("cointrac")


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    engine_version: str


class CapabilityUnavailable(BaseModel):
    model_config = ConfigDict(extra="forbid")

    available: bool
    results: list[object]
    total_credits_used: int | None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    register_secrets(
        settings.cmc_api_key.get_secret_value(),
        settings.supabase_service_role_key.get_secret_value(),
    )
    configure_logging()
    async with CMCClient() as cmc_client:
        deps = ServiceDeps.create()
        deps.gateway = cmc_client
        set_default_deps(deps)
        logger.info(
            "intelligence service ready engine=%s mcp_stateless=%s remote_deployed=%s",
            settings.engine_version,
            settings.mcp_stateless_http,
            bool(settings.remote_mcp_public_url),
        )
        try:
            yield
        finally:
            set_default_deps(None)


def _session_owner_key(record: ApiKeyRecord) -> tuple[str, str]:
    return (record.user_id or "unscoped", record.key_id)


def _build_mcp_authenticated_user(record: ApiKeyRecord) -> McpAuthenticatedUser:
    """Bind MCP SDK session ownership to (user_id, key_id) without storing any raw secret."""
    owner_id = f"{record.user_id or 'unscoped'}:{record.key_id}"
    return McpAuthenticatedUser(
        McpAccessToken(token=owner_id, client_id=owner_id, scopes=["mcp"])
    )


async def _send_json_error(
    send: Send,
    status_code: int,
    detail: str,
    extra_headers: dict[str, str] | None = None,
) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"cache-control", b"no-store"),
        (b"x-content-type-options", b"nosniff"),
        (b"content-length", str(len(body)).encode("ascii")),
        *[(k.encode("ascii"), v.encode("ascii")) for k, v in (extra_headers or {}).items()],
    ]
    await send({"type": "http.response.start", "status": status_code, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class MCPAuthMiddleware:
    """Pure ASGI auth, rate-limit, and session-owner guard for /mcp (zero SSE buffering)."""

    def __init__(self, inner: ASGIApp) -> None:
        self.inner = inner
        self._session_owners: dict[str, tuple[str, str]] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.inner(scope, receive, send)
            return

        if scope.get("method") == "OPTIONS":
            await self.inner(scope, receive, send)
            return

        # Explicitly reject credentials passed in URL query strings (prevents proxy log leaks)
        raw_qs = (scope.get("query_string") or b"").decode("latin1")
        if raw_qs:
            for param_name, _ in parse_qsl(raw_qs, keep_blank_values=True):
                if param_name.lower() in _FORBIDDEN_QUERY_CREDENTIAL_PARAMS:
                    await _send_json_error(
                        send,
                        400,
                        "API keys must be sent in Authorization or x-cointrac-key headers, "
                        "not in URL query parameters.",
                    )
                    return

        if not get_settings().mcp_require_api_key:
            await self.inner(scope, receive, send)
            return

        raw_headers = scope.get("headers") or []
        header_map: dict[str, str] = {}
        for name, value in raw_headers:
            header_map[name.decode("latin1").lower()] = value.decode("latin1").strip()

        auth_header = header_map.get("authorization", "")
        bearer_key = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else None
        if header_map.get("x-tradeguard-key"):
            await _send_json_error(send, 401, "Unauthorized")
            return
        raw_key, conflict = resolve_api_key_headers(
            cointrac_key=header_map.get("x-cointrac-key"),
            bearer_key=bearer_key,
        )
        if conflict:
            await _send_json_error(send, 401, "Unauthorized")
            return

        record, denied = await authenticate_mcp_key(raw_key)
        if denied is None and record is not None:
            method = str(scope.get("method") or "POST")
            denied = await check_mcp_transport_limit(record, method)
        if denied is not None or record is None:
            status_code, extra_headers, detail = denied or (401, {}, "Unauthorized")
            await _send_json_error(send, status_code, detail, extra_headers)
            return

        # Enforce strict (user_id, key_id) session ownership for stateful MCP sessions
        owner = _session_owner_key(record)
        incoming_session_id = header_map.get("mcp-session-id")
        if incoming_session_id:
            existing_owner = self._session_owners.get(incoming_session_id)
            if existing_owner is not None and existing_owner != owner:
                logger.warning("mcp cross-tenant session reuse rejected")
                await _send_json_error(send, 404, "Session not found")
                return

        # Bind MCP SDK's native scope["user"] so StreamableHTTPSessionManager enforces ownership too
        child_scope = dict(scope)
        child_scope["user"] = _build_mcp_authenticated_user(record)

        method = str(scope.get("method") or "POST")

        async def tracked_send(message: dict[str, object]) -> None:
            if message.get("type") == "http.response.start":
                resp_headers = message.get("headers") or []
                for h_name, h_val in resp_headers:  # type: ignore[union-attr]
                    if h_name.decode("latin1").lower() == "mcp-session-id":
                        issued_sid = h_val.decode("latin1").strip()
                        if issued_sid:
                            self._session_owners[issued_sid] = owner
                if method == "DELETE" and incoming_session_id:
                    self._session_owners.pop(incoming_session_id, None)
            await send(message)  # type: ignore[arg-type]

        token = current_mcp_auth.set(record)
        principal = current_principal.set(context_from_key(record, None, "mcp"))
        try:
            await self.inner(child_scope, receive, tracked_send)
        finally:
            current_mcp_auth.reset(token)
            current_principal.reset(principal)


class _McpExactRoute(BaseRoute):
    """Pure-ASGI route accepting both /mcp and /mcp/ directly with zero 307 redirects."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        if scope.get("type") == "http" and scope.get("path") in {"/mcp", "/mcp/"}:
            return Match.FULL, {"endpoint": self.app}
        return Match.NONE, {}

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        normalized = dict(scope)
        normalized["path"] = "/mcp"
        normalized["raw_path"] = b"/mcp"
        await self.app(normalized, receive, send)


def create_app() -> FastAPI:
    settings = get_settings()
    transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=settings.mcp_allowed_host_list(),
        allowed_origins=settings.mcp_allowed_origin_list(),
    )
    mcp_http = mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=settings.mcp_stateless_http,
        max_request_body_size=settings.mcp_max_body_bytes,
        session_idle_timeout=settings.mcp_session_idle_timeout,
        max_sessions=settings.mcp_max_sessions,
        transport_security=transport_security,
    )

    @asynccontextmanager
    async def app_lifespan(_app: FastAPI):
        async with lifespan(_app):
            async with mcp.session_manager.run():
                yield

    shared = {
        "title": "CoinTrac Market Intelligence API",
        "description": OPENAPI_DESCRIPTION,
        "version": settings.engine_version,
        "openapi_tags": OPENAPI_TAGS,
        "docs_url": None,
        "redoc_url": "/redoc",
        "lifespan": app_lifespan,
    }
    if settings.public_api_base_url:
        app = FastAPI(**shared, servers=[{"url": settings.public_api_base_url}])
    else:
        app = FastAPI(**shared)
    trusted_hosts = settings.trusted_host_list()
    if trusted_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list(),
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "x-cointrac-key",
            "x-cmc-api-key",
            "x-cointrac-surface",
            "Mcp-Session-Id",
            "MCP-Protocol-Version",
            "Last-Event-ID",
        ],
        expose_headers=[
            "Mcp-Session-Id",
            "MCP-Protocol-Version",
            "Retry-After",
        ],
    )

    @app.get("/docs", include_in_schema=False)
    def swagger_docs() -> HTMLResponse:
        return render_swagger_docs()

    @app.get(
        "/health",
        response_model=HealthResponse,
        tags=["System"],
        summary="Service Health Check",
    )
    def health() -> HealthResponse:
        return HealthResponse(status="ok", engine_version=get_settings().engine_version)

    @app.get(
        "/v1/capabilities",
        tags=["System"],
        summary="CoinMarketCap Capability Matrix",
        description="Empirically probed CoinMarketCap endpoint availability matrix.",
    )
    def capabilities() -> dict[str, object] | CapabilityUnavailable:
        path = get_settings().capability_matrix_path
        if not path.is_file():
            return CapabilityUnavailable(available=False, results=[], total_credits_used=None)
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return CapabilityUnavailable(available=False, results=[], total_credits_used=None)
        return payload

    app.include_router(intelligence_router)
    app.include_router(evidence_router)
    app.include_router(telemetry_router)
    app.include_router(auth_router)
    app.include_router(keys_router)
    app.include_router(mcp_status_router)
    app.router.routes.append(_McpExactRoute(MCPAuthMiddleware(mcp_http)))
    return app


app = create_app()
