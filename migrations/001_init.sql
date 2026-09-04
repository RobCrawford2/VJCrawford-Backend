-- V J Crawford Conveyancing — Case Management System
-- Migration 001: initial schema
--
-- This replaces the single-JSON-blob storage model of the prototype with a
-- properly normalized relational schema: each matter's documents, emails,
-- enquiries, searches, undertakings and tasks are their own rows, not
-- fields inside one giant object. This is what makes per-record updates,
-- indexing, and pagination actually work at real caseload volume.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- Firms & users
-- ---------------------------------------------------------------------

CREATE TABLE firms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  domain      TEXT,                    -- used to build matter mailbox addresses
  stale_days  INT NOT NULL DEFAULT 14, -- inactivity threshold before a matter is flagged for review
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id        UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'fee_earner'
                   CHECK (role IN ('fee_earner', 'supervisor', 'admin')),
  supervisor_id  UUID REFERENCES users(id), -- who this user reports to, for team-level visibility
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_firm ON users(firm_id);

-- ---------------------------------------------------------------------
-- Matters
-- ---------------------------------------------------------------------

CREATE TABLE matters (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  reference                   TEXT NOT NULL,
  address                     TEXT NOT NULL,
  client                      TEXT NOT NULL,
  type                        TEXT NOT NULL CHECK (type IN ('Sale', 'Purchase', 'Remortgage')),
  price                       NUMERIC(12, 2),
  current_stage_index         INT NOT NULL DEFAULT 0 CHECK (current_stage_index BETWEEN 0 AND 10),

  fee_earner_id               UUID REFERENCES users(id),
  supervisor_id               UUID REFERENCES users(id),

  other_side_solicitor        TEXT,
  other_side_solicitor_email  TEXT,
  estate_agent                TEXT,
  lender                      TEXT,

  date_instructed             DATE,
  target_exchange             DATE,
  target_completion           DATE,
  actual_exchange             DATE,
  actual_completion           DATE,
  mortgage_offer_expiry       DATE,

  notes                       TEXT NOT NULL DEFAULT '',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (firm_id, reference)
);

-- These indexes are what keep matter lookups fast even with a large caseload:
-- "my matters" (fee_earner_id), "my team's matters" (supervisor_id), and the
-- default open/closed split (current_stage_index) are the three most common
-- queries, so each gets its own index rather than relying on a full scan.
CREATE INDEX idx_matters_firm ON matters(firm_id);
CREATE INDEX idx_matters_fee_earner ON matters(fee_earner_id);
CREATE INDEX idx_matters_supervisor ON matters(supervisor_id);
CREATE INDEX idx_matters_stage ON matters(current_stage_index);
-- Full-text search across the fields the sidebar search box matches on.
CREATE INDEX idx_matters_search ON matters USING gin (
  to_tsvector('english', coalesce(address, '') || ' ' || coalesce(client, '') || ' ' || coalesce(reference, ''))
);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_matters_updated_at
  BEFORE UPDATE ON matters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Chain / linked matters (reciprocal, self-referencing many-to-many)
CREATE TABLE matter_links (
  matter_id         UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  linked_matter_id  UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  PRIMARY KEY (matter_id, linked_matter_id),
  CHECK (matter_id <> linked_matter_id)
);

-- ---------------------------------------------------------------------
-- Documents (metadata now; storage_key is where a real S3/Azure Blob
-- pointer goes once file upload is built in phase 2)
-- ---------------------------------------------------------------------

CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  doc_date    DATE,
  notes       TEXT,
  storage_key TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_matter ON documents(matter_id);

-- ---------------------------------------------------------------------
-- Emails
-- ---------------------------------------------------------------------

CREATE TABLE emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id     UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  from_address  TEXT,
  to_address    TEXT,
  subject       TEXT NOT NULL,
  body          TEXT,
  email_date    DATE NOT NULL,
  -- Set once real Outlook integration (phase 2) exists, to avoid re-importing the same message.
  graph_message_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_emails_matter ON emails(matter_id);
CREATE UNIQUE INDEX idx_emails_graph_message ON emails(graph_message_id) WHERE graph_message_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Enquiries
-- ---------------------------------------------------------------------

CREATE TABLE enquiries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  number           INT NOT NULL,
  question         TEXT NOT NULL,
  date_raised      DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'Outstanding'
                     CHECK (status IN ('Outstanding', 'Pending Review', 'Answered')),
  answer           TEXT,
  date_answered    DATE,
  auto_filled      BOOLEAN NOT NULL DEFAULT false,
  source_email_id  UUID REFERENCES emails(id),
  follow_up_notes  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (matter_id, number)
);

CREATE INDEX idx_enquiries_matter ON enquiries(matter_id);
CREATE INDEX idx_enquiries_status ON enquiries(status);

-- ---------------------------------------------------------------------
-- Searches
-- ---------------------------------------------------------------------

CREATE TABLE searches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  date_ordered    DATE,
  expected_return DATE,
  date_received   DATE,
  issue           BOOLEAN NOT NULL DEFAULT false,
  issue_notes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_searches_matter ON searches(matter_id);

-- ---------------------------------------------------------------------
-- Undertakings
-- ---------------------------------------------------------------------

CREATE TABLE undertakings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id        UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('given', 'received')),
  description      TEXT NOT NULL,
  party            TEXT,
  date_given       DATE,
  status           TEXT NOT NULL DEFAULT 'Outstanding' CHECK (status IN ('Outstanding', 'Discharged')),
  date_discharged  DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_undertakings_matter ON undertakings(matter_id);
CREATE INDEX idx_undertakings_status ON undertakings(status);

-- ---------------------------------------------------------------------
-- Tasks / reminders
-- ---------------------------------------------------------------------

CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  due_date        DATE,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Done')),
  date_completed  DATE,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_matter ON tasks(matter_id);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);

-- ---------------------------------------------------------------------
-- Activity log (audit trail — who did what, when; required for SRA
-- record-keeping expectations, not just a UI nicety)
-- ---------------------------------------------------------------------

CREATE TABLE activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id    UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id),
  type         TEXT NOT NULL,
  text         TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_matter_date ON activity_log(matter_id, occurred_at DESC);
