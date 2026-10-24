-- Migration 021: Wills, Trusts & Probate
--
--   matters.pc_details     the type's details (deceased, grant, LPA attorneys…), see src/config/privateClient.js
--   estate_items           probate: the estate's assets and liabilities
--   estate_beneficiaries   probate: who inherits what, and what's been paid
--   safe_custody           the firm's register of original wills, LPAs and deeds held

ALTER TABLE matters ADD COLUMN pc_details JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE estate_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id           UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
  category            TEXT NOT NULL,
  description         TEXT NOT NULL,
  holder              TEXT,
  holder_address      TEXT,
  reference           TEXT,
  value_at_death      NUMERIC(14,2),
  value_realised      NUMERIC(14,2),
  passes_outside_will BOOLEAN NOT NULL DEFAULT false,
  status              TEXT NOT NULL DEFAULT 'To notify',
  notified_on         DATE,
  notes               TEXT NOT NULL DEFAULT '',
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estate_items_matter ON estate_items(matter_id);

CREATE TABLE estate_beneficiaries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id      UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relationship   TEXT,
  gift_type      TEXT NOT NULL,
  description    TEXT,
  amount         NUMERIC(14,2),
  share_percent  NUMERIC(6,3),
  exemption      TEXT CHECK (exemption IN ('spouse', 'charity')),
  paid_amount    NUMERIC(14,2),
  paid_on        DATE,
  receipt_on     DATE,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estate_beneficiaries_matter ON estate_beneficiaries(matter_id);

CREATE TABLE safe_custody (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  matter_id       UUID REFERENCES matters(id) ON DELETE SET NULL,
  department      TEXT NOT NULL DEFAULT 'private_client',
  doc_type        TEXT NOT NULL,
  person          TEXT NOT NULL,
  document_date   DATE,
  location        TEXT NOT NULL,
  received_on     DATE NOT NULL,
  withdrawn_on    DATE,
  withdrawn_to    TEXT,
  withdrawn_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_safe_custody_firm ON safe_custody(firm_id, lower(person));
CREATE INDEX idx_safe_custody_matter ON safe_custody(matter_id) WHERE matter_id IS NOT NULL;
