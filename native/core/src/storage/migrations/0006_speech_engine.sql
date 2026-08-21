CREATE TABLE IF NOT EXISTS TranscriptStreamEvent(
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES SpeechSegment(id),
  sequence INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PARTIAL','STABLE','FINAL')),
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  language TEXT NOT NULL,
  confidence REAL,
  fingerprint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE(segment_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_transcript_stream_event_segment
  ON TranscriptStreamEvent(segment_id, sequence);
