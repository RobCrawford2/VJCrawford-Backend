-- Migration 024: corporate types have their own stages
--
-- Share deals now have 9 stages (was 8); formations, commercial contracts
-- and shareholders' agreements have 7. A closed matter stays closed; the
-- rest keep their stage number, within the new range.

UPDATE matters SET current_stage_index = CASE WHEN current_stage_index >= 7 THEN 8 ELSE current_stage_index END
WHERE department = 'corporate' AND type IN ('Share sale', 'Share purchase');

UPDATE matters SET current_stage_index = CASE WHEN current_stage_index >= 7 THEN 6 ELSE LEAST(current_stage_index, 5) END
WHERE department = 'corporate' AND type IN ('Company formation', 'Commercial contract', 'Shareholders'' agreement');

UPDATE stage_requests r SET to_stage = CASE
    WHEN m.type IN ('Share sale', 'Share purchase') THEN CASE WHEN r.to_stage >= 7 THEN 8 ELSE r.to_stage END
    ELSE CASE WHEN r.to_stage >= 7 THEN 6 ELSE LEAST(r.to_stage, 5) END END
FROM matters m
WHERE m.id = r.matter_id AND m.department = 'corporate' AND m.type <> 'Other corporate' AND r.status = 'pending';
