CREATE TABLE IF NOT EXISTS RecoveryScan(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  recovered_chunks INTEGER NOT NULL DEFAULT 0,
  incomplete_chunks INTEGER NOT NULL DEFAULT 0,
  missing_chunks INTEGER NOT NULL DEFAULT 0,
  orphan_files INTEGER NOT NULL DEFAULT 0,
  restored_jobs INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS RecoveryArtifact(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL REFERENCES RecoveryScan(id),
  chunk_id TEXT,
  path TEXT NOT NULL,
  disposition TEXT NOT NULL,
  observed_byte_length INTEGER,
  detail_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recovery_scan_session_state
  ON RecoveryScan(session_id, state, id);
CREATE INDEX IF NOT EXISTS idx_recovery_artifact_scan
  ON RecoveryArtifact(scan_id, disposition, id);
