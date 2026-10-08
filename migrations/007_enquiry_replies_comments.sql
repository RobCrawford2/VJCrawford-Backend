-- Migration 007: a log of replies and comments for each enquiry
--
-- Enquiries go back and forth: a reply arrives, it's not good enough, we
-- follow up, another reply arrives. Previously each new answer overwrote the
-- last. Replies (optionally linked to the email they came in) and internal
-- comments are now kept as separate, dated, attributed rows.
-- enquiries.answer stays as the latest reply, for lists and the report.

CREATE TABLE enquiry_replies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id       UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  reply            TEXT NOT NULL,
  date_received    DATE NOT NULL,
  source_email_id  UUID REFERENCES emails(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enquiry_replies_enquiry ON enquiry_replies(enquiry_id);

CREATE TABLE enquiry_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id  UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  comment     TEXT NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enquiry_comments_enquiry ON enquiry_comments(enquiry_id);

-- Carry existing answers and follow-up notes into the new logs.
INSERT INTO enquiry_replies (enquiry_id, reply, date_received, source_email_id)
  SELECT id, answer, coalesce(date_answered, date_raised), source_email_id
  FROM enquiries WHERE answer IS NOT NULL AND answer <> '';
INSERT INTO enquiry_comments (enquiry_id, comment)
  SELECT id, follow_up_notes FROM enquiries WHERE follow_up_notes IS NOT NULL AND follow_up_notes <> '';
