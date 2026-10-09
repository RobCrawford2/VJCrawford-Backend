-- Migration 011: firm-level switch for browser dictation
--
-- The dictation (microphone) buttons use the browser's own speech
-- recognition, which sends audio to the browser vendor (Google for Chrome,
-- Microsoft for Edge). On by default; a firm can turn it off if its
-- data-protection policy doesn't allow that.

ALTER TABLE firms ADD COLUMN dictation_enabled BOOLEAN NOT NULL DEFAULT true;
