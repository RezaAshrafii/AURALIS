ALTER TABLE AudioSession ADD COLUMN recovery_state TEXT NOT NULL DEFAULT 'CLEAN';

ALTER TABLE AudioChannel ADD COLUMN sample_format TEXT NOT NULL DEFAULT 'unknown:0';
ALTER TABLE AudioChannel ADD COLUMN device_state TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE AudioChannel ADD COLUMN recovery_state TEXT NOT NULL DEFAULT 'CLEAN';
ALTER TABLE AudioChannel ADD COLUMN last_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE AudioChannel ADD COLUMN last_qpc_100ns INTEGER;
ALTER TABLE AudioChannel ADD COLUMN last_device_position INTEGER;

ALTER TABLE AudioChunk ADD COLUMN channel_mask INTEGER;
ALTER TABLE AudioChunk ADD COLUMN device_position_start INTEGER;
ALTER TABLE AudioChunk ADD COLUMN device_position_end INTEGER;

ALTER TABLE Gap ADD COLUMN extent_known INTEGER NOT NULL DEFAULT 1 CHECK(extent_known IN (0, 1));
ALTER TABLE Gap ADD COLUMN qpc_detected_100ns INTEGER;
ALTER TABLE Gap ADD COLUMN expected_device_position INTEGER;
ALTER TABLE Gap ADD COLUMN observed_device_position INTEGER;

CREATE TABLE IF NOT EXISTS LifecycleTransition(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES AudioSession(id),
  channel_id TEXT REFERENCES AudioChannel(id),
  previous_capture_state TEXT NOT NULL,
  capture_state TEXT NOT NULL,
  previous_device_state TEXT NOT NULL,
  device_state TEXT NOT NULL,
  previous_recovery_state TEXT NOT NULL,
  recovery_state TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  occurred_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audio_chunk_channel_sequence
  ON AudioChunk(channel_id, seq_start, seq_end);
CREATE INDEX IF NOT EXISTS idx_gap_session_channel_sequence
  ON Gap(session_id, channel_id, seq_start, seq_end);
CREATE INDEX IF NOT EXISTS idx_gap_unknown_extent
  ON Gap(session_id, channel_id, extent_known) WHERE extent_known = 0;
CREATE INDEX IF NOT EXISTS idx_lifecycle_session_time
  ON LifecycleTransition(session_id, occurred_at_utc);
