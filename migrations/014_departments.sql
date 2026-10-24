-- Migration 014: departments (areas of law) and department-based access
--
-- Every matter belongs to a department; the list of departments, their
-- matter types and stages live in src/config/areas.js. A firm switches on
-- the departments it runs (firm_departments). Staff are given access to
-- one or more departments (user_departments), or to all of them
-- (users.all_departments, for partners / compliance). Admins always see
-- everything. Existing firms, staff and matters become Conveyancing.

ALTER TABLE matters ADD COLUMN department TEXT NOT NULL DEFAULT 'conveyancing';
CREATE INDEX idx_matters_firm_department ON matters(firm_id, department);

-- Matter types and stage ranges now depend on the department, so they're
-- checked by the application instead of fixed lists here.
ALTER TABLE matters DROP CONSTRAINT IF EXISTS matters_type_check;
ALTER TABLE matters DROP CONSTRAINT IF EXISTS matters_current_stage_index_check;
ALTER TABLE matters ADD CONSTRAINT matters_current_stage_index_check CHECK (current_stage_index >= 0 AND current_stage_index < 30);
ALTER TABLE stage_requests DROP CONSTRAINT IF EXISTS stage_requests_from_stage_check;
ALTER TABLE stage_requests DROP CONSTRAINT IF EXISTS stage_requests_to_stage_check;

CREATE TABLE firm_departments (
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  department  TEXT NOT NULL,
  PRIMARY KEY (firm_id, department)
);
INSERT INTO firm_departments (firm_id, department) SELECT id, 'conveyancing' FROM firms;

CREATE TABLE user_departments (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department  TEXT NOT NULL,
  PRIMARY KEY (user_id, department)
);
INSERT INTO user_departments (user_id, department) SELECT id, 'conveyancing' FROM users;

ALTER TABLE users ADD COLUMN all_departments BOOLEAN NOT NULL DEFAULT false;
