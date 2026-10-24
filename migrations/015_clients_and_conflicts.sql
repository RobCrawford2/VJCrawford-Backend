-- Migration 015: client records, other parties, conflict checks
--
-- clients: the firm-wide client register — one record per person or
-- organisation, linked to each matter we act on for them (matter_clients),
-- with their ID / AML check. The matter keeps its own client name and
-- correspondence details (used in letters) alongside the link.
--
-- matter_parties: everyone else involved — the other side, opponents,
-- co-defendants, the deceased, beneficiaries, employers… — so the conflict
-- check can spot that we already act for, or against, someone.

CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id         UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  client_type     TEXT NOT NULL DEFAULT 'individual' CHECK (client_type IN ('individual', 'organisation')),
  name            TEXT NOT NULL,
  date_of_birth   DATE,
  company_number  TEXT,
  address         TEXT,
  email           TEXT,
  phone           TEXT,
  salutation      TEXT,
  id_verified_on  DATE,
  id_verified_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  id_method       TEXT,
  risk_level      TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  notes           TEXT NOT NULL DEFAULT '',
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_firm_name ON clients(firm_id, lower(name));

CREATE TABLE matter_clients (
  matter_id  UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (matter_id, client_id)
);
CREATE INDEX idx_matter_clients_client ON matter_clients(client_id);

CREATE TABLE matter_parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_matter_parties_matter ON matter_parties(matter_id);

ALTER TABLE matters
  ADD COLUMN conflict_checked_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN conflict_checked_at  TIMESTAMPTZ,
  ADD COLUMN conflict_check_note  TEXT;

-- Existing matters: one client record per client, linked back. The same
-- name is treated as the same client only when the email (or, failing
-- that, the address) also matches — otherwise each matter gets its own.
CREATE TEMP TABLE matter_client_keys AS
SELECT id AS matter_id, firm_id, trim(client) AS name, client_address, client_email, client_phone, client_salutation, created_at,
       lower(trim(client)) || '|' || coalesce(lower(nullif(trim(client_email), '')), lower(nullif(trim(client_address), '')), id::text) AS key
FROM matters;

CREATE TEMP TABLE client_keys AS
SELECT DISTINCT ON (firm_id, key) gen_random_uuid() AS client_id, firm_id, key, name, client_address, client_email, client_phone, client_salutation
FROM matter_client_keys ORDER BY firm_id, key, created_at DESC;

INSERT INTO clients (id, firm_id, name, address, email, phone, salutation)
SELECT client_id, firm_id, name, client_address, client_email, client_phone, client_salutation FROM client_keys;

INSERT INTO matter_clients (matter_id, client_id)
SELECT mk.matter_id, ck.client_id FROM matter_client_keys mk JOIN client_keys ck ON ck.firm_id = mk.firm_id AND ck.key = mk.key;

DROP TABLE matter_client_keys;
DROP TABLE client_keys;
