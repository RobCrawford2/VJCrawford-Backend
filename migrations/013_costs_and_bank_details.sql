-- Migration 013: completion statement figures and client bank details
--
-- Completion statement: mortgage advance, redemption figure, agent's fee,
-- money already received on account, and a list of fees/disbursements
-- (costs: [{ description, amount, vat }], amounts ex VAT).
--
-- client_bank_details: the account completion monies go to (sales /
-- remortgage surplus). Each new set of details starts unverified and the
-- previous set is superseded; funds shouldn't go until the current set is
-- verified (e.g. by phone to a number already on file).

ALTER TABLE matters
  ADD COLUMN mortgage_advance   NUMERIC(12, 2),
  ADD COLUMN redemption_amount  NUMERIC(12, 2),
  ADD COLUMN agent_fee          NUMERIC(12, 2),
  ADD COLUMN funds_received     NUMERIC(12, 2),
  ADD COLUMN costs              JSONB NOT NULL DEFAULT '[]';

CREATE TABLE client_bank_details (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  account_name     TEXT NOT NULL,
  sort_code        TEXT NOT NULL,
  account_number   TEXT NOT NULL,
  bank_name        TEXT,
  status           TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'superseded')),
  entered_by       UUID REFERENCES users(id),
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_by      UUID REFERENCES users(id),
  verified_at      TIMESTAMPTZ,
  verification_method TEXT,
  verification_note   TEXT
);
CREATE INDEX idx_bank_details_matter ON client_bank_details(matter_id);
