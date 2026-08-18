CREATE TABLE IF NOT EXISTS SpeechSegment(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  channel_id TEXT NOT NULL REFERENCES AudioChannel(id),
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL CHECK(seq_end > seq_start),
  qpc_start INTEGER NOT NULL,
  qpc_end INTEGER NOT NULL,
  endpoint_reason TEXT NOT NULL,
  vad_meta_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS TranscriptRevision(
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES SpeechSegment(id),
  revision INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  language TEXT NOT NULL,
  is_final INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(segment_id, revision)
);

CREATE TABLE IF NOT EXISTS AsrJob(
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES SpeechSegment(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  available_at TEXT,
  lease_until TEXT,
  provider_status INTEGER,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
