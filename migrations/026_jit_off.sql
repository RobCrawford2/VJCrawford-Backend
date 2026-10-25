-- Migration 026: switch off JIT compilation for this database
--
-- JIT only helps big analytical queries; on ours it added half a second or
-- more to each request. It used to be set as a connection startup option,
-- but some hosts refuse startup options other than TimeZone (error 08P01,
-- which stopped every login). Setting it on the database applies it to new
-- connections instead. If the host doesn't allow it, carry on without.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET jit = off', current_database());
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not switch off JIT (%); continuing.', SQLERRM;
END $$;
