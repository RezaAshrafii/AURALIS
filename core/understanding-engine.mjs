import { createHash } from 'node:crypto';
import { generateId, nowIso, parseDeadline } from './domain-models.mjs';

export const PROMPT_VERSION = 'v0.15.0-strict';

export class UnderstandingEngine {
  constructor(db, aiClient = null) {
    this.db = db;
    this.aiClient = aiClient;
  }

  computeInputFingerprint(turns) {
    const content = turns.map(t => `${t.id}:${t.text_normalized || t.text_raw}`).join('\n');
    return createHash('sha256').update(content || 'empty').digest('hex');
  }

  listInsights(conversationId, { type = null, status = null } = {}) {
    let sql = 'SELECT * FROM insight_items WHERE conversation_id = ?';
    const params = [conversationId];

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC';

    const items = this.db.query(sql).all(...params).map(this._mapInsight);
    for (const item of items) {
      item.evidence = this.db.query(`
        SELECT * FROM insight_evidence WHERE insight_id = ?
      `).all(item.id).map(e => ({
        id: e.id,
        insightId: e.insight_id,
        turnId: e.turn_id,
        segmentId: e.segment_id,
        documentChunkId: e.document_chunk_id,
        exactQuote: e.exact_quote,
        startOffset: e.start_offset,
        endOffset: e.end_offset
      }));
    }
    return items;
  }

  getInsight(id) {
    const row = this.db.query('SELECT * FROM insight_items WHERE id = ?').get(id);
    if (!row) return null;
    const item = this._mapInsight(row);
    item.evidence = this.db.query('SELECT * FROM insight_evidence WHERE insight_id = ?').all(id).map(e => ({
      id: e.id,
      insightId: e.insight_id,
      turnId: e.turn_id,
      segmentId: e.segment_id,
      documentChunkId: e.document_chunk_id,
      exactQuote: e.exact_quote,
      startOffset: e.start_offset,
      endOffset: e.end_offset
    }));
    return item;
  }

  confirmInsight(id) {
    const item = this.getInsight(id);
    if (!item) throw new Error('INSIGHT_NOT_FOUND');
    const now = nowIso();

    this.db.query(`
      UPDATE insight_items
      SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(now, id);

    return this.getInsight(id);
  }

  dismissInsight(id) {
    const item = this.getInsight(id);
    if (!item) throw new Error('INSIGHT_NOT_FOUND');
    const now = nowIso();

    this.db.query(`
      UPDATE insight_items
      SET status = 'DISMISSED', revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(now, id);

    return this.getInsight(id);
  }

  async runUnderstanding(conversationId, options = {}) {
    const conv = this.db.query('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conv) throw new Error('CONVERSATION_NOT_FOUND');

    const sessionId = conv.capture_session_id || conv.id;
    const turns = this.db.query(`
      SELECT * FROM turns
      WHERE session_id = ?
      ORDER BY ordinal ASC
    `).all(sessionId);

    const inputFingerprint = this.computeInputFingerprint(turns);
    const runId = generateId('run');
    const now = nowIso();

    // Check if duplicate completed run exists
    const existingRun = this.db.query(`
      SELECT * FROM understanding_runs
      WHERE conversation_id = ? AND input_fingerprint = ? AND prompt_version = ?
    `).get(conversationId, inputFingerprint, PROMPT_VERSION);

    if (existingRun && existingRun.state === 'COMPLETED' && !options.force) {
      return {
        runId: existingRun.id,
        conversationId,
        cached: true,
        insights: this.listInsights(conversationId)
      };
    }

    // Mark prior active runs as SUPERSEDED
    this.db.query(`
      UPDATE understanding_runs
      SET state = 'SUPERSEDED', updated_at = ?
      WHERE conversation_id = ? AND state IN ('QUEUED', 'RUNNING', 'COMPLETED')
    `).run(now, conversationId);

    // Insert new run
    this.db.query(`
      INSERT INTO understanding_runs (
        id, conversation_id, input_fingerprint, prompt_version, provider, provider_model, state, attempt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'RUNNING', 1, ?, ?)
    `).run(
      runId,
      conversationId,
      inputFingerprint,
      PROMPT_VERSION,
      options.provider || 'gemini-1.5-flash',
      options.model || 'gemini-1.5-flash',
      now,
      now
    );

    try {
      // Extract insights from turns
      const extracted = await this._extractInsightsFromTurns(turns, conv.workspace_id, conversationId);
      
      // Save items and evidence transactionally
      const tx = this.db.transaction(() => {
        for (const item of extracted.items) {
          const insightId = generateId('ins');
          const fp = createHash('sha256').update(`${conversationId}:${item.type}:${item.title}`).digest('hex');

          this.db.query(`
            INSERT INTO insight_items (
              id, workspace_id, conversation_id, run_id, type, title, body, status, confidence,
              assignee_person_id, due_at_utc, due_timezone, due_original_text, due_parse_confidence,
              fingerprint, created_by, revision, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SUGGESTED', ?, ?, ?, ?, ?, ?, ?, 'AI', 1, ?, ?)
          `).run(
            insightId,
            conv.workspace_id,
            conversationId,
            runId,
            item.type,
            item.title,
            item.body,
            item.confidence,
            item.assigneePersonId || null,
            item.dueAtUtc || null,
            item.dueTimezone || null,
            item.dueOriginalText || null,
            item.dueParseConfidence || null,
            fp,
            now,
            now
          );

          if (Array.isArray(item.evidence)) {
            for (const ev of item.evidence) {
              this.db.query(`
                INSERT INTO insight_evidence (
                  id, insight_id, turn_id, segment_id, document_chunk_id, exact_quote, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                generateId('ev'),
                insightId,
                ev.turnId || null,
                null,
                null,
                ev.quote || '',
                now
              );
            }
          }
        }

        this.db.query(`
          UPDATE understanding_runs
          SET state = 'COMPLETED', updated_at = ?
          WHERE id = ?
        `).run(now, runId);
      });

      tx();

      return {
        runId,
        conversationId,
        cached: false,
        insightsCount: extracted.items.length,
        insights: this.listInsights(conversationId)
      };
    } catch (err) {
      this.db.query(`
        UPDATE understanding_runs
        SET state = 'FAILED', error_code = ?, updated_at = ?
        WHERE id = ?
      `).run(err.message || 'UNKNOWN_ERROR', now, runId);
      throw err;
    }
  }

  async _extractInsightsFromTurns(turns, workspaceId, conversationId) {
    // If external AI client is provided, use it; otherwise, use deterministic rule-based extractor
    const turnMap = new Map();
    turns.forEach(t => turnMap.set(t.id, t.text_raw || t.text_normalized));

    const people = this.db.query('SELECT * FROM people WHERE workspace_id = ?').all(workspaceId);
    const items = [];

    for (const turn of turns) {
      const text = turn.text_raw || turn.text_normalized || '';

      // Pattern 1: Decisions (تصمیم, تصویب, توافق, مقرر شد)
      if (text.includes('تصمیم') || text.includes('مقرر شد') || text.includes('توافق شد') || text.includes('تصویب')) {
        items.push({
          type: 'DECISION',
          title: text.length > 50 ? text.slice(0, 47) + '...' : text,
          body: text,
          confidence: 0.9,
          evidence: [{ turnId: turn.id, quote: text }]
        });
      }

      // Pattern 2: Tasks (باید, انجام بده, تسک, آماده کن, ارسال کن, پیگیری کن)
      if (text.includes('باید') || text.includes('تسک') || text.includes('پیگیری کن') || text.includes('ارسال کن') || text.includes('آماده کن') || text.includes('بررسی شود')) {
        let assigneeId = null;
        for (const person of people) {
          if (text.includes(person.display_name)) {
            assigneeId = person.id;
            break;
          }
        }

        const deadlineInfo = parseDeadline(text);

        items.push({
          type: 'TASK',
          title: text.length > 50 ? text.slice(0, 47) + '...' : text,
          body: text,
          confidence: 0.85,
          assigneePersonId: assigneeId,
          dueAtUtc: deadlineInfo.dueAtUtc,
          dueTimezone: deadlineInfo.timezone,
          dueOriginalText: deadlineInfo.originalText,
          dueParseConfidence: deadlineInfo.confidence,
          evidence: [{ turnId: turn.id, quote: text }]
        });
      }

      // Pattern 3: Commitments (قول می‌دهم, من انجام می‌دهم, متعهدم, خودم تحویل می‌دهم)
      if (text.includes('قول می‌دهم') || text.includes('من انجام می‌دهم') || text.includes('متعهدم') || text.includes('خودم تحویل می‌دهم')) {
        items.push({
          type: 'COMMITMENT',
          title: text.length > 50 ? text.slice(0, 47) + '...' : text,
          body: text,
          confidence: 0.88,
          evidence: [{ turnId: turn.id, quote: text }]
        });
      }

      // Pattern 4: Open Questions (آیا, چرا, چگونه, کی, چی شد)
      if (turn.kind === 'question' || text.endsWith('؟') || text.endsWith('?') || text.includes('آیا') || text.includes('چرا')) {
        items.push({
          type: 'OPEN_QUESTION',
          title: text.length > 50 ? text.slice(0, 47) + '...' : text,
          body: text,
          confidence: 0.8,
          evidence: [{ turnId: turn.id, quote: text }]
        });
      }

      // Pattern 5: Risks (ریسک, خطر, نگران, مشکل, تأخیر)
      if (text.includes('ریسک') || text.includes('خطر') || text.includes('مشکل') || text.includes('تأخیر') || text.includes('نگران')) {
        items.push({
          type: 'RISK',
          title: text.length > 50 ? text.slice(0, 47) + '...' : text,
          body: text,
          confidence: 0.85,
          evidence: [{ turnId: turn.id, quote: text }]
        });
      }
    }

    return { items };
  }

  _mapInsight(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      runId: row.run_id,
      type: row.type,
      title: row.title,
      body: row.body,
      status: row.status,
      confidence: row.confidence,
      assigneePersonId: row.assignee_person_id,
      dueAtUtc: row.due_at_utc,
      dueTimezone: row.due_timezone,
      dueOriginalText: row.due_original_text,
      dueParseConfidence: row.due_parse_confidence,
      fingerprint: row.fingerprint,
      createdBy: row.created_by,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
