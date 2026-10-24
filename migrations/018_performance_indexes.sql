-- Migration 018: indexes for speed as the firm's data grows
--
-- The matter list is ordered by most recently updated within the firm;
-- bills look up their time entries; a few foreign keys used when deleting.

CREATE INDEX IF NOT EXISTS idx_matters_firm_updated ON matters(firm_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_bill ON time_entries(bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matter_links_linked ON matter_links(linked_matter_id);
CREATE INDEX IF NOT EXISTS idx_enquiry_replies_email ON enquiry_replies(source_email_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_email ON enquiries(source_email_id);

-- Conflict checks and client search match names anywhere in the text
-- (ILIKE '%smith%'). Trigram indexes make that fast; they need the pg_trgm
-- extension, which most hosts (including Render) allow. If the database
-- won't allow it, carry on without — searches still work, just slower.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm not available (%), skipping trigram indexes', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_clients_name_trgm ON clients USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_matter_parties_name_trgm ON matter_parties USING gin (name gin_trgm_ops);
  END IF;
END $$;
