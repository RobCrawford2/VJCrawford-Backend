-- Migration 008: manager sign-off for stage moves
--
-- When a firm requires it, a fee earner's request to move a matter to
-- another stage waits here until the matter's supervisor or an admin
-- approves (the stage then moves) or declines it.

ALTER TABLE firms ADD COLUMN require_stage_signoff BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE stage_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id      UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  from_stage     INT NOT NULL,
  to_stage       INT NOT NULL CHECK (to_stage BETWEEN 0 AND 11),
  note           TEXT NOT NULL DEFAULT '',
  requested_by   UUID REFERENCES users(id),
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by     UUID REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_stage_requests_matter ON stage_requests(matter_id);
-- At most one open request per matter.
CREATE UNIQUE INDEX idx_stage_requests_one_pending ON stage_requests(matter_id) WHERE status = 'pending';
