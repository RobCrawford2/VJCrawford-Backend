-- Migration 028: demo logins move to @vjcrawfordlaw.co.uk to match the new
-- name. Only the demo firm's staff (and its mailbox domain) change, so the
-- new logins work straight away without reloading the demo data. Real
-- firms are untouched.

UPDATE users u
SET email = replace(u.email, '@vjcrawfordconveyancing.co.uk', '@vjcrawfordlaw.co.uk')
FROM firms f
WHERE f.id = u.firm_id
  AND f.name IN ('V J Crawford Law (Demo)', 'V J Crawford Conveyancing (Demo)')
  AND u.email LIKE '%@vjcrawfordconveyancing.co.uk'
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.email = replace(u.email, '@vjcrawfordconveyancing.co.uk', '@vjcrawfordlaw.co.uk'));

UPDATE firms SET domain = 'vjcrawfordlaw.co.uk'
WHERE name IN ('V J Crawford Law (Demo)', 'V J Crawford Conveyancing (Demo)') AND domain = 'vjcrawfordconveyancing.co.uk';
