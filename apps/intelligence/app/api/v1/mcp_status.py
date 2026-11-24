"""Read-only Remote MCP infrastructure status metadata endpoint (Phase 5)."""

from __future__ import annotations

import mcp.types as mcp_types
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from app.api.jwt_auth import AuthenticatedUser, require_verified_supabase_user
from app.core.config import get_settings
from app.mcp.server import mcp

router = APIRouter(prefix="/v1/mcp", tags=["System"])


class McpContractCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: int
    static_resources: int
    resource_templates: int
    prompts: int


class McpStatusResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_name: str
    transport: str
    protocol_version: str
    stateless_http: bool
    endpoint_path: str
    remote_deployed: bool
    remote_url: str | None
    deployment_status: str
    auth_methods: list[str]
    key_prefixes_supported: list[str]
    tool_timeout_seconds: float
    max_body_bytes: int
    contracts: McpContractCounts


@router.get(
    "/status",
    response_model=McpStatusResponse,
    summary="Inspect Remote MCP Transport & Deployment Status",
    description=(
        "Returns truthful CoinTrac MCP transport configuration, deployment readiness, "
        "supported authentication methods, and verified contract counts. Never fabricates "
        "a hosted remote URL when REMOTE_MCP_PUBLIC_URL is unconfigured."
    ),
)
async def get_mcp_status(
    response: Response,
    _user: AuthenticatedUser = Depends(require_verified_supabase_user),
) -> McpStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    settings = get_settings()
    remote_url = settings.remote_mcp_public_url or None
    remote_deployed = remote_url is not None

    tools = await mcp.list_tools()
    resources = await mcp.list_resources()
    templates = await mcp.list_resource_templates()
    prompts = await mcp.list_prompts()

    return McpStatusResponse(
        server_name=mcp.name or "CoinTrac Market Intelligence",
        transport="streamable-http",
        protocol_version=str(getattr(mcp_types, "LATEST_PROTOCOL_VERSION", "2026-07-28")),
        stateless_http=settings.mcp_stateless_http,
        endpoint_path="/mcp",
        remote_deployed=remote_deployed,
        remote_url=remote_url,
        deployment_status="deployed" if remote_deployed else "not_deployed",
        auth_methods=[
            "Authorization: Bearer <key>",
            "x-cointrac-key: <key>",
        ],
        key_prefixes_supported=["ct_live_"],
        tool_timeout_seconds=settings.mcp_tool_timeout_seconds,
        max_body_bytes=settings.mcp_max_body_bytes,
        contracts=McpContractCounts(
            tools=len(tools),
            static_resources=len(resources),
            resource_templates=len(templates),
            prompts=len(prompts),
        ),
    )
