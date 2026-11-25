-- Proposal migration. DO NOT APPLY without owner approval.
-- Depends on 009_daily_asset_closes.sql and 011_daily_asset_closes_immutable.sql.
-- Does not insert, update, or delete observations.
--
-- 009 granted DELETE to service_role. 011 revoked UPDATE and blocked UPDATE
-- with a trigger, but DELETE remained. This migration closes that gap.
--
-- Rollback does not restore DELETE. Opening historical deletion again needs
-- a separate migration that the owner explicitly approves. Removing only the
-- guard, if a later approved design replaces it, is:
--   DROP TRIGGER IF EXISTS daily_asset_closes_no_truncate ON public.daily_asset_closes;
--   DROP TRIGGER IF EXISTS daily_asset_closes_no_delete ON public.daily_asset_closes;
--   DROP FUNCTION IF EXISTS private.prevent_daily_asset_close_delete();
-- Do not add GRANT DELETE in that rollback.

BEGIN;

CREATE OR REPLACE FUNCTION private.prevent_daily_asset_close_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'daily_asset_closes observations cannot be deleted'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS daily_asset_closes_no_delete ON public.daily_asset_closes;
CREATE TRIGGER daily_asset_closes_no_delete
    BEFORE DELETE ON public.daily_asset_closes
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_daily_asset_close_delete();

DROP TRIGGER IF EXISTS daily_asset_closes_no_truncate ON public.daily_asset_closes;
CREATE TRIGGER daily_asset_closes_no_truncate
    BEFORE TRUNCATE ON public.daily_asset_closes
    FOR EACH STATEMENT
    EXECUTE FUNCTION private.prevent_daily_asset_close_delete();

REVOKE ALL ON FUNCTION private.prevent_daily_asset_close_delete()
    FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE ON TABLE public.daily_asset_closes
    FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
