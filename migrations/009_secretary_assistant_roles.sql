-- Migration 009: secretary and assistant roles
--
-- Conveyancing teams are usually secretary → assistant → fee earner. A
-- secretary or assistant works for a fee earner (users.supervisor_id points
-- at that fee earner) and sees that fee earner's matters. Stage sign-off
-- now follows this chain: the matter's fee earner (or their supervisor)
-- signs off; admin is a system role and doesn't.

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('secretary', 'assistant', 'fee_earner', 'supervisor', 'admin'));
