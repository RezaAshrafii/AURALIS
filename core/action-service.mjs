import { generateId, nowIso } from './domain-models.mjs';
import { ValidationError, TASK_TRANSITIONS } from './validation.mjs';

export class ActionService {
  constructor(db) {
    this.db = db;
  }

  listTasks(workspaceId, { projectId = null, state = null, assigneePersonId = null, priority = null, includeDeleted = false } = {}) {
    let sql = 'SELECT * FROM tasks WHERE workspace_id = ?';
    const params = [workspaceId];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }
    if (state) {
      sql += ' AND state = ?';
      params.push(state);
    }
    if (assigneePersonId) {
      sql += ' AND assignee_person_id = ?';
      params.push(assigneePersonId);
    }
    if (priority) {
      sql += ' AND priority = ?';
      params.push(priority);
    }
    if (!state && !includeDeleted) sql += " AND state != 'CANCELLED'";
    sql += ' ORDER BY created_at DESC';

    return this.db.query(sql).all(...params).map(this._mapTask);
  }

  getTask(id) {
    const row = this.db.query('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!row) return null;
    const task = this._mapTask(row);

    // Attach assignee details
    if (task.assigneePersonId) {
      task.assignee = this.db.query('SELECT id, display_name, role_title FROM people WHERE id = ?').get(task.assigneePersonId);
    }

    // Attach project details
    if (task.projectId) {
      task.project = this.db.query('SELECT id, name, color_token FROM projects WHERE id = ?').get(task.projectId);
    }

    // Attach provenance from source insight & evidence
    if (task.sourceInsightId) {
      const insight = this.db.query('SELECT * FROM insight_items WHERE id = ?').get(task.sourceInsightId);
      if (insight) {
        const evidence = this.db.query('SELECT * FROM insight_evidence WHERE insight_id = ?').all(insight.id);
        task.provenance = {
          insightId: insight.id,
          conversationId: insight.conversation_id,
          type: insight.type,
          confidence: insight.confidence,
          evidence: evidence.map(e => ({
            turnId: e.turn_id,
            exactQuote: e.exact_quote
          }))
        };
      }
    }

    // Attach audit event history
    task.events = this.db.query(`
      SELECT * FROM task_events WHERE task_id = ? ORDER BY occurred_at ASC
    `).all(id).map(r => ({
      id: r.id,
      eventType: r.event_type,
      actor: r.actor,
      fromJson: r.from_json ? JSON.parse(r.from_json) : null,
      toJson: r.to_json ? JSON.parse(r.to_json) : null,
      occurredAt: r.occurred_at
    }));

    return task;
  }

  createTask(workspaceId, data) {
    const title = (data.title || '').trim();
    if (!title) throw new Error('TASK_TITLE_REQUIRED');
    const id = data.id || generateId('task');
    const now = nowIso();
    const state = ['SUGGESTED', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(data.state) ? data.state : 'TODO';
    const priority = ['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(data.priority) ? data.priority : 'NONE';

    this.db.query(`
      INSERT INTO tasks (
        id, workspace_id, project_id, conversation_id, source_insight_id, title, description,
        state, priority, assignee_person_id, due_at_utc, due_timezone, due_original_text,
        due_parse_confidence, completed_at, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      id,
      workspaceId,
      data.projectId || null,
      data.conversationId || null,
      data.sourceInsightId || null,
      title,
      data.description || null,
      state,
      priority,
      data.assigneePersonId || null,
      data.dueAtUtc || null,
      data.dueTimezone || 'Asia/Tehran',
      data.dueOriginalText || null,
      data.dueParseConfidence || null,
      state === 'DONE' ? now : null,
      now,
      now
    );

    // Record creation event
    this._recordTaskEvent(id, 'TASK_CREATED', 'user', null, { title, state, priority });

    return this.getTask(id);
  }

  updateTask(id, data, expectedRevision = null) {
    const current = this.getTask(id);
    if (!current) throw new Error('TASK_NOT_FOUND');

    if (expectedRevision !== null && current.revision !== expectedRevision) {
      const err = new Error('CONCURRENCY_CONFLICT');
      err.status = 409;
      throw err;
    }

    const title = data.title !== undefined ? (data.title || '').trim() : current.title;
    if (!title) throw new Error('TASK_TITLE_REQUIRED');

    const description = data.description !== undefined ? data.description : current.description;
    const projectId = data.projectId !== undefined ? data.projectId : current.projectId;
    const priority = data.priority !== undefined && ['NONE', 'LOW', 'MEDIUM', 'HIGH'].includes(data.priority)
      ? data.priority
      : current.priority;
    const assigneePersonId = data.assigneePersonId !== undefined ? data.assigneePersonId : current.assigneePersonId;
    const dueAtUtc = data.dueAtUtc !== undefined ? data.dueAtUtc : current.dueAtUtc;
    const dueTimezone = data.dueTimezone !== undefined ? data.dueTimezone : current.dueTimezone;
    const dueOriginalText = data.dueOriginalText !== undefined ? data.dueOriginalText : current.dueOriginalText;

    const now = nowIso();
    const newRev = current.revision + 1;

    this.db.query(`
      UPDATE tasks
      SET title = ?, description = ?, project_id = ?, priority = ?, assignee_person_id = ?,
          due_at_utc = ?, due_timezone = ?, due_original_text = ?, revision = ?, updated_at = ?
      WHERE id = ?
    `).run(title, description, projectId, priority, assigneePersonId, dueAtUtc, dueTimezone, dueOriginalText, newRev, now, id);

    this._recordTaskEvent(id, 'TASK_UPDATED', 'user', current, { title, priority, assigneePersonId, dueAtUtc });

    return this.getTask(id);
  }

  transitionTaskState(id, newState, actor = 'user') {
    const validStates = ['SUGGESTED', 'TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED'];
    if (!validStates.includes(newState)) throw new ValidationError('INVALID_TASK_STATE', `Invalid task state: ${newState}`, 400);

    const current = this.getTask(id);
    if (!current) throw new ValidationError('TASK_NOT_FOUND', 'Task not found', 404);
    if (current.state === newState) return current;

    // Enforce state machine transitions
    const allowedTransitions = TASK_TRANSITIONS[current.state];
    if (!allowedTransitions || !allowedTransitions.includes(newState)) {
      throw new ValidationError('INVALID_TASK_TRANSITION', `Cannot transition from ${current.state} to ${newState}. Allowed: ${allowedTransitions?.join(', ') || 'none'}`, 409);
    }

    const now = nowIso();
    const completedAt = newState === 'DONE' ? now : (newState === 'CANCELLED' ? null : current.completedAt);

    this.db.query(`
      UPDATE tasks
      SET state = ?, completed_at = ?, revision = revision + 1, updated_at = ?
      WHERE id = ?
    `).run(newState, completedAt, now, id);

    this._recordTaskEvent(id, 'STATE_CHANGED', actor, { state: current.state }, { state: newState });

    return this.getTask(id);
  }

  deleteTask(id, expectedRevision = null) {
    const current = this.getTask(id);
    if (!current) throw new Error('TASK_NOT_FOUND');
    if (expectedRevision !== null && current.revision !== expectedRevision) { const error = new Error('CONCURRENCY_CONFLICT'); error.status = 409; throw error; }
    if (current.state === 'CANCELLED') return current;
    const updated = this.transitionTaskState(id, 'CANCELLED', 'user');
    this._recordTaskEvent(id, 'TASK_DELETED', 'user', { state: current.state }, { state: 'CANCELLED', deletionMode: 'tombstone' });
    return updated;
  }

  confirmInsightToTask(insightId, overrides = {}) {
    const insight = this.db.query('SELECT * FROM insight_items WHERE id = ?').get(insightId);
    if (!insight) throw new Error('INSIGHT_NOT_FOUND');

    // Check if task already created from this insight
    const existingTask = this.db.query('SELECT * FROM tasks WHERE source_insight_id = ?').get(insightId);
    if (existingTask) {
      return this.getTask(existingTask.id);
    }

    const taskId = generateId('task');
    const now = nowIso();

    const tx = this.db.transaction(() => {
      // 1. Mark insight as CONFIRMED
      this.db.query(`
        UPDATE insight_items
        SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
        WHERE id = ?
      `).run(now, insightId);

      // 2. Insert Task
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, project_id, conversation_id, source_insight_id, title, description,
          state, priority, assignee_person_id, due_at_utc, due_timezone, due_original_text,
          due_parse_confidence, completed_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'TODO', 'MEDIUM', ?, ?, ?, ?, ?, NULL, 1, ?, ?)
      `).run(
        taskId,
        insight.workspace_id,
        overrides.projectId || null,
        insight.conversation_id,
        insightId,
        overrides.title || insight.title,
        overrides.description || insight.body,
        overrides.assigneePersonId || insight.assignee_person_id || null,
        overrides.dueAtUtc || insight.due_at_utc || null,
        overrides.dueTimezone || insight.due_timezone || 'Asia/Tehran',
        overrides.dueOriginalText || insight.due_original_text || null,
        insight.due_parse_confidence || null,
        now,
        now
      );

      // 3. Record task created event
      this._recordTaskEvent(taskId, 'TASK_CREATED_FROM_INSIGHT', 'user', { insightId }, { state: 'TODO', title: insight.title });
    });

    tx();

    return this.getTask(taskId);
  }

  _recordTaskEvent(taskId, eventType, actor, fromData, toData) {
    const id = generateId('tev');
    const now = nowIso();
    this.db.query(`
      INSERT INTO task_events (id, task_id, event_type, actor, from_json, to_json, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      eventType,
      actor,
      fromData ? JSON.stringify(fromData) : null,
      toData ? JSON.stringify(toData) : null,
      now
    );
  }

  _mapTask(row) {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      conversationId: row.conversation_id,
      sourceInsightId: row.source_insight_id,
      title: row.title,
      description: row.description,
      state: row.state,
      priority: row.priority,
      assigneePersonId: row.assignee_person_id,
      dueAtUtc: row.due_at_utc,
      dueTimezone: row.due_timezone,
      dueOriginalText: row.due_original_text,
      dueParseConfidence: row.due_parse_confidence,
      completedAt: row.completed_at,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
