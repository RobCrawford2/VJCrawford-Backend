-- Migration 016: court and deadline diary
--
-- Hearings, limitation dates, court-ordered deadlines and filing dates on
-- each matter. "Critical" ones (limitation, court deadlines) get earlier and
-- louder warnings; the firm diary shows them to the fee earner and to
-- anyone supervising them.

CREATE TABLE deadlines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('hearing', 'limitation', 'court_deadline', 'filing', 'other')),
  title       TEXT NOT NULL,
  due_date    DATE NOT NULL,
  due_time    TIME,
  location    TEXT,
  notes       TEXT,
  critical    BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  done_at     TIMESTAMPTZ,
  done_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deadlines_matter ON deadlines(matter_id);
CREATE INDEX idx_deadlines_open_due ON deadlines(due_date) WHERE status = 'open';
