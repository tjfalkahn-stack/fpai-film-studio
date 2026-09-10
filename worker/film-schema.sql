-- Additive engine metadata. Large originals and immutable snapshots live in R2.
CREATE TABLE IF NOT EXISTS film_heads (
  project_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  snapshot_key TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS film_events (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  command_type TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, revision),
  UNIQUE (project_id, request_key)
);
CREATE TABLE IF NOT EXISTS film_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  category TEXT NOT NULL,
  rights_status TEXT NOT NULL,
  provenance TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, filename, source_version)
);
CREATE INDEX IF NOT EXISTS film_sources_project ON film_sources(project_id, created_at);
