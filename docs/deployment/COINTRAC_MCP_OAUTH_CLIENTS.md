# CoinTrac MCP client setup

Canonical MCP URL: `https://mcp.cointrac.xyz/mcp`

Discovery, once the authorization server is enabled in production:

- Protected resource metadata: `https://mcp.cointrac.xyz/.well-known/oauth-protected-resource/mcp`
- Authorization server metadata: `https://api.cointrac.xyz/.well-known/oauth-authorization-server`

Existing integrations keep using a `ct_live_` API key in `Authorization: Bearer` or `x-cointrac-key`. OAuth does not replace that path.

CIMD is not implemented. Clients that require a URL client id cannot register. Dynamic registration is implemented for public clients and PKCE S256.

None of the four clients below has completed a live authorization and tool call against CoinTrac. Do not treat a metadata HTTP 200 as compatibility. The local suite has exercised the browser consent form, token exchange, and one read-only MCP tool call with a test identity. That is not a ChatGPT, Gemini, Claude, or Hermes session.

## ChatGPT

Custom MCP / remote Streamable HTTP.

1. Add the MCP URL above.
2. Choose OAuth when the client asks. It should read the protected-resource metadata and then the authorization-server metadata.
3. Approve the CoinTrac consent screen with the account that should own the quota.
4. After the callback, ask the client to list tools. Ten tools is the expected catalog.
5. Run one read-only tool such as market overview.

The production authorization server is not enabled yet, so this flow cannot succeed until the migration and signing key are approved. API-key headers are not the ChatGPT OAuth path.

## Gemini

The consumer Gemini app, Gemini Code Assist, and Gemini CLI do not share one MCP authentication surface. This repository does not select one of them as verified.

If the product supports remote MCP with an authorization header, the compatible path today is the existing API key:

`Authorization: Bearer <ct_live key>`

If it only supports OAuth discovery, it depends on the same unreleased authorization server as ChatGPT. A failure before that server is enabled is a CoinTrac gap, not a Gemini account or region result. No Gemini session was run.

## Claude

Claude custom connectors and the Anthropic API MCP connector are different.

- A Claude.ai custom connector that requires OAuth uses the discovery URLs above and the consent screen. That path is not live.
- An Anthropic API request that sends a CoinTrac API key as a bearer token uses the existing key check. That is not the same configuration as the connector OAuth flow.

Do not copy a connector client id into an API request, or an API key into the connector's OAuth client registration, and expect the same result.

## Hermes Agent

The reproducible remote MCP configuration that matches the current server is:

- URL: `https://mcp.cointrac.xyz/mcp`
- Transport: Streamable HTTP
- Header: `Authorization: Bearer <ct_live key>`

OAuth for Hermes is only available if that Hermes version performs the MCP discovery and authorization-code flow with PKCE S256. That version was not identified or tested here. Token renewal was not observed.

## Common errors

| Symptom | Meaning |
|---|---|
| 401 and `resource_metadata` | No credentials. The client should start OAuth, or send an API key. |
| 401 `invalid_token` | The bearer JWT is not a CoinTrac access token for this resource. |
| 403 `insufficient_scope` | The token does not include `mcp:tools`. |
| 503 OAuth authorization server is not configured | Issuance is intentionally off until the grant store and signing key exist. |

Do not put access tokens, refresh tokens, or API keys in a guide or a ticket.
