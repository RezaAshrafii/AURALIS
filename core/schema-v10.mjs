import { nowIso } from './domain-models.mjs';

export function applySchemaV10(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'fa-IR',
      timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      local_profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(local_profile_id) REFERENCES local_profiles(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_profile_name ON workspaces(local_profile_id, name);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ON_HOLD','COMPLETED','ARCHIVED')),
      color_token TEXT NOT NULL DEFAULT 'blue',
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_workspace_name ON projects(workspace_id, name) WHERE status != 'ARCHIVED';

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      organization_name TEXT,
      role_title TEXT,
      email TEXT,
      phone TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS idx_people_workspace ON people(workspace_id, status);

    CREATE TABLE IF NOT EXISTS project_people (
      project_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      relationship_label TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(project_id, person_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      capture_session_id TEXT UNIQUE,
      title TEXT NOT NULL,
      goal TEXT,
      kind TEXT NOT NULL DEFAULT 'GENERAL' CHECK(kind IN ('GENERAL','CALL','MEETING','INTERVIEW','NOTE')),
      state TEXT NOT NULL DEFAULT 'READY' CHECK(state IN ('DRAFT','STARTING','LIVE','PROCESSING','READY','FAILED','ARCHIVED')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY(capture_session_id) REFERENCES sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id, created_at);

    CREATE TABLE IF NOT EXISTS conversation_participants (
      conversation_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      participant_role TEXT NOT NULL DEFAULT 'participant',
      speaker_channel_id TEXT,
      PRIMARY KEY(conversation_id, person_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_documents (
      conversation_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'CONTEXT' CHECK(purpose IN ('CONTEXT','AGENDA','REFERENCE','OUTPUT')),
      PRIMARY KEY(conversation_id, document_id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(document_id) REFERENCES source_documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS understanding_runs (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','COMPLETED','FAILED','SUPERSEDED')),
      attempt INTEGER NOT NULL DEFAULT 1,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, input_fingerprint, prompt_version),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS insight_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('DECISION','TASK','COMMITMENT','OPEN_QUESTION','RISK')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUGGESTED' CHECK(status IN ('SUGGESTED','CONFIRMED','DISMISSED','SUPERSEDED')),
      confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
      assignee_person_id TEXT,
      due_at_utc TEXT,
      due_timezone TEXT,
      due_original_text TEXT,
      due_parse_confidence REAL,
      fingerprint TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'AI' CHECK(created_by IN ('AI','USER')),
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES understanding_runs(id) ON DELETE CASCADE,
      FOREIGN KEY(assignee_person_id) REFERENCES people(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_insights_workspace_type ON insight_items(workspace_id, type, status);
    CREATE INDEX IF NOT EXISTS idx_insights_conversation ON insight_items(conversation_id);

    CREATE TABLE IF NOT EXISTS insight_evidence (
      id TEXT PRIMARY KEY,
      insight_id TEXT NOT NULL,
      turn_id TEXT,
      segment_id TEXT,
      document_chunk_id TEXT,
      exact_quote TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(insight_id) REFERENCES insight_items(id) ON DELETE CASCADE,
      FOREIGN KEY(turn_id) REFERENCES turns(id) ON DELETE SET NULL,
      FOREIGN KEY(segment_id) REFERENCES speech_segments(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_insight ON insight_evidence(insight_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      conversation_id TEXT,
      source_insight_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      state TEXT NOT NULL DEFAULT 'TODO' CHECK(state IN ('SUGGESTED','TODO','IN_PROGRESS','DONE','CANCELLED')),
      priority TEXT NOT NULL DEFAULT 'NONE' CHECK(priority IN ('NONE','LOW','MEDIUM','HIGH')),
      assignee_person_id TEXT,
      due_at_utc TEXT,
      due_timezone TEXT,
      due_original_text TEXT,
      due_parse_confidence REAL,
      completed_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
      FOREIGN KEY(source_insight_id) REFERENCES insight_items(id) ON DELETE SET NULL,
      FOREIGN KEY(assignee_person_id) REFERENCES people(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_workspace_state ON tasks(workspace_id, state);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'user',
      from_json TEXT,
      to_json TEXT,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, occurred_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS search_projection USING fts5(
      item_id UNINDEXED,
      item_type UNINDEXED,
      workspace_id UNINDEXED,
      project_id UNINDEXED,
      conversation_id UNINDEXED,
      title,
      subtitle,
      body,
      tokenize='unicode61'
    );
  `);

  // Backfill Default Profile and Default Workspace idempotently
  const now = nowIso();
  const existingProfile = db.query('SELECT id FROM local_profiles WHERE id = ?').get('default-profile');
  if (!existingProfile) {
    db.query(`
      INSERT INTO local_profiles (id, display_name, locale, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('default-profile', 'کاربر پیش‌فرض', 'fa-IR', 'Asia/Tehran', now, now);
  }

  const existingWorkspace = db.query('SELECT id FROM workspaces WHERE id = ?').get('default-workspace');
  if (!existingWorkspace) {
    db.query(`
      INSERT INTO workspaces (id, local_profile_id, name, description, status, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('default-workspace', 'default-profile', 'فضای کاری اصلی', 'فضای کاری پیش‌فرض شخصی اورالیس', 'ACTIVE', 1, now, now);
  }

  // Idempotently convert existing sessions to conversations
  const sessions = db.query('SELECT * FROM sessions').all();
  for (const session of sessions) {
    const existingConv = db.query('SELECT id FROM conversations WHERE capture_session_id = ?').get(session.id);
    if (!existingConv) {
      const convId = `conv-${session.id}`;
      const kind = session.mode === 'meeting' ? 'MEETING' : (session.mode === 'oral_copilot' ? 'NOTE' : 'GENERAL');
      const state = session.state === 'CAPTURING' ? 'LIVE' : (session.state === 'CLOSED' ? 'READY' : 'DRAFT');
      const title = `مکالمه ${new Date(session.started_at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })}`;
      db.query(`
        INSERT INTO conversations (
          id, workspace_id, project_id, capture_session_id, title, goal, kind, state,
          started_at, ended_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        convId,
        'default-workspace',
        null,
        session.id,
        title,
        session.context_text || null,
        kind,
        state,
        session.started_at,
        session.ended_at || null,
        1,
        session.started_at,
        session.ended_at || session.started_at
      );
    }
  }
}
