-- Migration 012: SDLT buyer type, critical-date fields, exchange checks
--
-- sdlt_buyer_type / sdlt_non_resident feed the SDLT calculator.
-- deposit_received_date is one of the checks before exchange.
-- os1_priority_expiry (Land Registry search priority period) and
-- lease_years_remaining drive critical-date / risk warnings.
-- firms.require_exchange_checks lets a firm switch the exchange gate off.

ALTER TABLE matters
  ADD COLUMN sdlt_buyer_type        TEXT CHECK (sdlt_buyer_type IN ('standard', 'first_time', 'additional')),
  ADD COLUMN sdlt_non_resident      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN deposit_received_date  DATE,
  ADD COLUMN os1_priority_expiry    DATE,
  ADD COLUMN lease_years_remaining  INT CHECK (lease_years_remaining >= 0);

ALTER TABLE firms ADD COLUMN require_exchange_checks BOOLEAN NOT NULL DEFAULT true;
