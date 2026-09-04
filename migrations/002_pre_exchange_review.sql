-- Migration 002: Pre-Exchange Review
--
-- Added after the initial schema — the case management app grew a
-- pre-exchange sign-off checklist (checked items + who/when confirmed)
-- that the original matters table didn't account for. Adding it here
-- rather than leaving the frontend feature silently non-persistent.

ALTER TABLE matters
  ADD COLUMN pre_exchange_checklist JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN pre_exchange_confirmed_by TEXT,
  ADD COLUMN pre_exchange_confirmed_date DATE;
