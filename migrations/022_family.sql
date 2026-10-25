-- Migration 022: Family
--
-- 1. matters.pc_details becomes matters.details — it now holds the details of
--    family matters too (marriage, hearings, orders…), see src/config/matterDetails.js.
-- 2. Each type of family matter has its own stages. Divorce and children
--    keep 9 stages (numbers carry over). Financial settlements now have 10
--    and injunctions 8, so their later stages are renumbered.
-- 3. family_assets: the financial remedy asset schedule.
--    family_children: the children on a family matter.

ALTER TABLE matters RENAME COLUMN pc_details TO details;

-- Financial settlement: old 6 "Agreement or order" → 7, 7 "Final order" → 8 "Implementation", 8 "Closed" → 9.
UPDATE matters SET current_stage_index = current_stage_index + 1
WHERE department = 'family' AND type = 'Financial settlement' AND current_stage_index >= 6;
UPDATE stage_requests r SET to_stage = r.to_stage + 1 FROM matters m
WHERE m.id = r.matter_id AND m.department = 'family' AND m.type = 'Financial settlement' AND r.status = 'pending' AND r.to_stage >= 6;

-- Injunction: old 7 "Final order" → 6, 8 "Closed" → 7.
UPDATE matters SET current_stage_index = current_stage_index - 1
WHERE department = 'family' AND type = 'Injunction / domestic abuse' AND current_stage_index >= 7;
UPDATE stage_requests r SET to_stage = r.to_stage - 1 FROM matters m
WHERE m.id = r.matter_id AND m.department = 'family' AND m.type = 'Injunction / domestic abuse' AND r.status = 'pending' AND r.to_stage >= 7;

CREATE TABLE family_assets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id                UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  kind                     TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'pension')),
  owner                    TEXT NOT NULL CHECK (owner IN ('client', 'other', 'joint')),
  category                 TEXT NOT NULL,
  description              TEXT NOT NULL,
  value                    NUMERIC(14,2) NOT NULL DEFAULT 0,
  proposed_client_percent  NUMERIC(6,2) CHECK (proposed_client_percent BETWEEN 0 AND 100),
  source                   TEXT,
  notes                    TEXT NOT NULL DEFAULT '',
  created_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_family_assets_matter ON family_assets(matter_id);

CREATE TABLE family_children (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id      UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  date_of_birth  DATE,
  lives_with     TEXT,
  school         TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_family_children_matter ON family_children(matter_id);
