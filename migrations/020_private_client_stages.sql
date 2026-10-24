-- Migration 020: Wills, Trusts & Probate — each type has its own stages
--
-- Wills, LPAs and trusts keep the same number of stages as before (8), so
-- their stage numbers carry over. Probate now has 9: its old "Closed" (7)
-- moves to the new "Closed" (8).

UPDATE matters SET current_stage_index = 8
WHERE department = 'private_client' AND type = 'Probate / estate administration' AND current_stage_index = 7;

UPDATE stage_requests r SET to_stage = 8
FROM matters m
WHERE m.id = r.matter_id AND m.department = 'private_client' AND m.type = 'Probate / estate administration'
  AND r.status = 'pending' AND r.to_stage = 7;
