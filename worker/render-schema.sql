-- Additive: leaves all v1.3 production tables and data intact.
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL, session_id TEXT NOT NULL, scene_id TEXT NOT NULL, shot_id TEXT NOT NULL,
  request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','starting','running','completed','failed','canceled','uncertain')),
  estimated_cost REAL NOT NULL DEFAULT 0, reserved_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL, cost_basis TEXT, input_json TEXT NOT NULL,
  operation_id TEXT, asset_json TEXT, output_key TEXT, error_json TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(project_id, request_key)
);
CREATE INDEX IF NOT EXISTS renders_project ON renders(project_id);
CREATE INDEX IF NOT EXISTS renders_session ON renders(session_id);
