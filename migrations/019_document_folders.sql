-- Migration 019: document folders
--
-- Each matter's documents can be organised into folders. A matter gets its
-- department's standard set of folders the first time it's opened
-- (matters.folders_ready), from the firm's own list for that department if
-- an admin has set one (firm_folder_templates), otherwise the system's
-- default in src/config/areas.js. Deleting a folder leaves its documents
-- "unfiled" rather than deleting them.

CREATE TABLE document_folders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   UUID NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_document_folders_matter_name ON document_folders(matter_id, lower(name));

ALTER TABLE documents ADD COLUMN folder_id UUID REFERENCES document_folders(id) ON DELETE SET NULL;
CREATE INDEX idx_documents_folder ON documents(folder_id) WHERE folder_id IS NOT NULL;

ALTER TABLE matters ADD COLUMN folders_ready BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE firm_folder_templates (
  firm_id     UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  department  TEXT NOT NULL,
  folders     JSONB NOT NULL,
  PRIMARY KEY (firm_id, department)
);
