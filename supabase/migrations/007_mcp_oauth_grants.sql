-- Proposed only. Do not apply until explicitly approved.
-- Persistent MCP OAuth grants. Service role only. No anonymous or user access.
-- The application does not create these tables at startup.

create table if not exists private.oauth_clients (
    client_id text primary key,
    client_name text not null,
    redirect_uris text not null,
    created_at bigint not null
);

create table if not exists private.oauth_authorization_requests (
    request_id text primary key,
    client_id text not null,
    redirect_uri text not null,
    code_challenge text not null,
    state text not null,
    scope text not null,
    resource text not null,
    csrf_token text not null,
    expires_at bigint not null
);

create table if not exists private.oauth_authorization_codes (
    code_hash text primary key,
    client_id text not null,
    redirect_uri text not null,
    code_challenge text not null,
    user_id uuid not null,
    scope text not null,
    resource text not null,
    expires_at bigint not null,
    used_at bigint
);

create table if not exists private.oauth_refresh_tokens (
    token_hash text primary key,
    family_id uuid not null,
    client_id text not null,
    user_id uuid not null,
    scope text not null,
    resource text not null,
    expires_at bigint not null,
    used_at bigint
);

create table if not exists private.oauth_access_denylist (
    jti text primary key,
    expires_at bigint not null
);

create table if not exists private.oauth_consents (
    user_id uuid not null,
    client_id text not null,
    scope text not null,
    approved_at bigint not null,
    primary key (user_id, client_id, scope)
);

create index if not exists oauth_requests_expires_idx
    on private.oauth_authorization_requests (expires_at);
create index if not exists oauth_refresh_family_idx
    on private.oauth_refresh_tokens (family_id);
create index if not exists oauth_codes_expires_idx
    on private.oauth_authorization_codes (expires_at);
create index if not exists oauth_denylist_expires_idx
    on private.oauth_access_denylist (expires_at);

alter table private.oauth_clients enable row level security;
alter table private.oauth_authorization_requests enable row level security;
alter table private.oauth_authorization_codes enable row level security;
alter table private.oauth_refresh_tokens enable row level security;
alter table private.oauth_access_denylist enable row level security;
alter table private.oauth_consents enable row level security;

revoke all on private.oauth_clients from anon, authenticated;
revoke all on private.oauth_authorization_requests from anon, authenticated;
revoke all on private.oauth_authorization_codes from anon, authenticated;
revoke all on private.oauth_refresh_tokens from anon, authenticated;
revoke all on private.oauth_access_denylist from anon, authenticated;
revoke all on private.oauth_consents from anon, authenticated;

grant select, insert, update, delete on private.oauth_clients to service_role;
grant select, insert, update, delete on private.oauth_authorization_requests to service_role;
grant select, insert, update, delete on private.oauth_authorization_codes to service_role;
grant select, insert, update, delete on private.oauth_refresh_tokens to service_role;
grant select, insert, update, delete on private.oauth_access_denylist to service_role;
grant select, insert, update, delete on private.oauth_consents to service_role;

-- Rollback: drop the six private tables above. Do not drop profiles, api_keys, or rate windows.
