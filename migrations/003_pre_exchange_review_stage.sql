-- Migration 003: add the Pre-Exchange Review stage to the stage range
--
-- The frontend's stage tracker gained "Pre-Exchange Review" between
-- Report on Title and Exchange (12 stages, Closed = 11), but the schema and
-- API still allowed only 0..10. Moving a file to Closed was rejected, and
-- stage names in the activity log were one out from Pre-Exchange Review on.
-- Stored indexes already use the frontend's numbering (that's what the UI
-- has been sending), so only the allowed range changes.

ALTER TABLE matters DROP CONSTRAINT matters_current_stage_index_check;
ALTER TABLE matters ADD CONSTRAINT matters_current_stage_index_check
  CHECK (current_stage_index BETWEEN 0 AND 11);
