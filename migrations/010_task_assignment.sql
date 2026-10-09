-- Migration 010: assign tasks to people
--
-- Each task can be assigned to one member of staff (who must be able to see
-- the matter). Unassigned tasks stay NULL.

ALTER TABLE tasks ADD COLUMN assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_assigned_open ON tasks(assigned_to) WHERE status = 'Open';
