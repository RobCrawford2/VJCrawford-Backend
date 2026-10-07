-- Migration 004: store uploaded document files
--
-- Files live in their own table, not as a column on documents, so the
-- matter detail query (SELECT * FROM documents ...) never drags file bytes
-- along. The file metadata columns on documents let the UI show what's
-- attached without touching document_files. If files move to object storage
-- later (S3 etc.), documents.storage_key is already there for the pointer and
-- this table can be drained.

ALTER TABLE documents
  ADD COLUMN file_name TEXT,
  ADD COLUMN file_mime TEXT,
  ADD COLUMN file_size INT;

CREATE TABLE document_files (
  document_id  UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  data         BYTEA NOT NULL,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
