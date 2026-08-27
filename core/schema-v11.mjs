import { applySchemaV10 } from './schema-v10.mjs';
import { nowIso } from './domain-models.mjs';

function hasColumn(db, table, column) {
  return db.query(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

export function applySchemaV11(db) {
  applySchemaV10(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_settings (
      workspace_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
      candidate_extraction_enabled INTEGER NOT NULL DEFAULT 0 CHECK(candidate_extraction_enabled IN (0,1)),
      auto_confirm_user_preferences INTEGER NOT NULL DEFAULT 0 CHECK(auto_confirm_user_preferences IN (0,1)),
      retention_days INTEGER,
      sensitive_memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sensitive_memory_enabled IN (0,1)),
      context_budget_items INTEGER NOT NULL DEFAULT 6 CHECK(context_budget_items BETWEEN 1 AND 30),
      context_budget_chars INTEGER NOT NULL DEFAULT 1800 CHECK(context_budget_chars BETWEEN 200 AND 12000),
      consent_granted_at TEXT,
      disabled_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('USER','PERSON','PROJECT','WORKSPACE')),
      scope_id TEXT NOT NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN ('FACT','PREFERENCE','RELATIONSHIP','PROJECT_STATE','CONSTRAINT','ROUTINE')),
      canonical_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('CANDIDATE','CONFIRMED','REJECTED','ARCHIVED','SUPERSEDED','DELETED')),
      current_revision_id TEXT,
      confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      sensitivity TEXT NOT NULL DEFAULT 'NORMAL' CHECK(sensitivity IN ('NORMAL','SENSITIVE')),
      valid_from TEXT,
      valid_until TEXT,
      last_observed_at TEXT,
      source TEXT NOT NULL CHECK(source IN ('AI','USER','IMPORT')),
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(current_revision_id) REFERENCES memory_revisions(id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX IF NOT EXISTS idx_memory_items_workspace_status ON memory_items(workspace_id,status,updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_items_scope ON memory_items(workspace_id,scope_type,scope_id,memory_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_active_fingerprint
      ON memory_items(workspace_id,scope_type,scope_id,fingerprint)
      WHERE status IN ('CANDIDATE','CONFIRMED');

    CREATE TABLE IF NOT EXISTS memory_revisions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      content_json TEXT NOT NULL,
      reason TEXT NOT NULL CHECK(reason IN ('EXTRACTED','USER_EDIT','CONTRADICTION_RESOLUTION','IMPORT','SYSTEM_MIGRATION')),
      created_by TEXT NOT NULL CHECK(created_by IN ('AI','USER','SYSTEM')),
      provider TEXT,
      provider_model TEXT,
      prompt_version TEXT,
      input_fingerprint TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(memory_id,revision),
      FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory ON memory_revisions(memory_id,revision DESC);

    CREATE TABLE IF NOT EXISTS memory_evidence (
      id TEXT PRIMARY KEY,
      memory_revision_id TEXT NOT NULL,
      conversation_id TEXT,
      turn_id TEXT,
      segment_id TEXT,
      document_chunk_id TEXT,
      evidence_type TEXT NOT NULL DEFAULT 'SOURCE' CHECK(evidence_type IN ('SOURCE','USER_EDIT','IMPORT')),
      exact_quote TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(memory_revision_id) REFERENCES memory_revisions(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY(turn_id) REFERENCES turns(id) ON DELETE SET NULL,
      FOREIGN KEY(segment_id) REFERENCES speech_segments(id) ON DELETE SET NULL,
      FOREIGN KEY(document_chunk_id) REFERENCES source_chunks(id) ON DELETE SET NULL,
      CHECK(evidence_type = 'USER_EDIT' OR conversation_id IS NOT NULL OR turn_id IS NOT NULL OR segment_id IS NOT NULL OR document_chunk_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_revision ON memory_evidence(memory_revision_id);

    CREATE TABLE IF NOT EXISTS memory_contradictions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      left_memory_id TEXT NOT NULL,
      right_memory_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('OPEN','RESOLVED_LEFT','RESOLVED_RIGHT','MERGED','DISMISSED')),
      reason TEXT NOT NULL,
      confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(left_memory_id,right_memory_id),
      CHECK(left_memory_id < right_memory_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(left_memory_id) REFERENCES memory_items(id) ON DELETE CASCADE,
      FOREIGN KEY(right_memory_id) REFERENCES memory_items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_contradictions_workspace ON memory_contradictions(workspace_id,state,created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_use_audits (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      conversation_id TEXT,
      turn_id TEXT,
      purpose TEXT NOT NULL CHECK(purpose IN ('ANSWER_CONTEXT','SEARCH','SUGGESTION','EXPORT')),
      rank INTEGER,
      score REAL,
      included_chars INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY(turn_id) REFERENCES turns(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_usage_memory ON memory_use_audits(memory_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_usage_turn ON memory_use_audits(turn_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_purge_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      memory_id TEXT,
      state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
      attempt INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(memory_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS memory_extraction_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
      candidate_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id,input_fingerprint,prompt_version),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_backfill_jobs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','PAUSED','CANCELLED','COMPLETED','FAILED')),
      total_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      batch_size INTEGER NOT NULL DEFAULT 5 CHECK(batch_size BETWEEN 1 AND 25),
      cursor_ended_at TEXT,
      cursor_conversation_id TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_backfill_workspace ON memory_backfill_jobs(workspace_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_exports (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
      format TEXT NOT NULL CHECK(format IN ('JSON','MARKDOWN','BOTH')),
      payload_json TEXT,
      payload_markdown TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_command_audits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      memory_id TEXT,
      command TEXT NOT NULL,
      actor TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY(memory_id) REFERENCES memory_items(id) ON DELETE SET NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_index USING fts5(
      memory_id UNINDEXED,
      workspace_id UNINDEXED,
      scope_type UNINDEXED,
      scope_id UNINDEXED,
      memory_type UNINDEXED,
      canonical_key,
      content_text,
      tokenize='unicode61'
    );
  `);

  if (!hasColumn(db, 'answer_results', 'memory_context_json')) {
    db.exec("ALTER TABLE answer_results ADD COLUMN memory_context_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!hasColumn(db, 'memory_settings', 'consent_granted_at')) {
    db.exec('ALTER TABLE memory_settings ADD COLUMN consent_granted_at TEXT');
  }
  if (!hasColumn(db, 'memory_settings', 'disabled_at')) {
    db.exec('ALTER TABLE memory_settings ADD COLUMN disabled_at TEXT');
  }

  const now = nowIso();
  const workspaces = db.query('SELECT id FROM workspaces').all();
  for (const workspace of workspaces) {
    db.query(`
      INSERT OR IGNORE INTO memory_settings (
        workspace_id,enabled,candidate_extraction_enabled,auto_confirm_user_preferences,
        retention_days,sensitive_memory_enabled,context_budget_items,context_budget_chars,
        revision,created_at,updated_at
      ) VALUES (?,0,0,0,NULL,0,6,1800,1,?,?)
    `).run(workspace.id, now, now);
  }

  return { schemaVersion: 11, migratedWorkspaces: workspaces.length };
}
