-- Migration 017: time recording and billing
--
-- Fee earners have an hourly rate; time is recorded on a matter in 6-minute
-- units at the rate in force when it was recorded. Each matter has a
-- funding type (hourly / fixed fee / no win no fee / legal aid) and the
-- costs estimate (or fixed fee) given to the client. Bills are drafted from
-- unbilled time plus disbursements; issuing one gives it the firm's next
-- bill number and locks the time on it.

ALTER TABLE users ADD COLUMN hourly_rate NUMERIC(8, 2);

ALTER TABLE matters
  ADD COLUMN funding TEXT NOT NULL DEFAULT 'hourly' CHECK (funding IN ('hourly', 'fixed_fee', 'cfa', 'legal_aid')),
  ADD COLUMN fee_estimate NUMERIC(12, 2);
UPDATE matters SET funding = 'fixed_fee' WHERE department = 'conveyancing';

CREATE TABLE bills (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id            UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  bill_number          INT,
  bill_date            DATE,
  profit_costs         NUMERIC(12, 2) NOT NULL,
  disbursements        JSONB NOT NULL DEFAULT '[]',
  vat                  NUMERIC(12, 2) NOT NULL,
  total                NUMERIC(12, 2) NOT NULL,
  narrative            TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'cancelled')),
  created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  issued_at            TIMESTAMPTZ,
  cancelled_reason     TEXT,
  UNIQUE (firm_id, bill_number)
);
CREATE INDEX idx_bills_matter ON bills(matter_id);

CREATE TABLE time_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  work_date    DATE NOT NULL,
  units        INT NOT NULL CHECK (units BETWEEN 1 AND 240),
  rate         NUMERIC(8, 2) NOT NULL DEFAULT 0,
  amount       NUMERIC(12, 2) NOT NULL,
  activity     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  billable     BOOLEAN NOT NULL DEFAULT true,
  bill_id      UUID REFERENCES bills(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_matter ON time_entries(matter_id);
CREATE INDEX idx_time_user_date ON time_entries(user_id, work_date);
