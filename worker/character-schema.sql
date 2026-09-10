-- Additive character reference library. Repeatable and non-destructive.
CREATE TABLE IF NOT EXISTS character_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  angle TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL DEFAULT '',
  wardrobe TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  approval_state TEXT NOT NULL DEFAULT 'pending' CHECK(approval_state IN ('pending','approved','excluded')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  is_identity_anchor INTEGER NOT NULL DEFAULT 0 CHECK(is_identity_anchor IN (0,1)),
  include_in_generation INTEGER NOT NULL DEFAULT 1 CHECK(include_in_generation IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_references_hash
  ON character_references(project_id, character_id, content_hash);

CREATE INDEX IF NOT EXISTS idx_character_references_character
  ON character_references(project_id, character_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_character_references_primary
  ON character_references(project_id, character_id, is_primary);

CREATE TABLE IF NOT EXISTS character_locks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  lock_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('current','stale','archived')),
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, character_id, lock_version)
);

CREATE INDEX IF NOT EXISTS idx_character_locks_current
  ON character_locks(project_id, character_id, status, lock_version);
