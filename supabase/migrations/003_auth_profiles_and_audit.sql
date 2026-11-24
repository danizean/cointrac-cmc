-- Stage 5.1: Authentication & User Identity Foundation
-- Next sequential migration after:
--   001_initial_schema.sql
--   002_verified_sector_mappings.sql
--
-- Target Environment: TradeGuard DEVELOPMENT (fflwfpmbyykyxhlhikwc) ONLY.
-- NEVER apply to unrelated project udprwjbmrfknulngsjid or unapproved production.
--
-- Safety & Security Guarantees:
--   1. Strictly additive and idempotent (CREATE IF NOT EXISTS / OR REPLACE).
--   2. Does NOT modify api_keys, market_assets, cmc_snapshots, evidence_records,
--      request_logs, or sector_mappings.
--   3. Creates private schema revoked from PUBLIC, anon, and authenticated so
--      PostgREST cannot expose private.audit_logs.
--   4. Enables + forces RLS on public.profiles with strict own-row policies only
--      (NO USING (true) policy).
--   5. Restricts authenticated UPDATE privileges at column level (display_name
--      only) AND adds a BEFORE UPDATE defense-in-depth trigger so
--      authenticated users can NEVER modify base_plan_code, account_status,
--      email_verified_at, deleted_at, or email (while the trigger stamps updated_at).
--   6. Provisioning trigger NEVER reads auth.users.raw_user_meta_data for any
--      authorization, plan, or account-status decision.
--   7. Does NOT create premature plans/entitlements tables (deferred to Stage 5.3).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Non-exposed private schema for security audit logs & isolated trigger functions
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- 2. Canonical user identity profile (1:1 with auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  base_plan_code TEXT NOT NULL DEFAULT 'free' CHECK (base_plan_code IN ('free')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK (
    account_status IN ('active', 'restricted', 'suspended', 'pending_deletion')
  ),
  email_verified_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_lower
  ON public.profiles (LOWER(email))
  WHERE email <> '';
CREATE INDEX IF NOT EXISTS idx_profiles_account_status
  ON public.profiles (account_status);

-- 3. Immutable security & identity audit log (private schema — not exposed via PostgREST)
CREATE TABLE IF NOT EXISTS private.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_user_id UUID,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'admin')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_private_audit_logs_actor_time
  ON private.audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_audit_logs_action_time
  ON private.audit_logs (action, occurred_at DESC);

REVOKE ALL ON TABLE private.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.audit_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.audit_logs_id_seq TO service_role;

-- 4. Defense-in-depth BEFORE UPDATE guard on public.profiles
-- Prevents any non-service-role session from mutating sensitive identity/plan fields
-- even if a broad UPDATE grant were accidentally introduced later.
CREATE OR REPLACE FUNCTION private.guard_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.base_plan_code IS DISTINCT FROM OLD.base_plan_code
       OR NEW.account_status IS DISTINCT FROM OLD.account_status
       OR NEW.email_verified_at IS DISTINCT FROM OLD.email_verified_at
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Modification of protected profile fields is forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_profile_sensitive_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_guard_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_profile_sensitive_columns();

-- 5. Minimal, audited SECURITY DEFINER provisioning trigger on auth.users
-- Strictly ignores NEW.raw_user_meta_data and hardcodes safe defaults ('free', 'active').
CREATE OR REPLACE FUNCTION private.handle_auth_user_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT;
BEGIN
  v_email := LOWER(COALESCE(NEW.email, ''));

  INSERT INTO public.profiles (
    id,
    email,
    base_plan_code,
    account_status,
    email_verified_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    v_email,
    'free',
    'active',
    NEW.email_confirmed_at,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at = NOW();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO private.audit_logs (actor_user_id, actor_type, action, target_type, target_id, metadata)
    VALUES (
      NEW.id,
      'system',
      'user_profile_provisioned',
      'profile',
      NEW.id::TEXT,
      jsonb_build_object('email_verified', NEW.email_confirmed_at IS NOT NULL)
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW.email_confirmed_at IS NOT NULL
    AND NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at THEN
    INSERT INTO private.audit_logs (actor_user_id, actor_type, action, target_type, target_id, metadata)
    VALUES (
      NEW.id,
      'system',
      'user_email_verified',
      'profile',
      NEW.id::TEXT,
      jsonb_build_object('verified_at', NEW.email_confirmed_at)
    );
  ELSIF TG_OP = 'UPDATE'
    AND OLD.email_confirmed_at IS NOT NULL
    AND NEW.email_confirmed_at IS NULL THEN
    INSERT INTO private.audit_logs (actor_user_id, actor_type, action, target_type, target_id, metadata)
    VALUES (
      NEW.id,
      'system',
      'user_email_verification_cleared',
      'profile',
      NEW.id::TEXT,
      jsonb_build_object('email_changed', LOWER(COALESCE(OLD.email, '')) IS DISTINCT FROM v_email)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_auth_user_sync() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_auth_users_profile_sync ON auth.users;
CREATE TRIGGER trg_auth_users_profile_sync
  AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_auth_user_sync();

-- 6. Row-Level Security & Column-Level Privileges on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (display_name) ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

COMMIT;
