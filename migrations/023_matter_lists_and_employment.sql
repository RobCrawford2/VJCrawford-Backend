-- Migration 023: registers kept on matters, and employment's stages
--
-- matter_list_items holds the lists defined per department in
-- src/config/practice (Part 36 offers, schedule of loss, charges, transaction
-- checklists…): one row per item, its values in `data`.
--
-- Employment claims now have 11 stages and settlement agreements 8 (was 9):
-- a closed matter stays closed; the rest keep their stage number, within range.

CREATE TABLE matter_list_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  list        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  position    INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_matter_list_items_matter ON matter_list_items(matter_id, list);

UPDATE matters SET current_stage_index = 10
WHERE department = 'employment' AND type IN ('Tribunal claim — for employee', 'Tribunal claim — for employer') AND current_stage_index = 8;
UPDATE matters SET current_stage_index = CASE WHEN current_stage_index = 8 THEN 7 ELSE LEAST(current_stage_index, 6) END
WHERE department = 'employment' AND type = 'Settlement agreement';
UPDATE stage_requests r SET to_stage = CASE WHEN m.type = 'Settlement agreement' THEN LEAST(r.to_stage, 7) ELSE CASE WHEN r.to_stage = 8 THEN 10 ELSE r.to_stage END END
FROM matters m
WHERE m.id = r.matter_id AND m.department = 'employment' AND r.status = 'pending';
