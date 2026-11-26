"""HTTP surface for MCP OAuth discovery, registration, and token issue."""

from __future__ import annotations

from urllib.parse import urlparse
from uuid import uuid4

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.deps import _JWT_DEFAULT_LIMIT, _UUID, ApiKeyRecord
from app.core.config import get_settings
from app.oauth.consent import router as consent_router
from app.oauth.identity import account_status
from app.oauth.runtime import (
    MCP_SCOPE,
    OAuthClient,
    get_oauth_runtime,
    hash_secret,
    new_refresh,
    new_request,
    pkce_s256,
)

router = APIRouter(tags=["OAuth"])
router.include_router(consent_router)

_PUBLIC_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
}


def public_discovery(payload: dict[str, object]) -> JSONResponse:
    return JSONResponse(
        payload,
        headers={**_PUBLIC_HEADERS, "Cache-Control": "public, max-age=300"},
    )


def _issuer() -> str:
    return get_settings().oauth_issuer


def _resource() -> str:
    return get_settings().oauth_resource


def _runtime():
    runtime = get_oauth_runtime()
    if runtime is None:
        raise HTTPException(status_code=503, detail="OAuth authorization server is not configured")
    return runtime


def _metadata() -> dict[str, object]:
    issuer = _issuer()
    return {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth/authorize",
        "token_endpoint": f"{issuer}/oauth/token",
        "registration_endpoint": f"{issuer}/oauth/register",
        "revocation_endpoint": f"{issuer}/oauth/revoke",
        "jwks_uri": f"{issuer}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": [MCP_SCOPE],
        "resource_parameter_supported": True,
    }


def _cookie_secure(request: Request) -> bool:
    forwarded = request.headers.get("x-forwarded-proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip() == "https"
    return request.url.scheme == "https"


def _exact_redirect(uri: str) -> bool:
    parsed = urlparse(uri)
    if parsed.scheme == "https" and parsed.hostname and parsed.path:
        return True
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "http" and host in {"127.0.0.1", "localhost"} and bool(parsed.path)


def _oauth_error(status_code: int, error: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=error)


def _oauth_token_error(status_code: int, error: str, description: str) -> JSONResponse:
    return JSONResponse(
        {"error": error, "error_description": description},
        status_code=status_code,
        headers=_PUBLIC_HEADERS,
    )


@router.api_route("/.well-known/oauth-protected-resource", methods=["GET", "OPTIONS"])
@router.api_route("/.well-known/oauth-protected-resource/mcp", methods=["GET", "OPTIONS"])
async def protected_resource_metadata(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return JSONResponse({}, headers=_PUBLIC_HEADERS)
    return public_discovery(
        {
            "resource": _resource(),
            "authorization_servers": [_issuer()],
            "scopes_supported": [MCP_SCOPE],
            "bearer_methods_supported": ["header"],
        }
    )


@router.api_route("/.well-known/oauth-authorization-server", methods=["GET", "OPTIONS"])
@router.api_route("/.well-known/openid-configuration", methods=["GET", "OPTIONS"])
async def authorization_server_metadata(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return JSONResponse({}, headers=_PUBLIC_HEADERS)
    return public_discovery(_metadata())


@router.api_route("/.well-known/jwks.json", methods=["GET", "OPTIONS"])
async def jwks(request: Request) -> JSONResponse:
    if request.method == "OPTIONS":
        return JSONResponse({}, headers=_PUBLIC_HEADERS)
    return public_discovery({"keys": _runtime().jwks()})


@router.post("/oauth/register")
async def register_client(request: Request) -> JSONResponse:
    runtime = _runtime()
    body = await request.json()
    redirects = body.get("redirect_uris")
    if not isinstance(redirects, list) or not redirects:
        raise _oauth_error(400, "redirect_uris is required")
    cleaned = tuple(str(item) for item in redirects)
    if any(not _exact_redirect(item) for item in cleaned):
        raise _oauth_error(400, "redirect_uri is not allowed")
    client = OAuthClient(
        client_id=str(uuid4()),
        redirect_uris=cleaned,
        client_name=str(body.get("client_name") or "MCP client")[:120],
    )
    runtime.store.save_client(client)
    issuer = _issuer()
    return JSONResponse(
        {
            "client_id": client.client_id,
            "client_name": client.client_name,
            "redirect_uris": list(client.redirect_uris),
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "registration_client_uri": f"{issuer}/oauth/register/{client.client_id}",
        },
        status_code=201,
        headers=_PUBLIC_HEADERS,
    )


@router.get("/oauth/register/{client_id}")
async def read_client(client_id: str) -> JSONResponse:
    client = _runtime().store.get_client(client_id)
    if client is None:
        raise _oauth_error(404, "client was not found")
    return JSONResponse(
        {
            "client_id": client.client_id,
            "client_name": client.client_name,
            "redirect_uris": list(client.redirect_uris),
            "token_endpoint_auth_method": "none",
        },
        headers=_PUBLIC_HEADERS,
    )


@router.get("/oauth/authorize")
async def authorize(
    request: Request,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    code_challenge_method: str,
    state: str,
    scope: str = MCP_SCOPE,
    resource: str = "",
    response_type: str = "code",
) -> RedirectResponse:
    runtime = _runtime()
    client = runtime.store.get_client(client_id)
    if client is None or redirect_uri not in client.redirect_uris:
        raise _oauth_error(400, "invalid client or redirect_uri")
    if response_type != "code":
        raise _oauth_error(400, "unsupported response_type")
    if code_challenge_method != "S256" or len(code_challenge) < 43:
        raise _oauth_error(400, "PKCE S256 is required")
    if len(state) < 8:
        raise _oauth_error(400, "state is required")
    normalized_scope = " ".join(scope.split()) or MCP_SCOPE
    if normalized_scope != MCP_SCOPE:
        raise _oauth_error(400, "unsupported scope")
    expected = _resource()
    if resource and resource != expected:
        raise _oauth_error(400, "resource is not allowed")
    pending = new_request(
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        state=state,
        scope=normalized_scope,
        resource=expected,
    )
    runtime.store.save_request(pending)
    response = RedirectResponse(
        f"{_issuer()}/oauth/consent?request_id={pending.request_id}",
        status_code=302,
    )
    response.set_cookie(
        "cointrac_oauth_csrf",
        pending.csrf_token,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(request),
        max_age=600,
        path="/oauth",
    )
    return response


@router.post("/oauth/token")
async def token(request: Request) -> JSONResponse:
    runtime = _runtime()
    form = await request.form()
    grant = str(form.get("grant_type") or "")
    issuer = _issuer()
    if grant == "authorization_code":
        code = runtime.store.take_code(hash_secret(str(form.get("code") or "")))
        verifier = str(form.get("code_verifier") or "")
        if (
            code is None
            or code.client_id != str(form.get("client_id") or "")
            or code.redirect_uri != str(form.get("redirect_uri") or "")
            or pkce_s256(verifier) != code.code_challenge
        ):
            return _oauth_token_error(
                400, "invalid_grant", "Authorization code or PKCE verifier is invalid."
            )
        access = runtime.issue_access_token(
            issuer=issuer,
            user_id=code.user_id,
            client_id=code.client_id,
            resource=code.resource,
            scope=code.scope,
        )
        refresh_raw, refresh = new_refresh(
            client_id=code.client_id,
            user_id=code.user_id,
            scope=code.scope,
            resource=code.resource,
            family_id=str(uuid4()),
        )
        runtime.store.save_refresh(refresh)
        return _token_response(access, refresh_raw, code.scope)
    if grant == "refresh_token":
        client_id = str(form.get("client_id") or "") or None
        rotated = runtime.store.rotate_refresh(
            str(form.get("refresh_token") or ""),
            expected_client_id=client_id,
        )
        if rotated is None:
            return _oauth_token_error(
                400, "invalid_grant", "Refresh token is invalid, expired, or reused."
            )
        refresh_raw, current = rotated
        access = runtime.issue_access_token(
            issuer=issuer,
            user_id=current.user_id,
            client_id=current.client_id,
            resource=current.resource,
            scope=current.scope,
        )
        return _token_response(access, refresh_raw, current.scope)
    return _oauth_token_error(400, "unsupported_grant_type", "Grant type is not supported.")


@router.post("/oauth/revoke")
async def revoke(request: Request) -> JSONResponse:
    runtime = _runtime()
    form = await request.form()
    raw = str(form.get("token") or "")
    if raw.count(".") == 2:
        _revoke_access_token(runtime, raw)
    elif raw:
        runtime.store.revoke_refresh(raw)
    return JSONResponse({}, status_code=200, headers=_PUBLIC_HEADERS)


def _revoke_access_token(runtime: object, raw: str) -> None:
    oauth = get_oauth_runtime()
    if oauth is None:
        return
    try:
        header = jwt.get_unverified_header(raw)
        kid = str(header.get("kid") or "")
        pem = oauth.verification_pem(kid)
        if pem is None:
            return
        claims = jwt.decode(
            raw,
            pem,
            algorithms=["ES256"],
            audience=_resource(),
            issuer=_issuer(),
            options={"require": ["exp", "jti"]},
        )
    except jwt.PyJWTError:
        return
    exp = int(claims["exp"])
    runtime.store.revoke_access(str(claims["jti"]), exp)


def _token_response(access: str, refresh: str, scope: str) -> JSONResponse:
    return JSONResponse(
        {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": 900,
            "refresh_token": refresh,
            "scope": scope,
        },
        headers=_PUBLIC_HEADERS,
    )


async def authenticate_access_token(token: str, *, issuer: str, resource: str) -> ApiKeyRecord:
    runtime = get_oauth_runtime()
    if runtime is None:
        raise HTTPException(status_code=401, detail="invalid_token")
    try:
        header = jwt.get_unverified_header(token)
        kid = str(header.get("kid") or "")
        pem = runtime.verification_pem(kid)
        if pem is None:
            raise jwt.InvalidTokenError("unknown kid")
        claims = jwt.decode(
            token,
            pem,
            algorithms=["ES256"],
            audience=resource,
            issuer=issuer,
            leeway=60,
            options={"require": ["exp", "iat", "sub", "scope", "jti", "aud", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid_token") from exc
    if claims.get("aud") != resource or claims.get("iss") != issuer:
        raise HTTPException(status_code=401, detail="invalid_token")
    if str(claims.get("scope") or "").split() != [MCP_SCOPE]:
        raise HTTPException(status_code=403, detail="insufficient_scope")
    user_id = str(claims["sub"])
    if _UUID.fullmatch(user_id) is None:
        raise HTTPException(status_code=401, detail="invalid_token")
    if runtime.store.access_revoked(str(claims["jti"])):
        raise HTTPException(status_code=401, detail="invalid_token")
    status = await account_status(user_id)
    if status in {"suspended", "pending_deletion", "missing"}:
        raise HTTPException(status_code=403, detail="Account is not active")
    return ApiKeyRecord(
        key_id=f"oauth:{claims['jti']}",
        key_hash="",
        rate_limit_per_min=_JWT_DEFAULT_LIMIT,
        is_active=True,
        user_id=user_id,
        auth_kind="oauth",
    )
