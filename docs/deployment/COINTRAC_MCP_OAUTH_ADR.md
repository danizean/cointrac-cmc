# ADR: MCP OAuth for CoinTrac

Status: implemented in the local working tree. Not enabled in production. Not applied to Supabase.

## Problem

`/mcp` accepts only a CoinTrac API key in `Authorization: Bearer` or `x-cointrac-key`. A bearer value with two dots is rejected before it can be a JWT. Unauthenticated responses do not include a `WWW-Authenticate` challenge or protected-resource metadata. ChatGPT, Claude, and other OAuth MCP clients stop there. Supabase Auth is the user directory. It is not an MCP authorization server: it does not publish this resource, PKCE client registration, or an audience of `https://mcp.cointrac.xyz/mcp`.

## Decision

Keep Supabase as the identity provider. Add a separate OAuth 2.1 authorization server in the FastAPI process.

- Resource server: the existing Streamable HTTP endpoint `/mcp`.
- Authorization server issuer: `https://api.cointrac.xyz` when `OAUTH_ISSUER` is set.
- Resource audience: `https://mcp.cointrac.xyz/mcp` when `OAUTH_RESOURCE` is set.
- Grant: authorization code with PKCE S256 only.
- Clients: public clients via dynamic registration. Redirect URIs must match exactly. `http` is allowed only for `127.0.0.1` and `localhost`.
- Access token: ES256 JWT, 15 minutes, `aud` is the MCP resource, scope `mcp:tools`.
- Refresh token: opaque, stored only as SHA-256, rotated on use. Reuse revokes the token family.
- Consent binds the grant to the Supabase user id from a verified session JWT. Quota uses the existing `user:<id>` principal. API keys are unchanged.

Startup installs the runtime only when issuer, resource, signing kid, private-key path, and database URL are all set. A partial configuration aborts startup and does not publish discovery. The private key must live outside the repository. Access tokens are checked against a `jti` denylist and the account status on every MCP request, so a suspended or pending-deletion account loses access before the token expires. SQLite is accepted only for a `.test` issuer. A PostgreSQL URL does not create tables.

CIMD is not implemented. Dynamic client registration is. `registration_client_uri` is served by `GET /oauth/register/{client_id}`.

## Production requirements before enablement

1. Apply `supabase/migrations/007_mcp_oauth_grants.sql` only after review. It is not applied.
2. Set `OAUTH_ISSUER`, `OAUTH_RESOURCE`, `OAUTH_SIGNING_KID`, `OAUTH_SIGNING_KEY_PATH`, and `OAUTH_DATABASE_URL` on the VPS. Do not commit the key or the database URL.
3. Point the database URL at Postgres only after migration 007 is applied. Startup reads the tables and does not create them.
4. Keep API-key hashing, revocation, and REST authentication as they are. An MCP access token is rejected by REST.

## Not chosen

Using Supabase Auth itself as the MCP issuer would advertise the wrong audience and would not implement protected-resource metadata. A custom implicit flow or a shared client secret was rejected.
