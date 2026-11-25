-- Additive migration to align repository SQL with live public.daily_asset_closes columns.
-- Safe and idempotent on existing databases where source_timestamp and retrieved_at already exist.

ALTER TABLE public.daily_asset_closes
    ADD COLUMN IF NOT EXISTS source_timestamp timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.daily_asset_closes
    ADD COLUMN IF NOT EXISTS retrieved_at timestamptz NOT NULL DEFAULT now();
