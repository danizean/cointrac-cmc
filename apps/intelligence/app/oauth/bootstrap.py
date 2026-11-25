"""Install the OAuth runtime while the application process is starting."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import REPO_ROOT, Settings
from app.core.logging import register_secrets
from app.oauth.errors import OAuthConfigurationError
from app.oauth.keys import load_private_key, load_public_jwks
from app.oauth.runtime import OAuthRuntime, get_oauth_runtime, install_oauth_runtime
from app.oauth.store import open_store

_KID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_REQUIRED = (
    "OAUTH_ISSUER",
    "OAUTH_RESOURCE",
    "OAUTH_SIGNING_KID",
    "OAUTH_SIGNING_KEY_PATH",
    "OAUTH_DATABASE_URL",
)


@dataclass(frozen=True)
class OAuthStartup:
    issuer: str
    resource: str
    kid: str
    key_path: Path
    database_url: str
    previous_jwks: str


def install_from_settings(settings: Settings) -> None:
    current = get_oauth_runtime()
    if current is not None:
        current.close()
        install_oauth_runtime(None)
    startup = resolve_startup(settings)
    if startup is None:
        return
    signing = load_private_key(startup.key_path, startup.kid)
    register_secrets(signing.private_pem, startup.database_url)
    previous_pems, previous_public = load_public_jwks(startup.previous_jwks)
    if startup.kid in previous_pems:
        raise OAuthConfigurationError("OAUTH_SIGNING_KID collides with a previous key.")
    store = open_store(startup.database_url)
    install_oauth_runtime(OAuthRuntime(store, signing, previous_pems, previous_public))


def resolve_startup(settings: Settings) -> OAuthStartup | None:
    database_url = settings.oauth_database_url.get_secret_value().strip()
    present = {
        "OAUTH_ISSUER": settings.oauth_issuer.strip(),
        "OAUTH_RESOURCE": settings.oauth_resource.strip(),
        "OAUTH_SIGNING_KID": settings.oauth_signing_kid.strip(),
        "OAUTH_SIGNING_KEY_PATH": settings.oauth_signing_key_path.strip(),
        "OAUTH_DATABASE_URL": database_url,
        "OAUTH_PREVIOUS_PUBLIC_JWKS": settings.oauth_previous_public_jwks.strip(),
    }
    if not any(present.values()):
        return None
    missing = [name for name in _REQUIRED if not present[name]]
    if missing:
        names = ", ".join(missing)
        raise OAuthConfigurationError(
            f"OAuth startup configuration is incomplete. Missing: {names}. "
            "Refusing to advertise OAuth metadata."
        )
    kid = present["OAUTH_SIGNING_KID"]
    if _KID.fullmatch(kid) is None or not kid.startswith("cointrac-mcp-"):
        raise OAuthConfigurationError(
            "OAUTH_SIGNING_KID must start with cointrac-mcp- and stay URL-safe."
        )
    issuer_host = (urlparse(present["OAUTH_ISSUER"]).hostname or "").lower()
    if database_url.startswith("sqlite:") and not issuer_host.endswith(".test"):
        raise OAuthConfigurationError("SQLite OAuth storage is only allowed for a .test issuer.")
    key_path = Path(present["OAUTH_SIGNING_KEY_PATH"]).resolve()
    if REPO_ROOT is not None and (key_path == REPO_ROOT or REPO_ROOT in key_path.parents):
        raise OAuthConfigurationError("OAUTH_SIGNING_KEY_PATH must point outside the repository.")
    if not key_path.is_file():
        raise OAuthConfigurationError("OAUTH_SIGNING_KEY_PATH does not name a readable file.")
    return OAuthStartup(
        issuer=present["OAUTH_ISSUER"],
        resource=present["OAUTH_RESOURCE"],
        kid=present["OAUTH_SIGNING_KID"],
        key_path=key_path,
        database_url=database_url,
        previous_jwks=present["OAUTH_PREVIOUS_PUBLIC_JWKS"],
    )


async def cleanup_loop(runtime: OAuthRuntime) -> None:
    try:
        while True:
            await asyncio.sleep(300)
            store = runtime.store
            cleanup = getattr(store, "cleanup", None)
            if callable(cleanup):
                await asyncio.to_thread(cleanup)
    except asyncio.CancelledError:
        return
