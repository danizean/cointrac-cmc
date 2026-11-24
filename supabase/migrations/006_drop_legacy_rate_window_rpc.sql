-- R6 Phase 5 — Drop the retired TradeGuard rate-window RPC.
-- STATUS: APPLIED to Development fflwfpmbyykyxhlhikwc after explicit approval.
-- The same statement must not be run against any other project.
-- Target, after approval: CoinTrac DEVELOPMENT (fflwfpmbyykyxhlhikwc) ONLY.
-- NEVER apply to Production or unrelated project udprwjbmrfknulngsjid.
--
-- This statement drops only public.tradeguard_consume_rate_window(TEXT, INTEGER).
-- It does not alter private.rate_windows, quota rows, or public.cointrac_consume_rate_window.
--
-- Rollback, before any drop: the application can still call the old function by
-- setting RATE_WINDOW_RPC back to "tradeguard_consume_rate_window". After this
-- drop, rollback requires recreating that function from
-- supabase/migrations/004_tenant_scope.sql. Quota rows stay in private.rate_windows.

DROP FUNCTION IF EXISTS public.tradeguard_consume_rate_window(TEXT, INTEGER);
