CREATE TABLE IF NOT EXISTS generation_projects (
  project_id TEXT PRIMARY KEY,
  generation_target REAL NOT NULL DEFAULT 125,
  working_ceiling REAL NOT NULL DEFAULT 200,
  emergency_ceiling REAL NOT NULL DEFAULT 250,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  scene_id TEXT,
  shot_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  model TEXT NOT NULL,
  resolution TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','canceled')),
  estimated_cost REAL NOT NULL DEFAULT 0,
  reserved_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL NOT NULL DEFAULT 0,
  request_seconds REAL NOT NULL DEFAULT 0,
  prompt_hash TEXT,
  provider_operation TEXT,
  provider_metadata TEXT,
  output_key TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_generation_jobs_project_status ON generation_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_shot ON generation_jobs(project_id, scene_id, shot_id);
