import { generateId, nowIso } from "./domain-models.mjs";

export class ConversationService {
  constructor(db) {
    this.db = db;
  }

  listConversations(
    workspaceId,
    { projectId = null, limit = 50, offset = 0, status = null, includeArchived = false } = {}
  ) {
    let sql = "SELECT * FROM conversations WHERE workspace_id = ?";
    const params = [workspaceId];

    if (projectId) {
      sql += " AND project_id = ?";
      params.push(projectId);
    }
    if (status) {
      sql += " AND state = ?";
      params.push(status);
    }
    if (!status && !includeArchived) sql += " AND state != 'ARCHIVED'";
    sql += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = this.db.query(sql).all(...params);
    return rows.map(this._mapConversation);
  }

  getConversation(id) {
    const row = this.db.query("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) return null;
    const conv = this._mapConversation(row);

    // Load participants
    conv.participants = this.db
      .query(`
      SELECT p.*, cp.participant_role, cp.speaker_channel_id
      FROM conversation_participants cp
      JOIN people p ON cp.person_id = p.id
      WHERE cp.conversation_id = ?
    `)
      .all(id)
      .map((r) => ({
        id: r.id,
        displayName: r.display_name,
        roleTitle: r.role_title,
        participantRole: r.participant_role,
        speakerChannelId: r.speaker_channel_id,
      }));

    // Load attached documents
    conv.documents = this.db
      .query(`
      SELECT d.*, cd.purpose
      FROM conversation_documents cd
      JOIN source_documents d ON cd.document_id = d.id
      WHERE cd.conversation_id = ?
    `)
      .all(id)
      .map((r) => ({
        id: r.id,
        title: r.title,
        mimeType: r.mime_type,
        purpose: r.purpose,
      }));

    return conv;
  }

  createConversation(workspaceId, data) {
    const id = data.id || generateId("conv");
    const now = nowIso();
    const title = (data.title || "").trim() || `مکالمه ${new Date().toLocaleString("fa-IR")}`;
    const kind = ["GENERAL", "CALL", "MEETING", "INTERVIEW", "NOTE"].includes(data.kind)
      ? data.kind
      : "GENERAL";
    const state = [
      "DRAFT",
      "STARTING",
      "LIVE",
      "PROCESSING",
      "READY",
      "FAILED",
      "ARCHIVED",
    ].includes(data.state)
      ? data.state
      : "READY";

    // Validate documentIds exist and belong to the same workspace
    if (Array.isArray(data.documentIds) && data.documentIds.length > 0) {
      const placeholders = data.documentIds.map(() => "?").join(",");
      const docs = this.db
        .query(
          `SELECT id FROM source_documents WHERE id IN (${placeholders}) AND status = 'ACTIVE'`
        )
        .all(...data.documentIds);
      if (docs.length !== data.documentIds.length) {
        const found = new Set(docs.map((d) => d.id));
        const missing = data.documentIds.filter((id) => !found.has(id));
        const err = new Error("DOCUMENT_NOT_FOUND");
        err.missing = missing;
        throw err;
      }
    }

    // Validate participantIds exist and belong to the same workspace
    if (Array.isArray(data.participantIds) && data.participantIds.length > 0) {
      const people = this.db
        .query(
          `SELECT id FROM people WHERE id IN (${data.participantIds.map(() => "?").join(",")}) AND workspace_id = ?`
        )
        .all(...data.participantIds, workspaceId);
      if (people.length !== data.participantIds.length) {
        const found = new Set(people.map((p) => p.id));
        const missing = data.participantIds.filter((id) => !found.has(id));
        const err = new Error("PERSON_NOT_FOUND");
        err.missing = missing;
        throw err;
      }
    }

    this.db.transaction(() => {
      this.db
        .query(`
        INSERT INTO conversations (
          id, workspace_id, project_id, capture_session_id, title, goal, kind, state,
          started_at, ended_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `)
        .run(
          id,
          workspaceId,
          data.projectId || null,
          data.captureSessionId || null,
          title,
          data.goal || null,
          kind,
          state,
          data.startedAt || now,
          data.endedAt || null,
          now,
          now
        );

      if (Array.isArray(data.participantIds)) {
        for (const personId of data.participantIds) {
          this.addParticipant(id, personId);
        }
      }

      if (Array.isArray(data.documentIds)) {
        for (const docId of data.documentIds) {
          this.addDocument(id, docId);
        }
      }
    })();

    return this.getConversation(id);
  }

  updateConversation(id, data, expectedRevision = null) {
    const current = this.getConversation(id);
    if (!current) throw new Error("CONVERSATION_NOT_FOUND");

    if (expectedRevision !== null && current.revision !== expectedRevision) {
      const err = new Error("CONCURRENCY_CONFLICT");
      err.status = 409;
      throw err;
    }

    const title = data.title !== undefined ? (data.title || "").trim() : current.title;
    if (!title) throw new Error("TITLE_REQUIRED");

    const goal = data.goal !== undefined ? data.goal : current.goal;
    const projectId = data.projectId !== undefined ? data.projectId : current.projectId;
    const kind = data.kind !== undefined ? data.kind : current.kind;
    const state = data.state !== undefined ? data.state : current.state;
    const endedAt = data.endedAt !== undefined ? data.endedAt : current.endedAt;
    const now = nowIso();
    const newRev = current.revision + 1;

    this.db
      .query(`
      UPDATE conversations
      SET title = ?, goal = ?, project_id = ?, kind = ?, state = ?, ended_at = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `)
      .run(title, goal, projectId, kind, state, endedAt, newRev, now, id);

    return this.getConversation(id);
  }

  deleteFinishedConversation(id, expectedRevision = null) {
    const current = this.getConversation(id);
    if (!current) throw new Error("CONVERSATION_NOT_FOUND");
    if (expectedRevision !== null && current.revision !== expectedRevision) {
      const error = new Error("CONCURRENCY_CONFLICT");
      error.status = 409;
      throw error;
    }
    if (current.state === "ARCHIVED") return current;
    if (!["READY", "FAILED"].includes(current.state)) throw new Error("CONVERSATION_NOT_FINISHED");
    return this.updateConversation(
      id,
      { state: "ARCHIVED", endedAt: current.endedAt || nowIso() },
      current.revision
    );
  }

  addParticipant(
    conversationId,
    personId,
    participantRole = "participant",
    speakerChannelId = null
  ) {
    this.db
      .query(`
      INSERT OR REPLACE INTO conversation_participants (conversation_id, person_id, participant_role, speaker_channel_id)
      VALUES (?, ?, ?, ?)
    `)
      .run(conversationId, personId, participantRole, speakerChannelId);
  }

  removeParticipant(conversationId, personId) {
    this.db
      .query("DELETE FROM conversation_participants WHERE conversation_id = ? AND person_id = ?")
      .run(conversationId, personId);
  }

  addDocument(conversationId, documentId, purpose = "CONTEXT") {
    this.db
      .query(`
      INSERT OR REPLACE INTO conversation_documents (conversation_id, document_id, purpose)
      VALUES (?, ?, ?)
    `)
      .run(conversationId, documentId, purpose);
  }

  removeDocument(conversationId, documentId) {
    this.db
      .query("DELETE FROM conversation_documents WHERE conversation_id = ? AND document_id = ?")
      .run(conversationId, documentId);
  }

  // Audio & Transcript Hub data
  getAudioDetails(conversationId) {
    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error("CONVERSATION_NOT_FOUND");

    const sessionId = conv.captureSessionId || conv.id;
    const channels = this.db
      .query("SELECT * FROM audio_channels WHERE session_id = ?")
      .all(sessionId);
    const gaps = this.db
      .query("SELECT * FROM gaps WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId);
    const segments = this.db
      .query(`
      SELECT id, channel_id, seq_start, seq_end, duration_ms, audio_path, endpoint_reason, state, created_at
      FROM speech_segments
      WHERE session_id = ?
      ORDER BY seq_start ASC
    `)
      .all(sessionId);

    return {
      conversationId: conv.id,
      captureSessionId: conv.captureSessionId,
      state: conv.state,
      channels,
      gaps,
      segmentsCount: segments.length,
      segments,
    };
  }

  getTranscriptTimeline(conversationId, { limit = 100, offset = 0, cursor = null } = {}) {
    const conv = this.getConversation(conversationId);
    if (!conv) throw new Error("CONVERSATION_NOT_FOUND");

    const sessionId = conv.captureSessionId || conv.id;
    let sql = `
      SELECT t.id, t.ordinal, t.source_role, t.kind, t.text_raw, t.text_normalized, t.state, t.created_at,
             a.id as answer_id, a.answer_text, a.grounding, a.created_at as answer_created_at
      FROM turns t
      LEFT JOIN answer_results a ON a.turn_id = t.id
      WHERE t.session_id = ?
    `;
    const params = [sessionId];

    if (cursor) {
      sql += " AND t.ordinal > ?";
      params.push(parseInt(cursor, 10));
    }
    sql += " ORDER BY t.ordinal ASC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const turns = this.db
      .query(sql)
      .all(...params)
      .map((r) => ({
        id: r.id,
        ordinal: r.ordinal,
        sourceRole: r.source_role,
        kind: r.kind,
        textRaw: r.text_raw,
        textNormalized: r.text_normalized,
        state: r.state,
        createdAt: r.created_at,
        answer: r.answer_id
          ? {
              id: r.answer_id,
              answerText: r.answer_text,
              grounding: r.grounding,
              createdAt: r.answer_created_at,
            }
          : null,
      }));

    return {
      conversationId: conv.id,
      sessionId,
      turns,
      nextCursor: turns.length === limit ? String(turns[turns.length - 1].ordinal) : null,
    };
  }

  _mapConversation(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      captureSessionId: row.capture_session_id,
      title: row.title,
      goal: row.goal,
      kind: row.kind,
      state: row.state,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
