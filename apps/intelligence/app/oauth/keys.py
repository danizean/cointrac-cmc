"""Load ES256 keys. Private key material stays out of responses and logs."""

from __future__ import annotations

import json
from pathlib import Path

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from app.oauth.errors import OAuthConfigurationError
from app.oauth.runtime import SigningKey, b64url

_PRIVATE_JWK_FIELDS = {"d", "p", "k", "q", "qi", "dp", "dq"}


def load_private_key(path: Path, kid: str) -> SigningKey:
    try:
        pem = path.read_text(encoding="utf-8")
        key = serialization.load_pem_private_key(pem.encode("utf-8"), password=None)
    except (OSError, ValueError, TypeError) as exc:
        raise OAuthConfigurationError(
            "OAUTH_SIGNING_KEY_PATH is not a usable ES256 private key."
        ) from exc
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise OAuthConfigurationError("OAUTH_SIGNING_KEY_PATH is not a usable ES256 private key.")
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
    numbers = key.public_key().public_numbers()
    jwk = {
        "kty": "EC",
        "crv": "P-256",
        "use": "sig",
        "alg": "ES256",
        "kid": kid,
        "x": b64url(numbers.x.to_bytes(32, "big")),
        "y": b64url(numbers.y.to_bytes(32, "big")),
    }
    return SigningKey(kid=kid, private_pem=private_pem, public_pem=public_pem, public_jwk=jwk)


def load_public_jwks(raw: str) -> tuple[dict[str, str], tuple[dict[str, str], ...]]:
    if not raw.strip():
        return {}, ()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OAuthConfigurationError("OAUTH_PREVIOUS_PUBLIC_JWKS is not valid JSON.") from exc
    if not isinstance(parsed, list):
        raise OAuthConfigurationError("OAUTH_PREVIOUS_PUBLIC_JWKS must be a JSON array.")
    pems: dict[str, str] = {}
    public: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict) or _PRIVATE_JWK_FIELDS.intersection(item):
            raise OAuthConfigurationError("OAUTH_PREVIOUS_PUBLIC_JWKS must contain public keys.")
        kid = str(item.get("kid") or "")
        if not kid:
            raise OAuthConfigurationError("Each previous JWK needs a kid.")
        try:
            key = ECAlgorithm.from_jwk(json.dumps(item))
            public_pem = key.public_bytes(
                serialization.Encoding.PEM,
                serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode("ascii")
        except (jwt.PyJWTError, ValueError, TypeError, AttributeError) as exc:
            raise OAuthConfigurationError(
                "OAUTH_PREVIOUS_PUBLIC_JWKS must contain public ES256 keys."
            ) from exc
        pems[kid] = public_pem
        public.append({str(key_name): str(value) for key_name, value in item.items()})
    return pems, tuple(public)
