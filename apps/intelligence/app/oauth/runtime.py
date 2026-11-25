"""OAuth 2.1 authorization server for MCP clients.

Supabase remains the user directory. This module issues CoinTrac access tokens
whose audience is the MCP resource. It does not replace API-key authentication.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from uuid import uuid4

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

MCP_SCOPE = "mcp:tools"
ACCESS_TTL_SECONDS = 900
CODE_TTL_SECONDS = 60
REFRESH_TTL_SECONDS = 30 * 24 * 3600
REQUEST_TTL_SECONDS = 600


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def pkce_s256(verifier: str) -> str:
    return b64url(hashlib.sha256(verifier.encode("ascii")).digest())


@dataclass
class OAuthClient:
    client_id: str
    redirect_uris: tuple[str, ...]
    client_name: str = "MCP client"


@dataclass
class AuthorizationRequest:
    request_id: str
    client_id: str
    redirect_uri: str
    code_challenge: str
    state: str
    scope: str
    resource: str
    csrf_token: str
    expires_at: float


@dataclass
class AuthorizationCode:
    code_hash: str
    client_id: str
    redirect_uri: str
    code_challenge: str
    user_id: str
    scope: str
    resource: str
    expires_at: float
    used: bool = False


@dataclass
class RefreshToken:
    token_hash: str
    family_id: str
    client_id: str
    user_id: str
    scope: str
    resource: str
    expires_at: float
    used: bool = False


@dataclass(repr=False)
class SigningKey:
    kid: str
    private_pem: str
    public_pem: str
    public_jwk: dict[str, str]

    @classmethod
    def generate(cls) -> SigningKey:
        key = ec.generate_private_key(ec.SECP256R1())
        private_pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode("ascii")
        public_pem = (
            key.public_key()
            .public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            .decode("ascii")
        )
        public = key.public_key().public_numbers()
        jwk = {
            "kty": "EC",
            "crv": "P-256",
            "use": "sig",
            "alg": "ES256",
            "kid": "cointrac-mcp-1",
            "x": b64url(public.x.to_bytes(32, "big")),
            "y": b64url(public.y.to_bytes(32, "big")),
        }
        return cls(kid=jwk["kid"], private_pem=private_pem, public_pem=public_pem, public_jwk=jwk)


class OAuthRuntime:
    def __init__(
        self,
        store: object,
        signing: SigningKey,
        previous_pems: dict[str, str] | None = None,
        previous_jwks: tuple[dict[str, str], ...] = (),
    ) -> None:
        self.store = store
        self.signing = signing
        self.previous_pems = previous_pems or {}
        self.previous_jwks = previous_jwks

    def verification_pem(self, kid: str) -> str | None:
        if kid == self.signing.kid:
            return self.signing.public_pem
        return self.previous_pems.get(kid)

    def jwks(self) -> list[dict[str, str]]:
        keys = [self.signing.public_jwk]
        current = self.signing.kid
        keys.extend(item for item in self.previous_jwks if item.get("kid") != current)
        return keys

    def close(self) -> None:
        close = getattr(self.store, "close", None)
        if callable(close):
            close()

    def issue_access_token(
        self,
        *,
        issuer: str,
        user_id: str,
        client_id: str,
        resource: str,
        scope: str,
    ) -> str:
        now = int(time.time())
        return jwt.encode(
            {
                "iss": issuer,
                "sub": user_id,
                "aud": resource,
                "scope": scope,
                "client_id": client_id,
                "iat": now,
                "exp": now + ACCESS_TTL_SECONDS,
                "jti": uuid4().hex,
            },
            self.signing.private_pem,
            algorithm="ES256",
            headers={"kid": self.signing.public_jwk["kid"]},
        )


_runtime: OAuthRuntime | None = None


def install_oauth_runtime(runtime: OAuthRuntime | None) -> None:
    global _runtime
    _runtime = runtime


def get_oauth_runtime() -> OAuthRuntime | None:
    return _runtime


def new_request(
    *,
    client_id: str,
    redirect_uri: str,
    code_challenge: str,
    state: str,
    scope: str,
    resource: str,
) -> AuthorizationRequest:
    return AuthorizationRequest(
        request_id=secrets.token_urlsafe(32),
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge,
        state=state,
        scope=scope,
        resource=resource,
        csrf_token=secrets.token_urlsafe(32),
        expires_at=time.time() + REQUEST_TTL_SECONDS,
    )


def new_code(request: AuthorizationRequest, user_id: str) -> tuple[str, AuthorizationCode]:
    raw = secrets.token_urlsafe(32)
    code = AuthorizationCode(
        code_hash=hash_secret(raw),
        client_id=request.client_id,
        redirect_uri=request.redirect_uri,
        code_challenge=request.code_challenge,
        user_id=user_id,
        scope=request.scope,
        resource=request.resource,
        expires_at=time.time() + CODE_TTL_SECONDS,
    )
    return raw, code


def new_refresh(
    *,
    client_id: str,
    user_id: str,
    scope: str,
    resource: str,
    family_id: str,
) -> tuple[str, RefreshToken]:
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
