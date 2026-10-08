-- Migration 005: client contact, property/title and money details
--
-- Facts every conveyancing file needs and the Report on Title draws on —
-- previously only placeholders in the report. All optional.

ALTER TABLE matters
  ADD COLUMN client_address         TEXT,
  ADD COLUMN client_email           TEXT,
  ADD COLUMN client_phone           TEXT,
  ADD COLUMN client_salutation      TEXT,
  ADD COLUMN tenure                 TEXT CHECK (tenure IN ('Freehold', 'Leasehold', 'Share of freehold', 'Commonhold')),
  ADD COLUMN title_number           TEXT,
  ADD COLUMN registered_proprietor  TEXT,
  ADD COLUMN lease_term             TEXT,
  ADD COLUMN ground_rent            TEXT,
  ADD COLUMN service_charge         TEXT,
  ADD COLUMN deposit                NUMERIC(12, 2),
  ADD COLUMN sdlt                   NUMERIC(12, 2),
  ADD COLUMN mortgage_conditions    TEXT;
