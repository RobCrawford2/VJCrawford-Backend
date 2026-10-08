-- Migration 006: audit trail of staff account changes
--
-- Who added, changed, deactivated or reset the password of which staff
-- member, and when. Append-only from the application's point of view.

CREATE TABLE staff_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  target_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_audit_firm ON staff_audit(firm_id, occurred_at DESC);
