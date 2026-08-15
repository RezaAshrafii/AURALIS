ALTER TABLE AudioChannel ADD COLUMN bits_per_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE AudioChannel ADD COLUMN valid_bits_per_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE AudioChannel ADD COLUMN block_align INTEGER NOT NULL DEFAULT 0;

ALTER TABLE AudioChunk ADD COLUMN bits_per_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE AudioChunk ADD COLUMN valid_bits_per_sample INTEGER NOT NULL DEFAULT 0;
ALTER TABLE AudioChunk ADD COLUMN block_align INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_audio_chunk_state
  ON AudioChunk(session_id, channel_id, state, seq_start);
