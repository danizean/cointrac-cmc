from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

QuotaProfile = Literal["startup", "basic", "adaptive"]
PROFILE_DEFAULT_TTL_MULTIPLIER: dict[QuotaProfile, float] = {
    "startup": 1.0,
    "basic": 2.5,
    "adaptive": 1.0,
}
PROFILE_DEFAULT_MONTHLY_BUDGET: dict[QuotaProfile, int] = {
    "startup": 450_000,
    "basic": 10_000,
    "adaptive": 10_000,
}


def find_repo_root(start: Path) -> Path | None:
    """Walk up to the monorepo root. The container path is too short for a fixed index."""
    for parent in start.resolve().parents:
        if (parent / "apps" / "intelligence" / "pyproject.toml").is_file():
            return parent
    return None


REPO_ROOT = find_repo_root(Path(__file__))
_ENV_FILE = REPO_ROOT / ".env" if REPO_ROOT is not None else None
_CAPABILITY_MATRIX = (
    REPO_ROOT / "docs" / "CMC_CAPABILITY_MATRIX.json"
    if REPO_ROOT is not None
    else Path("/app/docs/CMC_CAPABILITY_MATRIX.json")
)

DEFAULT_MCP_ALLOWED_HOSTS = "127.0.0.1:*,localhost:*,[::1]:*"
DEFAULT_MCP_ALLOWED_ORIGINS = "http://127.0.0.1:*,http://localhost:*,http://[::1]:*"


def _parse_csv(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _validate_https_public_url(value: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        return ""
    parsed = urlparse(cleaned)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("A public URL must be an https:// URL with a host.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("A public URL must not contain credentials, query params, or fragments.")
    host = (parsed.hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("A public URL must not point to localhost.")
    return cleaned.rstrip("/")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    cmc_api_key: SecretStr = SecretStr("")
    cmc_base_url: str = "https://pro-api.coinmarketcap.com"
    supabase_url: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    sandbox_api_key: SecretStr = SecretStr("")
    engine_version: str = "cointrac-intelligence-v1.0.0"
    cors_origins: str = "http://localhost:3000"
    trusted_hosts: str = ""
    public_api_base_url: str = ""
    oauth_issuer: str = ""
    oauth_resource: str = ""
    oauth_signing_kid: str = ""
    oauth_signing_key_path: str = ""
    oauth_previous_public_jwks: str = ""
    oauth_database_url: SecretStr = SecretStr("")
    supabase_publishable_key: SecretStr = SecretStr("")
    force_simulate_basic_tier: bool = False
    mcp_require_api_key: bool = True
    cmc_quota_profile: QuotaProfile = "startup"
    cmc_cache_ttl_multiplier: float | None = Field(default=None, ge=0.5, le=12.0)
    cmc_monthly_credit_budget: int | None = Field(default=None, ge=1)
    cmc_warmer_enabled: bool = False
    capability_matrix_path: Path = Field(default=_CAPABILITY_MATRIX)

    # Phase 5 Remote MCP transport & security configuration
    mcp_stateless_http: bool = True
    mcp_allowed_hosts: str = DEFAULT_MCP_ALLOWED_HOSTS
    mcp_allowed_origins: str = DEFAULT_MCP_ALLOWED_ORIGINS
    mcp_tool_timeout_seconds: float = Field(default=25.0, ge=1.0, le=120.0)
    mcp_max_body_bytes: int = Field(default=1_048_576, ge=4096, le=4_194_304)
    mcp_session_idle_timeout: float = Field(default=1800.0, ge=60.0, le=86400.0)
    mcp_max_sessions: int = Field(default=1000, ge=1, le=50_000)
    remote_mcp_public_url: str = ""

    @field_validator("mcp_allowed_hosts")
    @classmethod
    def _validate_allowed_hosts(cls, value: str) -> str:
        hosts = _parse_csv(value)
        if not hosts:
            raise ValueError("MCP_ALLOWED_HOSTS must include at least one allowed host.")
        for entry in hosts:
            if entry in {"*", "*:*"} or entry.startswith("*."):
                raise ValueError(
                    f"Wildcard host pattern '{entry}' is not allowed in MCP_ALLOWED_HOSTS."
                )
        return value

    @field_validator("mcp_allowed_origins")
    @classmethod
    def _validate_allowed_origins(cls, value: str) -> str:
        origins = _parse_csv(value)
        if not origins:
            raise ValueError("MCP_ALLOWED_ORIGINS must include at least one allowed origin.")
        for entry in origins:
            if entry == "*" or entry.startswith("http://*") or entry.startswith("https://*"):
                raise ValueError(
                    f"Wildcard origin pattern '{entry}' is not allowed in MCP_ALLOWED_ORIGINS."
                )
            if not (entry.startswith("http://") or entry.startswith("https://")):
                raise ValueError(
                    f"Origin '{entry}' in MCP_ALLOWED_ORIGINS must start with http:// or https://."
                )
        return value

    @field_validator("cors_origins")
    @classmethod
    def _validate_cors_origins(cls, value: str) -> str:
        for entry in _parse_csv(value):
            if entry == "*" or entry.startswith("http://*") or entry.startswith("https://*"):
                raise ValueError(
                    f"Wildcard origin pattern '{entry}' is not allowed in CORS_ORIGINS."
                )
            if not (entry.startswith("http://") or entry.startswith("https://")):
                raise ValueError(
                    f"Origin '{entry}' in CORS_ORIGINS must start with http:// or https://."
                )
        return value

    @field_validator("trusted_hosts")
    @classmethod
    def _validate_trusted_hosts(cls, value: str) -> str:
        for entry in _parse_csv(value):
            if entry in {"*", "*:*"} or entry.startswith("*"):
                raise ValueError(
                    f"Wildcard host pattern '{entry}' is not allowed in TRUSTED_HOSTS."
                )
        return value

    @field_validator("public_api_base_url", "oauth_issuer", "oauth_resource")
    @classmethod
    def _validate_public_api_base_url(cls, value: str) -> str:
        return _validate_https_public_url(value)

    @field_validator("cmc_quota_profile", mode="before")
    @classmethod
    def _validate_quota_profile(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("CMC_QUOTA_PROFILE must be one of: startup, basic, adaptive.")
        normalized = value.strip().lower()
        if normalized not in {"startup", "basic", "adaptive"}:
            raise ValueError(
                f"Invalid CMC_QUOTA_PROFILE '{value}'. Must be one of: startup, basic, adaptive."
            )
        return normalized

    @field_validator("cmc_cache_ttl_multiplier", "cmc_monthly_credit_budget", mode="before")
    @classmethod
    def _empty_string_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("remote_mcp_public_url")
    @classmethod
    def _validate_remote_url(cls, value: str) -> str:
        return _validate_https_public_url(value)

    def resolved_monthly_credit_budget(self) -> int:
        if self.cmc_monthly_credit_budget is not None:
            return self.cmc_monthly_credit_budget
        return PROFILE_DEFAULT_MONTHLY_BUDGET[self.cmc_quota_profile]

    def resolved_ttl_multiplier(
        self,
        budget_state: str = "NORMAL",
        *,
        warning_level: str = "NONE",
    ) -> float:
        base = (
            float(self.cmc_cache_ttl_multiplier)
            if self.cmc_cache_ttl_multiplier is not None
            else PROFILE_DEFAULT_TTL_MULTIPLIER[self.cmc_quota_profile]
        )
        if self.cmc_quota_profile == "adaptive":
            if budget_state == "CUTOFF":
                mult = max(base, 12.0)
            elif budget_state == "EMERGENCY":
                mult = max(base, 5.0)
            elif budget_state == "CONSERVATION":
                mult = max(base, 2.5)
            elif warning_level == "ELEVATED":
                mult = max(base, 1.5)
            else:
                mult = base
        elif budget_state == "CUTOFF":
            mult = max(base, 12.0)
        elif budget_state == "EMERGENCY":
            mult = max(base * 2.5, 5.0)
        elif budget_state == "CONSERVATION":
            mult = max(base * 1.5, 2.5)
        else:
            mult = base
        return max(0.5, min(12.0, float(mult)))

    def cors_origin_list(self) -> list[str]:
        return _parse_csv(self.cors_origins)

    def trusted_host_list(self) -> list[str]:
        return _parse_csv(self.trusted_hosts)

    def mcp_allowed_host_list(self) -> list[str]:
        hosts = _parse_csv(self.mcp_allowed_hosts)
        if self.remote_mcp_public_url:
            netloc = urlparse(self.remote_mcp_public_url).netloc
            if netloc and netloc not in hosts:
                hosts.append(netloc)
        return hosts

    def mcp_allowed_origin_list(self) -> list[str]:
        origins = _parse_csv(self.mcp_allowed_origins)
        for origin in self.cors_origin_list():
            if origin not in origins and origin != "*":
                origins.append(origin)
        return origins


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
