-- Proposal migration. DO NOT APPLY without owner approval.
-- Depends on 009_daily_asset_closes.sql. Does not create the table.
--
-- The first stored observation for (cmc_id, utc_date) is immutable.
-- source_timestamp is the quote or CMC status time.
-- retrieved_at is when CoinTrac observed the listings snapshot.
-- Rows remain observed listing references, not official CMC OHLCV closes.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS daily_asset_closes_immutable ON public.daily_asset_closes;
--   DROP FUNCTION IF EXISTS private.prevent_daily_asset_close_update();
--   ALTER TABLE public.daily_asset_closes DROP COLUMN IF EXISTS source_timestamp;
--   ALTER TABLE public.daily_asset_closes DROP COLUMN IF EXISTS retrieved_at;
--   GRANT UPDATE ON TABLE public.daily_asset_closes TO service_role;

BEGIN;

ALTER TABLE public.daily_asset_closes
    ADD COLUMN IF NOT EXISTS source_timestamp timestamptz,
    ADD COLUMN IF NOT EXISTS retrieved_at timestamptz;

COMMENT ON COLUMN public.daily_asset_closes.source_timestamp IS
    'UTC timestamp from the CMC quote or status. Not an official OHLCV close time.';
COMMENT ON COLUMN public.daily_asset_closes.retrieved_at IS
    'UTC time CoinTrac retrieved the listings snapshot that contained this price.';
COMMENT ON TABLE public.daily_asset_closes IS
    'First observed daily reference price per cmc_id and UTC date. Immutable. Not official CMC OHLCV.';

CREATE OR REPLACE FUNCTION private.prevent_daily_asset_close_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'daily_asset_closes observations are immutable'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS daily_asset_closes_immutable ON public.daily_asset_closes;
CREATE TRIGGER daily_asset_closes_immutable
    BEFORE UPDATE ON public.daily_asset_closes
    FOR EACH ROW
    EXECUTE FUNCTION private.prevent_daily_asset_close_update();

REVOKE ALL ON FUNCTION private.prevent_daily_asset_close_update()
    FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON TABLE public.daily_asset_closes FROM service_role;

COMMIT;
