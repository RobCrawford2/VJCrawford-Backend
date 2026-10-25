-- Migration 025: criminal matters have their own stages by type
--
-- Police station 6 stages, magistrates' 8, Crown Court 10, appeal 7 (was 9
-- for all). A closed matter stays closed; the rest keep their stage number,
-- within the new range.

UPDATE matters SET current_stage_index = CASE
    WHEN type = 'Police station' THEN CASE WHEN current_stage_index >= 8 THEN 5 ELSE LEAST(current_stage_index, 4) END
    WHEN type = 'Magistrates'' court' THEN CASE WHEN current_stage_index >= 8 THEN 7 ELSE LEAST(current_stage_index, 6) END
    WHEN type = 'Crown Court' THEN CASE WHEN current_stage_index >= 8 THEN 9 ELSE current_stage_index END
    WHEN type = 'Appeal' THEN CASE WHEN current_stage_index >= 8 THEN 6 ELSE LEAST(current_stage_index, 5) END
    ELSE current_stage_index END
WHERE department = 'crime';

UPDATE stage_requests r SET to_stage = CASE
    WHEN m.type = 'Police station' THEN CASE WHEN r.to_stage >= 8 THEN 5 ELSE LEAST(r.to_stage, 4) END
    WHEN m.type = 'Magistrates'' court' THEN CASE WHEN r.to_stage >= 8 THEN 7 ELSE LEAST(r.to_stage, 6) END
    WHEN m.type = 'Crown Court' THEN CASE WHEN r.to_stage >= 8 THEN 9 ELSE r.to_stage END
    WHEN m.type = 'Appeal' THEN CASE WHEN r.to_stage >= 8 THEN 6 ELSE LEAST(r.to_stage, 5) END
    ELSE r.to_stage END
FROM matters m
WHERE m.id = r.matter_id AND m.department = 'crime' AND r.status = 'pending';
