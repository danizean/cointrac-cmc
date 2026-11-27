-- CoinTrac AI (Muse Spark 1.3) + Super Admin Governance Schema
-- Additive, idempotent migration on CoinTrac database.

BEGIN;

-- 1. Server-authoritative platform_role on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS platform_role TEXT NOT NULL DEFAULT 'user'
  CHECK (platform_role IN ('user', 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_platform_role
  ON public.profiles (platform_role);

-- Harden sensitive column guard trigger to also block non-service_role platform_role changes
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
       OR NEW.platform_role IS DISTINCT FROM OLD.platform_role
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

-- 2. Global CoinTrac AI runtime configuration (single-row, server-only)
CREATE TABLE IF NOT EXISTS public.ai_runtime_config (
  id TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  provider TEXT NOT NULL DEFAULT 'meta_muse',
  base_url TEXT NOT NULL DEFAULT 'https://api.meta.ai/v1',
  model TEXT NOT NULL DEFAULT 'muse-spark-1.3',
  api_key_secret TEXT,
  default_rate_limit_per_min INTEGER NOT NULL DEFAULT 10 CHECK (default_rate_limit_per_min BETWEEN 1 AND 240),
  default_daily_requests INTEGER NOT NULL DEFAULT 50 CHECK (default_daily_requests BETWEEN 1 AND 10000),
  default_daily_tokens INTEGER NOT NULL DEFAULT 150000 CHECK (default_daily_tokens BETWEEN 1000 AND 10000000),
  max_tool_rounds INTEGER NOT NULL DEFAULT 4 CHECK (max_tool_rounds BETWEEN 1 AND 8),
  max_output_tokens INTEGER NOT NULL DEFAULT 900 CHECK (max_output_tokens BETWEEN 128 AND 4096),
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.20 CHECK (temperature >= 0 AND temperature <= 1),
  response_cache_ttl_seconds INTEGER NOT NULL DEFAULT 120 CHECK (response_cache_ttl_seconds BETWEEN 0 AND 3600),
  system_directive TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.ai_runtime_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ai_runtime_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_runtime_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_runtime_config TO service_role;

-- 3. Per-user AI rate limit & quota overrides managed by Super Admin
CREATE TABLE IF NOT EXISTS public.ai_user_limits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_per_min INTEGER CHECK (rate_limit_per_min IS NULL OR rate_limit_per_min BETWEEN 1 AND 240),
  daily_requests_limit INTEGER CHECK (daily_requests_limit IS NULL OR daily_requests_limit BETWEEN 1 AND 10000),
  daily_tokens_limit INTEGER CHECK (daily_tokens_limit IS NULL OR daily_tokens_limit BETWEEN 1000 AND 10000000),
  notes TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_user_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_user_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ai_user_limits TO service_role;

-- 4. CoinTrac AI execution & token/rate-limit audit logs
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OK', 'CACHED', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'DISABLED', 'ERROR')),
  prompt_summary TEXT NOT NULL DEFAULT '',
  tools_called TEXT[] NOT NULL DEFAULT '{}',
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  tool_calls_count INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_created
  ON public.ai_usage_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created
  ON public.ai_usage_logs (created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_usage_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage_logs TO authenticated;
GRANT ALL ON TABLE public.ai_usage_logs TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_usage_logs'
      AND policyname = 'ai_usage_logs_select_own'
  ) THEN
    CREATE POLICY ai_usage_logs_select_own
      ON public.ai_usage_logs
      FOR SELECT
      TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

COMMIT;
