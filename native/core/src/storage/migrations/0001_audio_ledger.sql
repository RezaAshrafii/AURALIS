PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS AudioSession(
  id TEXT PRIMARY KEY,
  started_at_utc TEXT NOT NULL,
  ended_at_utc TEXT,
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  config_snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AudioChannel(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  source_kind TEXT NOT NULL,
  device_id TEXT,
  device_generation INTEGER NOT NULL DEFAULT 0,
  native_sample_rate INTEGER NOT NULL,
  native_channels INTEGER NOT NULL,
  channel_mask INTEGER,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AudioChunk(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  channel_id TEXT NOT NULL REFERENCES AudioChannel(id),
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL CHECK(seq_end > seq_start),
  qpc_start INTEGER NOT NULL,
  qpc_end INTEGER NOT NULL,
  sample_rate INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  format TEXT NOT NULL,
  path TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  discontinuity TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(channel_id, seq_start, seq_end)
);

CREATE TABLE IF NOT EXISTS Gap(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  channel_id TEXT NOT NULL REFERENCES AudioChannel(id),
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  reason TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
