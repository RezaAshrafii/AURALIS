import { createHash, randomUUID } from 'node:crypto';
import { generateId, nowIso } from './domain-models.mjs';
import { MemoryQueryPort, MemoryCommandPort } from './memory-ports.mjs';

export const MEMORY_PROMPT_VERSION = 'auralis-memory-candidate-v1';
export const MEMORY_OUTPUT_SCHEMA_VERSION = 1;
const SCOPE_TYPES = new Set(['USER', 'PERSON', 'PROJECT', 'WORKSPACE']);
const MEMORY_TYPES = new Set(['FACT', 'PREFERENCE', 'RELATIONSHIP', 'PROJECT_STATE', 'CONSTRAINT', 'ROUTINE']);
const SENSITIVE_PATTERN = /پزشک|بیماری|دارو|سلامت|سیاسی|حزب|رأی|مذهب|دین|قومیت|گرایش|افسرد|اضطراب/i;
const INJECTION_PATTERN = /ignore\s+(all|previous)|system\s+prompt|دستور\s+سیستم|نادیده\s+بگیر|developer\s+message|جیل\s*بریک/i;

function sha(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function normalizeMemoryKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .toLocaleLowerCase('fa')
    .replace(/[^\p{L}\p{N}]+/gu, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 160);
}

function normalizeContent(value) {
  return String(value || '').normalize('NFKC').replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();
}

function mapSettings(row) {
  if (!row) return null;
  return {
    workspaceId: row.workspace_id,
    enabled: Boolean(row.enabled),
    candidateExtractionEnabled: Boolean(row.candidate_extraction_enabled),
    autoConfirmUserPreferences: Boolean(row.auto_confirm_user_preferences),
    retentionDays: row.retention_days,
    sensitiveMemoryEnabled: Boolean(row.sensitive_memory_enabled),
    contextBudgetItems: row.context_budget_items,
    contextBudgetChars: row.context_budget_chars,
    consentGrantedAt: row.consent_granted_at || null,
    disabledAt: row.disabled_at || null,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    memoryType: row.memory_type,
    canonicalKey: row.canonical_key,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastObservedAt: row.last_observed_at,
    source: row.source,
    fingerprint: row.fingerprint,
    content: row.content_text || null,
    revision: row.memory_revision || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null
  };
}

function escapeXml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tokenize(value) {
  return normalizeContent(value).toLocaleLowerCase('fa').match(/[\p{L}\p{N}]{2,}/gu) || [];
}

export class RuleMemoryCandidateAdapter {
  extract({ turns, people, projects }) {
    const candidates = [];
    for (const turn of turns) {
      const quote = normalizeContent(turn.text_raw || turn.text_normalized);
      if (!quote || INJECTION_PATTERN.test(quote)) continue;
      const evidence = [{ turnId: turn.id, quote }];

      if (/جواب|پاسخ/.test(quote) && /کوتاه|مختصر/.test(quote)) {
        candidates.push({
          scopeType: 'USER', scopeRef: 'default-profile', memoryType: 'PREFERENCE',
          canonicalKey: 'response.length', content: 'پاسخ‌ها کوتاه و مستقیم باشند.',
          confidence: 0.94, validFromText: null, validUntilText: null,
          sensitivity: 'NORMAL', evidence
        });
      }
      if (/فارسی/.test(quote) && /رسمی/.test(quote)) {
        candidates.push({
          scopeType: 'USER', scopeRef: 'default-profile', memoryType: 'PREFERENCE',
          canonicalKey: 'response.language-style', content: 'پاسخ‌ها به فارسی رسمی نوشته شوند.',
          confidence: 0.94, validFromText: null, validUntilText: null,
          sensitivity: 'NORMAL', evidence
        });
      }

      for (const person of people) {
        if (!quote.includes(person.display_name)) continue;
        const project = projects.find(candidate => quote.includes(candidate.name));
        if (project && /مدیر|مسئول|عضو|همکار|مالک/.test(quote)) {
          candidates.push({
            scopeType: 'PERSON', scopeRef: person.id, memoryType: 'RELATIONSHIP',
            canonicalKey: `project-role.${project.id}`,
            content: quote.slice(0, 280), confidence: 0.9,
            validFromText: null, validUntilText: null, sensitivity: 'NORMAL', evidence
          });
        }
      }

      for (const project of projects) {
        if (!quote.includes(project.name)) continue;
        if (/وضعیت|متوقف|فعال|تمام|تکمیل|مهلت|بودجه|اولویت/.test(quote)) {
          candidates.push({
            scopeType: 'PROJECT', scopeRef: project.id, memoryType: 'PROJECT_STATE',
            canonicalKey: `project-state.${project.id}`,
            content: quote.slice(0, 280), confidence: 0.86,
            validFromText: null, validUntilText: null,
            sensitivity: SENSITIVE_PATTERN.test(quote) ? 'SENSITIVE' : 'NORMAL', evidence
          });
        }
      }
    }
    return { schemaVersion: MEMORY_OUTPUT_SCHEMA_VERSION, candidates };
  }
}

export class MemoryEngine extends MemoryQueryPort {
  constructor(db, { candidateAdapter = new RuleMemoryCandidateAdapter() } = {}) {
    super();
    this.db = db;
    this.candidateAdapter = candidateAdapter;
    this.commands = new MemoryCommands(this);
  }

  getSettings(workspaceId) {
    const row = this.db.query('SELECT * FROM memory_settings WHERE workspace_id = ?').get(workspaceId);
    if (!row) throw new Error('MEMORY_SETTINGS_NOT_FOUND');
    return mapSettings(row);
  }

  configureMemory(workspaceId, updates, expectedRevision = null) {
    return this.commands.configureMemory(workspaceId, updates, expectedRevision);
  }

  _assertWorkspace(workspaceId) {
    if (!this.db.query('SELECT id FROM workspaces WHERE id = ?').get(workspaceId)) throw new Error('WORKSPACE_NOT_FOUND');
  }

  _assertScope(workspaceId, scopeType, scopeId) {
    if (!SCOPE_TYPES.has(scopeType)) throw new Error('MEMORY_SCOPE_INVALID');
    if (!scopeId) throw new Error('MEMORY_SCOPE_REQUIRED');
    let row;
    if (scopeType === 'USER') row = this.db.query('SELECT id FROM local_profiles WHERE id = ?').get(scopeId);
    if (scopeType === 'WORKSPACE') row = scopeId === workspaceId ? { id: scopeId } : null;
    if (scopeType === 'PERSON') row = this.db.query('SELECT id FROM people WHERE id = ? AND workspace_id = ?').get(scopeId, workspaceId);
    if (scopeType === 'PROJECT') row = this.db.query('SELECT id FROM projects WHERE id = ? AND workspace_id = ?').get(scopeId, workspaceId);
    if (!row) throw new Error('MEMORY_SCOPE_TARGET_NOT_FOUND');
  }

  listMemories(workspaceId, { scope = null, type = null, status = null, query = null, cursor = 0, limit = 50 } = {}) {
    this._assertWorkspace(workspaceId);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeCursor = Math.max(Number(cursor) || 0, 0);
    const params = [workspaceId];
    let sql = `SELECT m.*,r.content_text,r.revision memory_revision
      FROM memory_items m LEFT JOIN memory_revisions r ON r.id=m.current_revision_id
      WHERE m.workspace_id=?`;
    if (scope) { sql += ' AND m.scope_type=?'; params.push(String(scope).toUpperCase()); }
    if (type) { sql += ' AND m.memory_type=?'; params.push(String(type).toUpperCase()); }
    if (status) { sql += ' AND m.status=?'; params.push(String(status).toUpperCase()); }
    else sql += " AND m.status!='DELETED'";
    if (query) { sql += ' AND (r.content_text LIKE ? OR m.canonical_key LIKE ?)'; const like = `%${normalizeContent(query)}%`; params.push(like, like); }
    sql += ' ORDER BY m.updated_at DESC,m.id LIMIT ? OFFSET ?';
    params.push(safeLimit + 1, safeCursor);
    const rows = this.db.query(sql).all(...params);
    return {
      memories: rows.slice(0, safeLimit).map(mapItem),
      nextCursor: rows.length > safeLimit ? safeCursor + safeLimit : null
    };
  }

  listReviewInbox(workspaceId, { cursor = 0, limit = 50 } = {}) {
    const page = this.listMemories(workspaceId, { status: 'CANDIDATE', cursor, limit });
    return { ...page, memories: page.memories.map(item => this.getMemory(workspaceId, item.id)) };
  }

  getMemory(workspaceId, id, { includeDeleted = false } = {}) {
    const row = this.db.query(`SELECT m.*,r.content_text,r.revision memory_revision
      FROM memory_items m LEFT JOIN memory_revisions r ON r.id=m.current_revision_id
      WHERE m.id=? AND m.workspace_id=?`).get(id, workspaceId);
    if (!row || (!includeDeleted && row.status === 'DELETED')) return null;
    const item = mapItem(row);
    item.revisions = this.db.query('SELECT * FROM memory_revisions WHERE memory_id=? ORDER BY revision DESC').all(id).map(revision => ({
      id: revision.id, revision: revision.revision, content: revision.content_text,
      contentJson: JSON.parse(revision.content_json || '{}'), reason: revision.reason,
      createdBy: revision.created_by, provider: revision.provider, providerModel: revision.provider_model,
      promptVersion: revision.prompt_version, inputFingerprint: revision.input_fingerprint,
      createdAt: revision.created_at,
      evidence: this.db.query('SELECT * FROM memory_evidence WHERE memory_revision_id=? ORDER BY created_at').all(revision.id).map(ev => ({
        id: ev.id, conversationId: ev.conversation_id, turnId: ev.turn_id, segmentId: ev.segment_id,
        documentChunkId: ev.document_chunk_id, evidenceType: ev.evidence_type,
        exactQuote: ev.exact_quote, observedAt: ev.observed_at, evidenceHash: ev.evidence_hash
      }))
    }));
    item.usage = this.listUsage(workspaceId, id);
    item.contradictions = this.db.query(`SELECT * FROM memory_contradictions
      WHERE workspace_id=? AND (left_memory_id=? OR right_memory_id=?) ORDER BY created_at DESC`).all(workspaceId, id, id).map(this._mapContradiction);
    item.purgeJob = this.db.query('SELECT * FROM memory_purge_jobs WHERE memory_id=?').get(id) || null;
    return item;
  }

  listUsage(workspaceId, memoryId) {
    const item = this.db.query('SELECT id FROM memory_items WHERE id=? AND workspace_id=?').get(memoryId, workspaceId);
    if (!item) throw new Error('MEMORY_NOT_FOUND');
    return this.db.query('SELECT * FROM memory_use_audits WHERE memory_id=? ORDER BY created_at DESC LIMIT 100').all(memoryId).map(row => ({
      id: row.id, conversationId: row.conversation_id, turnId: row.turn_id, purpose: row.purpose,
      rank: row.rank, score: row.score, includedChars: row.included_chars, createdAt: row.created_at
    }));
  }

  extractMemoryCandidates(workspaceId, conversationId, options = {}) {
    return this.commands.extractMemoryCandidates(workspaceId, conversationId, options);
  }
  listBackfillJobs(workspaceId) {
    this._assertWorkspace(workspaceId);
    return this.db.query('SELECT * FROM memory_backfill_jobs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 20').all(workspaceId).map(this._mapBackfillJob);
  }
  getBackfillJob(workspaceId, id) {
    const row=this.db.query('SELECT * FROM memory_backfill_jobs WHERE id=? AND workspace_id=?').get(id,workspaceId);
    return row?this._mapBackfillJob(row):null;
  }
  startBackfill(workspaceId,{batchSize=5}={}) {
    const settings=this.getSettings(workspaceId);
    if(!settings.enabled||!settings.candidateExtractionEnabled)throw new Error('MEMORY_DISABLED');
    const active=this.db.query("SELECT * FROM memory_backfill_jobs WHERE workspace_id=? AND state IN ('QUEUED','RUNNING','PAUSED') ORDER BY created_at DESC LIMIT 1").get(workspaceId);
    if(active)return this._mapBackfillJob(active);
    const now=nowIso(),id=generateId('mbackfill'),safeBatch=Math.max(1,Math.min(25,Number(batchSize)||5));
    const total=this.db.query("SELECT count(*) total FROM conversations WHERE workspace_id=? AND state='READY'").get(workspaceId).total;
    this.db.query(`INSERT INTO memory_backfill_jobs
      (id,workspace_id,state,total_count,processed_count,candidate_count,batch_size,created_at,updated_at)
      VALUES (?,?,'QUEUED',?,0,0,?,?,?)`).run(id,workspaceId,total,safeBatch,now,now);
    return this.getBackfillJob(workspaceId,id);
  }
  controlBackfill(workspaceId,id,command) {
    const job=this.getBackfillJob(workspaceId,id);if(!job)throw new Error('BACKFILL_JOB_NOT_FOUND');
    const cmd=String(command).toUpperCase(),now=nowIso();
    if(cmd==='PAUSE'&&['QUEUED','RUNNING'].includes(job.state))this.db.query("UPDATE memory_backfill_jobs SET state='PAUSED',updated_at=? WHERE id=?").run(now,id);
    else if(cmd==='RESUME'&&job.state==='PAUSED')this.db.query("UPDATE memory_backfill_jobs SET state='QUEUED',updated_at=? WHERE id=?").run(now,id);
    else if(cmd==='CANCEL'&&!['COMPLETED','CANCELLED'].includes(job.state))this.db.query("UPDATE memory_backfill_jobs SET state='CANCELLED',completed_at=?,updated_at=? WHERE id=?").run(now,now,id);
    return this.getBackfillJob(workspaceId,id);
  }
  processBackfillBatch(workspaceId,id) {
    let job=this.getBackfillJob(workspaceId,id);if(!job)throw new Error('BACKFILL_JOB_NOT_FOUND');
    if(!['QUEUED','RUNNING'].includes(job.state))return job;
    const settings=this.getSettings(workspaceId);
    if(!settings.enabled||!settings.candidateExtractionEnabled){this.db.query("UPDATE memory_backfill_jobs SET state='PAUSED',error_code='MEMORY_DISABLED',updated_at=? WHERE id=?").run(nowIso(),id);return this.getBackfillJob(workspaceId,id);}
    this.db.query("UPDATE memory_backfill_jobs SET state='RUNNING',error_code=NULL,updated_at=? WHERE id=?").run(nowIso(),id);
    const rows=this.db.query(`SELECT id,COALESCE(ended_at,started_at) cursor_time FROM conversations
      WHERE workspace_id=? AND state='READY' AND (? IS NULL OR COALESCE(ended_at,started_at)>? OR (COALESCE(ended_at,started_at)=? AND id>?))
      ORDER BY COALESCE(ended_at,started_at),id LIMIT ?`).all(workspaceId,job.cursorEndedAt,job.cursorEndedAt,job.cursorEndedAt,job.cursorConversationId||'',job.batchSize);
    let candidates=0,lastError=null;
    for(const row of rows){
      const current=this.getBackfillJob(workspaceId,id);if(current.state!=='RUNNING')return current;
      try{const result=this.extractMemoryCandidates(workspaceId,row.id,{manual:false});candidates+=(result.candidates||[]).length;}catch(error){lastError=String(error.message||error).slice(0,120);}
      this.db.query(`UPDATE memory_backfill_jobs SET processed_count=processed_count+1,candidate_count=candidate_count+?,
        cursor_ended_at=?,cursor_conversation_id=?,error_code=?,updated_at=? WHERE id=?`).run(candidates,row.cursor_time,row.id,lastError,nowIso(),id);
      candidates=0;
    }
    job=this.getBackfillJob(workspaceId,id);
    const done=rows.length<job.batchSize||job.processedCount>=job.totalCount;
    const now=nowIso();
    this.db.query(`UPDATE memory_backfill_jobs SET state=?,completed_at=?,updated_at=? WHERE id=?`).run(done?'COMPLETED':'QUEUED',done?now:null,now,id);
    return this.getBackfillJob(workspaceId,id);
  }
  confirmMemory(workspaceId, id, options = {}) { return this.commands.confirmMemory(workspaceId, id, options); }
  rejectMemory(workspaceId, id, options = {}) { return this.commands.rejectMemory(workspaceId, id, options); }
  editMemory(workspaceId, id, updates, options = {}) { return this.commands.editMemory(workspaceId, id, updates, options); }
  archiveMemory(workspaceId, id, options = {}) { return this.commands.archiveMemory(workspaceId, id, options); }
  deleteMemory(workspaceId, id, options = {}) { return this.commands.deleteMemory(workspaceId, id, options); }

  listContradictions(workspaceId, state = null) {
    let sql = 'SELECT * FROM memory_contradictions WHERE workspace_id=?';
    const params = [workspaceId];
    if (state) { sql += ' AND state=?'; params.push(state); }
    sql += ' ORDER BY created_at DESC';
    return this.db.query(sql).all(...params).map(this._mapContradiction);
  }

  resolveContradiction(workspaceId, id, resolution, options = {}) {
    return this.commands.resolveContradiction(workspaceId, id, resolution, options);
  }

  queryRelevantMemories(workspaceId, query, { scopeIds = [], conversationId = null, turnId = null, purpose = 'SEARCH', limit = null } = {}) {
    const settings = this.getSettings(workspaceId);
    if (!settings.enabled) return { enabled: false, requiresMemory: false, memories: [], budget: settings };
    const normalizedQuery = normalizeContent(query);
    const terms = [...new Set(tokenize(normalizedQuery))].slice(0, 12);
    const memorySignal = /یاد|قبلاً|ترجیح|سبک|پاسخ|جواب|فارسی|پروژه|محدودیت|روال|معمولاً/.test(normalizedQuery);
    if (!terms.length && !memorySignal) return { enabled: true, requiresMemory: false, memories: [], budget: settings };

    const now = nowIso();
    let rows = [];
    if (terms.length) {
      const match = terms.map(term => `"${term.replace(/"/g, '""')}"*`).join(' OR ');
      try {
        rows = this.db.query(`SELECT m.*,r.content_text,r.revision memory_revision,bm25(memory_index) lexical_rank
          FROM memory_index
          JOIN memory_items m ON m.id=memory_index.memory_id
          JOIN memory_revisions r ON r.id=m.current_revision_id
          WHERE memory_index MATCH ? AND m.workspace_id=? AND m.status='CONFIRMED'
            AND (m.valid_from IS NULL OR m.valid_from<=?) AND (m.valid_until IS NULL OR m.valid_until>?)
            AND (m.sensitivity='NORMAL' OR ?=1)
            AND NOT EXISTS (SELECT 1 FROM memory_contradictions c WHERE c.workspace_id=m.workspace_id AND c.state='OPEN' AND (c.left_memory_id=m.id OR c.right_memory_id=m.id))
          ORDER BY lexical_rank ASC,m.updated_at DESC LIMIT 200`).all(match, workspaceId, now, now, settings.sensitiveMemoryEnabled ? 1 : 0);
      } catch {
        rows = [];
      }
    }
    if (!rows.length && memorySignal) {
      rows = this.db.query(`SELECT m.*,r.content_text,r.revision memory_revision,0 lexical_rank
        FROM memory_items m JOIN memory_revisions r ON r.id=m.current_revision_id
        WHERE m.workspace_id=? AND m.status='CONFIRMED' AND m.memory_type='PREFERENCE'
          AND (m.valid_from IS NULL OR m.valid_from<=?) AND (m.valid_until IS NULL OR m.valid_until>?)
          AND (m.sensitivity='NORMAL' OR ?=1)
          AND NOT EXISTS (SELECT 1 FROM memory_contradictions c WHERE c.workspace_id=m.workspace_id AND c.state='OPEN' AND (c.left_memory_id=m.id OR c.right_memory_id=m.id))
        ORDER BY m.updated_at DESC LIMIT 100`).all(workspaceId, now, now, settings.sensitiveMemoryEnabled ? 1 : 0);
    }

    const allowedScopes = new Set([workspaceId, 'default-profile', ...scopeIds]);
    const queryTerms = new Set(terms);
    const ranked = rows.filter(row => allowedScopes.has(row.scope_id)).map(row => {
      const contentTerms = new Set(tokenize(`${row.canonical_key} ${row.content_text}`));
      const overlap = [...queryTerms].filter(term => contentTerms.has(term)).length;
      const lexical = queryTerms.size ? overlap / queryTerms.size : 0.25;
      const recencyDays = Math.max(0, (Date.now() - Date.parse(row.updated_at)) / 86_400_000);
      const recency = 1 / (1 + recencyDays / 90);
      const score = Number((lexical * 0.55 + Number(row.confidence) * 0.3 + recency * 0.15).toFixed(6));
      return { ...mapItem(row), score };
    }).sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));

    const itemBudget = Math.min(limit || settings.contextBudgetItems, settings.contextBudgetItems);
    const selected = [];
    const diversity = new Map();
    let chars = 0;
    for (const item of ranked) {
      const diversityKey = `${item.scopeType}:${item.memoryType}`;
      if ((diversity.get(diversityKey) || 0) >= 2) continue;
      if (selected.length >= itemBudget) break;
      const length = item.content.length;
      if (chars + length > settings.contextBudgetChars) continue;
      selected.push({ ...item, rank: selected.length + 1 });
      chars += length;
      diversity.set(diversityKey, (diversity.get(diversityKey) || 0) + 1);
    }

    if (['ANSWER_CONTEXT','SEARCH','SUGGESTION','EXPORT'].includes(purpose)) {
      for (const item of selected) {
        this.db.query(`INSERT INTO memory_use_audits
          (id,memory_id,conversation_id,turn_id,purpose,rank,score,included_chars,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(generateId('muse'), item.id, conversationId, turnId, purpose, item.rank, item.score, item.content.length, nowIso());
      }
    }
    return { enabled: true, requiresMemory: selected.length > 0, memories: selected, includedChars: chars, budget: settings };
  }

  assembleMemoryContext(workspaceId, query, options = {}) {
    const result = this.queryRelevantMemories(workspaceId, query, { ...options, purpose: 'ANSWER_CONTEXT' });
    if (!result.requiresMemory) return { ...result, block: '' };
    const lines = result.memories.map(item => {
      const evidence = this.db.query('SELECT turn_id FROM memory_evidence WHERE memory_revision_id=? AND turn_id IS NOT NULL ORDER BY created_at LIMIT 1').get(item.currentRevisionId);
      return `- [memoryId=${escapeXml(item.id)} scope=${item.scopeType}:${escapeXml(item.scopeId)} confidence=${item.confidence} evidence=${evidence?.turn_id ? `turn:${escapeXml(evidence.turn_id)}` : 'user-edit'}] ${escapeXml(item.content)}`;
    });
    const block = `<auralis_memory_data version="1" trust="untrusted-user-controlled-data">\n${lines.join('\n')}\n</auralis_memory_data>`;
    return { ...result, block };
  }

  exportMemories(workspaceId, format = 'BOTH') { return this.commands.exportMemories(workspaceId, format); }
  getExport(workspaceId, jobId) {
    const row = this.db.query('SELECT * FROM memory_exports WHERE id=? AND workspace_id=?').get(jobId, workspaceId);
    if (!row) return null;
    return { id: row.id, workspaceId: row.workspace_id, state: row.state, format: row.format,
      json: row.payload_json ? JSON.parse(row.payload_json) : null, markdown: row.payload_markdown,
      itemCount: row.item_count, errorCode: row.error_code, createdAt: row.created_at, completedAt: row.completed_at };
  }

  rebuildMemoryIndex(workspaceId = null) {
    if (workspaceId) this.db.query('DELETE FROM memory_index WHERE workspace_id=?').run(workspaceId);
    else this.db.exec('DELETE FROM memory_index;');
    let sql = `SELECT m.*,r.content_text FROM memory_items m JOIN memory_revisions r ON r.id=m.current_revision_id WHERE m.status='CONFIRMED'`;
    const rows = workspaceId ? this.db.query(`${sql} AND m.workspace_id=?`).all(workspaceId) : this.db.query(sql).all();
    const insert = this.db.query(`INSERT INTO memory_index
      (memory_id,workspace_id,scope_type,scope_id,memory_type,canonical_key,content_text) VALUES (?,?,?,?,?,?,?)`);
    for (const row of rows) insert.run(row.id,row.workspace_id,row.scope_type,row.scope_id,row.memory_type,row.canonical_key,row.content_text);
    return { indexed: rows.length };
  }

  _mapContradiction(row) {
    return { id: row.id, workspaceId: row.workspace_id, leftMemoryId: row.left_memory_id,
      rightMemoryId: row.right_memory_id, state: row.state, reason: row.reason,
      confidence: row.confidence, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
  _mapBackfillJob(row) {
    return {id:row.id,workspaceId:row.workspace_id,state:row.state,totalCount:row.total_count,
      processedCount:row.processed_count,candidateCount:row.candidate_count,batchSize:row.batch_size,
      cursorEndedAt:row.cursor_ended_at,cursorConversationId:row.cursor_conversation_id,errorCode:row.error_code,
      createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at};
  }
}

class MemoryCommands extends MemoryCommandPort {
  constructor(engine) { super(); this.engine = engine; this.db = engine.db; }

  _audit({ workspaceId, memoryId = null, command, actor = 'USER', idempotencyKey, before = null, after = null }) {
    const key = idempotencyKey || `${command}:${memoryId || workspaceId}:${randomUUID()}`;
    const existing = this.db.query('SELECT * FROM memory_command_audits WHERE idempotency_key=?').get(key);
    if (existing) return existing;

    // Store only change descriptors and content hashes, never raw content
    // This prevents privacy leaks in audit trail
    function sanitizeForAudit(obj) {
      if (!obj) return null;
      const sanitized = { ...obj };
      // Remove raw content fields that contain user data
      delete sanitized.content;
      delete sanitized.content_text;
      delete sanitized.content_json;
      // Sanitize evidence array - keep structure but hash quotes
      if (Array.isArray(sanitized.evidence)) {
        sanitized.evidence = sanitized.evidence.map(e => ({
          ...e,
          exact_quote: e.exact_quote ? sha(e.exact_quote) : null,
          exact_quote_hash: e.exact_quote ? sha(e.exact_quote) : null,
          exact_quote: undefined // will be removed below
        })).map(e => {
          const { exact_quote, ...rest } = e;
          return rest;
        });
      }
      // Sanitize revisions array
      if (Array.isArray(sanitized.revisions)) {
        sanitized.revisions = sanitized.revisions.map(r => {
          const { content, contentJson, evidence, ...rest } = r;
          return {
            ...rest,
            content_hash: content ? sha(content) : null,
            content_json_hash: contentJson ? sha(contentJson) : null,
            evidence_count: Array.isArray(evidence) ? evidence.length : 0
          };
        });
      }
      // Remove any remaining content-like fields
      const redactedKeys = ['content', 'content_text', 'content_json', 'exact_quote', 'quote'];
      for (const key of redactedKeys) {
        if (sanitized[key] !== undefined) delete sanitized[key];
      }
      return sanitized;
    }

    const beforeSanitized = before ? sanitizeForAudit(before) : null;
    const afterSanitized = after ? sanitizeForAudit(after) : null;

    this.db.query(`INSERT INTO memory_command_audits
      (id,workspace_id,memory_id,command,actor,idempotency_key,before_json,after_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(generateId('mcmd'), workspaceId, memoryId, command, actor, key,
        beforeSanitized ? JSON.stringify(beforeSanitized) : null,
        afterSanitized ? JSON.stringify(afterSanitized) : null,
        nowIso());
    return null;
  }

  configureMemory(workspaceId, updates, expectedRevision = null) {
    const current = this.engine.getSettings(workspaceId);
    if (expectedRevision !== null && current.revision !== expectedRevision) { const error = new Error('CONCURRENCY_CONFLICT'); error.status = 409; throw error; }
    if (updates.enabled === true && updates.consent !== true && !current.enabled) throw new Error('MEMORY_CONSENT_REQUIRED');
    const enabled = updates.enabled === undefined ? current.enabled : Boolean(updates.enabled);
    const extraction = enabled && (updates.candidateExtractionEnabled === undefined ? current.candidateExtractionEnabled : Boolean(updates.candidateExtractionEnabled));
    const autoConfirm = Boolean(updates.autoConfirmUserPreferences === undefined ? current.autoConfirmUserPreferences : updates.autoConfirmUserPreferences);
    const sensitive = Boolean(updates.sensitiveMemoryEnabled === undefined ? current.sensitiveMemoryEnabled : updates.sensitiveMemoryEnabled);
    const retentionDays = updates.retentionDays === undefined ? current.retentionDays : (updates.retentionDays === null ? null : Math.max(1, Math.min(3650, Number(updates.retentionDays))));
    const budgetItems = Math.max(1, Math.min(30, Number(updates.contextBudgetItems ?? current.contextBudgetItems)));
    const budgetChars = Math.max(200, Math.min(12000, Number(updates.contextBudgetChars ?? current.contextBudgetChars)));
    const now = nowIso();
    const consentGrantedAt = enabled ? (current.consentGrantedAt || now) : current.consentGrantedAt;
    const disabledAt = enabled ? null : (current.enabled ? now : current.disabledAt);
    this.db.query(`UPDATE memory_settings SET enabled=?,candidate_extraction_enabled=?,auto_confirm_user_preferences=?,
      retention_days=?,sensitive_memory_enabled=?,context_budget_items=?,context_budget_chars=?,consent_granted_at=?,disabled_at=?,revision=revision+1,updated_at=? WHERE workspace_id=?`)
      .run(enabled?1:0,extraction?1:0,autoConfirm?1:0,retentionDays,sensitive?1:0,budgetItems,budgetChars,consentGrantedAt,disabledAt,now,workspaceId);
    const updated = this.engine.getSettings(workspaceId);
    this._audit({workspaceId,command:'CONFIGURE_MEMORY',before:current,after:updated,idempotencyKey:updates.idempotencyKey});
    return updated;
  }

  extractMemoryCandidates(workspaceId, conversationId, options = {}) {
    const settings = this.engine.getSettings(workspaceId);
    if (!settings.enabled || !settings.candidateExtractionEnabled) throw new Error('MEMORY_DISABLED');
    const conversation = this.db.query('SELECT * FROM conversations WHERE id=? AND workspace_id=?').get(conversationId, workspaceId);
    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    if (!options.manual && conversation.state !== 'READY') throw new Error('CONVERSATION_NOT_READY');
    const sessionId = conversation.capture_session_id || conversation.id.replace(/^conv-/, '');
    const turns = this.db.query('SELECT * FROM turns WHERE session_id=? ORDER BY ordinal').all(sessionId);
    const inputFingerprint = sha(turns.map(turn => `${turn.id}:${turn.text_normalized}`).join('|'));
    const prior = this.db.query('SELECT * FROM memory_extraction_runs WHERE conversation_id=? AND input_fingerprint=? AND prompt_version=?')
      .get(conversationId, inputFingerprint, MEMORY_PROMPT_VERSION);
    if (prior?.state === 'COMPLETED' && !options.force) {
      return { runId: prior.id, cached: true, candidates: this.engine.listReviewInbox(workspaceId).memories };
    }
    const runId = prior?.id || generateId('mrun');
    const now = nowIso();
    if (prior) this.db.query("UPDATE memory_extraction_runs SET state='RUNNING',error_code=NULL,updated_at=? WHERE id=?").run(now, runId);
    else this.db.query(`INSERT INTO memory_extraction_runs
      (id,workspace_id,conversation_id,input_fingerprint,prompt_version,state,candidate_count,created_at,updated_at)
      VALUES (?,?,?,?,?,'RUNNING',0,?,?)`).run(runId,workspaceId,conversationId,inputFingerprint,MEMORY_PROMPT_VERSION,now,now);
    try {
      const people = this.db.query("SELECT * FROM people WHERE workspace_id=? AND status!='ARCHIVED'").all(workspaceId);
      const projects = this.db.query("SELECT * FROM projects WHERE workspace_id=? AND status!='ARCHIVED'").all(workspaceId);
      const output = this.engine.candidateAdapter.extract({turns,people,projects});
      const created = [];
      for (const candidate of output.candidates || []) {
        const validated = this._validateCandidate(workspaceId, conversationId, candidate, turns, settings);
        if (!validated) continue;
        const item = this._insertCandidate(workspaceId, conversationId, validated, inputFingerprint);
        if (item) created.push(item);
      }
      this.db.query("UPDATE memory_extraction_runs SET state='COMPLETED',candidate_count=?,updated_at=? WHERE id=?").run(created.length,nowIso(),runId);
      this._audit({workspaceId,command:'EXTRACT_CANDIDATES',actor:'AI',after:{conversationId,created:created.map(x=>x.id)},idempotencyKey:`extract:${runId}`});
      return { runId, cached: false, candidates: created };
    } catch (error) {
      this.db.query("UPDATE memory_extraction_runs SET state='FAILED',error_code=?,updated_at=? WHERE id=?").run(String(error.message).slice(0,120),nowIso(),runId);
      throw error;
    }
  }

  _validateCandidate(workspaceId, conversationId, candidate, turns, settings) {
    const scopeType = String(candidate.scopeType || '').toUpperCase();
    const memoryType = String(candidate.memoryType || '').toUpperCase();
    const content = normalizeContent(candidate.content).slice(0, 400);
    const canonicalKey = normalizeMemoryKey(candidate.canonicalKey);
    if (!SCOPE_TYPES.has(scopeType) || !MEMORY_TYPES.has(memoryType) || !content || !canonicalKey) return null;
    if (content.length > 400 || /[\r\n]{2,}/.test(content) || INJECTION_PATTERN.test(content)) return null;
    this.engine._assertScope(workspaceId, scopeType, candidate.scopeRef);
    const sensitivity = String(candidate.sensitivity || 'NORMAL').toUpperCase() === 'SENSITIVE' || SENSITIVE_PATTERN.test(content) ? 'SENSITIVE' : 'NORMAL';
    if (sensitivity === 'SENSITIVE' && !settings.sensitiveMemoryEnabled) return null;
    const evidence = [];
    for (const proposed of candidate.evidence || []) {
      const turn = turns.find(row => row.id === proposed.turnId);
      const quote = normalizeContent(proposed.quote);
      if (!turn || !quote || !normalizeContent(turn.text_raw).includes(quote)) continue;
      evidence.push({turnId:turn.id,quote});
    }
    if (!evidence.length) return null;
    return {
      scopeType, scopeId:candidate.scopeRef, memoryType, canonicalKey, content,
      confidence:Math.max(0,Math.min(1,Number(candidate.confidence)||0)), sensitivity,
      validFrom:candidate.validFromText||null, validUntil:candidate.validUntilText||null, evidence,
      conversationId
    };
  }

  _insertCandidate(workspaceId, conversationId, candidate, inputFingerprint) {
    const fingerprint = sha(`${workspaceId}|${candidate.scopeType}|${candidate.scopeId}|${candidate.canonicalKey}|${normalizeContent(candidate.content)}`);
    const existing = this.db.query(`SELECT id FROM memory_items WHERE workspace_id=? AND scope_type=? AND scope_id=? AND fingerprint=?
      AND status IN ('CANDIDATE','CONFIRMED')`).get(workspaceId,candidate.scopeType,candidate.scopeId,fingerprint);
    if (existing) return this.engine.getMemory(workspaceId,existing.id);
    const id=generateId('mem'),revisionId=generateId('mrev'),now=nowIso();
    this.db.transaction(() => {
      this.db.query(`INSERT INTO memory_items
        (id,workspace_id,scope_type,scope_id,memory_type,canonical_key,status,current_revision_id,confidence,sensitivity,
         valid_from,valid_until,last_observed_at,source,fingerprint,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'CANDIDATE',NULL,?,?,?,?,?,'AI',?,?,?)`).run(
          id,workspaceId,candidate.scopeType,candidate.scopeId,candidate.memoryType,candidate.canonicalKey,candidate.confidence,
          candidate.sensitivity,candidate.validFrom,candidate.validUntil,now,fingerprint,now,now);
      this.db.query(`INSERT INTO memory_revisions
        (id,memory_id,revision,content_text,content_json,reason,created_by,provider,provider_model,prompt_version,input_fingerprint,created_at)
        VALUES (?,?,1,?,?,'EXTRACTED','AI','auralis-rule-extractor','deterministic-v1',?,?,?)`).run(
          revisionId,id,candidate.content,JSON.stringify({schemaVersion:1,content:candidate.content}),MEMORY_PROMPT_VERSION,inputFingerprint,now);
      for (const evidence of candidate.evidence) {
        this.db.query(`INSERT INTO memory_evidence
          (id,memory_revision_id,conversation_id,turn_id,evidence_type,exact_quote,observed_at,evidence_hash,created_at)
          VALUES (?,?,?,?,'SOURCE',?,?,?,?)`).run(generateId('mev'),revisionId,conversationId,evidence.turnId,evidence.quote,now,sha(`${evidence.turnId}|${evidence.quote}`),now);
      }
      this.db.query('UPDATE memory_items SET current_revision_id=? WHERE id=?').run(revisionId,id);
    })();
    return this.engine.getMemory(workspaceId,id);
  }

  _get(workspaceId,id,includeDeleted=false) {
    const item=this.engine.getMemory(workspaceId,id,{includeDeleted});
    if(!item) throw new Error('MEMORY_NOT_FOUND');
    return item;
  }

  confirmMemory(workspaceId,id,options={}) {
    const current=this._get(workspaceId,id);
    if(current.status==='CONFIRMED') return current;
    if(current.status!=='CANDIDATE') throw new Error('MEMORY_NOT_CONFIRMABLE');
    if(!current.revisions?.[0]?.evidence?.length) throw new Error('MEMORY_PROVENANCE_REQUIRED');
    this.db.query("UPDATE memory_items SET status='CONFIRMED',updated_at=? WHERE id=?").run(nowIso(),id);
    this.engine.rebuildMemoryIndex(workspaceId);
    this._detectContradictions(workspaceId,id);
    const updated=this._get(workspaceId,id);
    this._audit({workspaceId,memoryId:id,command:'CONFIRM',before:current,after:updated,idempotencyKey:options.idempotencyKey});
    return updated;
  }

  rejectMemory(workspaceId,id,options={}) {
    const current=this._get(workspaceId,id);
    this.db.query("UPDATE memory_items SET status='REJECTED',updated_at=? WHERE id=?").run(nowIso(),id);
    this.engine.rebuildMemoryIndex(workspaceId);
    const updated=this._get(workspaceId,id);
    this._audit({workspaceId,memoryId:id,command:'REJECT',before:current,after:updated,idempotencyKey:options.idempotencyKey});
    return updated;
  }

  editMemory(workspaceId,id,updates,options={}) {
    const current=this._get(workspaceId,id);
    const content=normalizeContent(updates.content ?? current.content).slice(0,400);
    if(!content || INJECTION_PATTERN.test(content)) throw new Error('MEMORY_CONTENT_INVALID');
    if(options.expectedRevision!==undefined && Number(options.expectedRevision)!==Number(current.revision)) {const error=new Error('CONCURRENCY_CONFLICT');error.status=409;throw error;}
    const revision=Number(current.revision)+1,revisionId=generateId('mrev'),now=nowIso();
    const canonicalKey=updates.canonicalKey?normalizeMemoryKey(updates.canonicalKey):current.canonicalKey;
    const fingerprint=sha(`${workspaceId}|${current.scopeType}|${current.scopeId}|${canonicalKey}|${content}`);
    this.db.transaction(()=>{
      this.db.query(`INSERT INTO memory_revisions
        (id,memory_id,revision,content_text,content_json,reason,created_by,created_at)
        VALUES (?,?,?,?,?,'USER_EDIT','USER',?)`).run(revisionId,id,revision,content,JSON.stringify({schemaVersion:1,content}),now);
      this.db.query(`INSERT INTO memory_evidence
        (id,memory_revision_id,evidence_type,exact_quote,observed_at,evidence_hash,created_at)
        VALUES (?,?,'USER_EDIT',?,?,?,?)`).run(generateId('mev'),revisionId,content,now,sha(`USER_EDIT|${id}|${revision}|${content}`),now);
      this.db.query(`UPDATE memory_items SET canonical_key=?,current_revision_id=?,confidence=?,valid_from=?,valid_until=?,fingerprint=?,updated_at=? WHERE id=?`)
        .run(canonicalKey,revisionId,updates.confidence??current.confidence,updates.validFrom??current.validFrom,updates.validUntil??current.validUntil,fingerprint,now,id);
    })();
    this.engine.rebuildMemoryIndex(workspaceId);
    if(current.status==='CONFIRMED') this._detectContradictions(workspaceId,id);
    const updated=this._get(workspaceId,id);
    this._audit({workspaceId,memoryId:id,command:'EDIT',before:current,after:updated,idempotencyKey:options.idempotencyKey});
    return updated;
  }

  archiveMemory(workspaceId,id,options={}) {
    const current=this._get(workspaceId,id);
    this.db.query("UPDATE memory_items SET status='ARCHIVED',updated_at=? WHERE id=?").run(nowIso(),id);
    this.engine.rebuildMemoryIndex(workspaceId);
    const updated=this._get(workspaceId,id);
    this._audit({workspaceId,memoryId:id,command:'ARCHIVE',before:current,after:updated,idempotencyKey:options.idempotencyKey});
    return updated;
  }

  deleteMemory(workspaceId,id,options={}) {
    const current=this._get(workspaceId,id,true);
    if(current.status==='DELETED') return {memory:current,purgeJob:current.purgeJob};
    const now=nowIso();
    this.db.query("UPDATE memory_items SET status='DELETED',deleted_at=?,updated_at=? WHERE id=?").run(now,now,id);
    this.db.query('DELETE FROM memory_index WHERE memory_id=?').run(id);
    let job=this.db.query('SELECT * FROM memory_purge_jobs WHERE memory_id=?').get(id);
    if(!job){const jobId=generateId('mpurge');this.db.query(`INSERT INTO memory_purge_jobs
      (id,workspace_id,memory_id,state,attempt,created_at,updated_at) VALUES (?,?,?,'QUEUED',0,?,?)`).run(jobId,workspaceId,id,now,now);job=this.db.query('SELECT * FROM memory_purge_jobs WHERE id=?').get(jobId);}
    this._audit({workspaceId,memoryId:id,command:'DELETE',before:current,after:{status:'DELETED',purgeJobId:job.id},idempotencyKey:options.idempotencyKey});
    if(options.purgeNow!==false) job=this._purge(job.id);
    return {memory:this.engine.getMemory(workspaceId,id,{includeDeleted:true}),purgeJob:job};
  }

  _purge(jobId) {
    const job=this.db.query('SELECT * FROM memory_purge_jobs WHERE id=?').get(jobId);
    if(!job) throw new Error('PURGE_JOB_NOT_FOUND');
    if(job.state==='COMPLETED') return job;
    const now=nowIso();
    try {
      this.db.query("UPDATE memory_purge_jobs SET state='RUNNING',attempt=attempt+1,updated_at=? WHERE id=?").run(now,jobId);
      const item=this.db.query("SELECT id FROM memory_items WHERE id=? AND status='DELETED'").get(job.memory_id);
      const memoryId = item?.id || job.memory_id;
      if(item){
        // 1. Purge memory_revisions content
        this.db.query("UPDATE memory_revisions SET content_text='[purged]',content_json='{\"schemaVersion\":1,\"purged\":true}' WHERE memory_id=?").run(item.id);
        // 2. Purge memory_evidence quotes
        this.db.query("UPDATE memory_evidence SET exact_quote='[purged]',evidence_hash=? WHERE memory_revision_id IN (SELECT id FROM memory_revisions WHERE memory_id=?)").run(sha('[purged]'),item.id);
        // 3. Purge memory_index
        this.db.query('DELETE FROM memory_index WHERE memory_id=?').run(item.id);
      }

      // 4. Purge memory_command_audits - redact before_json/after_json for this memory_id
      // Use REPLACE to redact content fields in JSON strings (SQLite doesn't have json_replace)
      this.db.query(`
        UPDATE memory_command_audits
        SET before_json = CASE 
          WHEN before_json IS NOT NULL AND before_json LIKE '%"content"%' THEN REPLACE(before_json, '"content":"', '"content":"[purged]","_original_content":"')
          WHEN before_json IS NOT NULL AND before_json LIKE '%"content_text"%' THEN REPLACE(before_json, '"content_text":"', '"content_text":"[purged]","_original_content_text":"')
          WHEN before_json IS NOT NULL AND before_json LIKE '%"content_json"%' THEN REPLACE(before_json, '"content_json":"', '"content_json":"[purged]","_original_content_json":"')
          ELSE before_json
        END,
        after_json = CASE
          WHEN after_json IS NOT NULL AND after_json LIKE '%"content"%' THEN REPLACE(after_json, '"content":"', '"content":"[purged]","_original_content":"')
          WHEN after_json IS NOT NULL AND after_json LIKE '%"content_text"%' THEN REPLACE(after_json, '"content_text":"', '"content_text":"[purged]","_original_content_text":"')
          WHEN after_json IS NOT NULL AND after_json LIKE '%"content_json"%' THEN REPLACE(after_json, '"content_json":"', '"content_json":"[purged]","_original_content_json":"')
          ELSE after_json
        END
        WHERE memory_id = ?
      `).run(memoryId);

      // 5. Purge memory_exports - remove the deleted memory from payload_json
      const exportsWithMemory = this.db.query(`
        SELECT id, payload_json FROM memory_exports
        WHERE payload_json IS NOT NULL AND payload_json LIKE '%' || ? || '%'
      `).all(memoryId);

      for (const exp of exportsWithMemory) {
        try {
          const payload = JSON.parse(exp.payload_json);
          if (payload.items && Array.isArray(payload.items)) {
            const originalLength = payload.items.length;
            payload.items = payload.items.filter(item => item.id !== memoryId);
            if (payload.items.length !== originalLength) {
              payload.item_count = payload.items.length;
              this.db.query('UPDATE memory_exports SET payload_json=?, item_count=?, updated_at=? WHERE id=?')
                .run(JSON.stringify(payload), payload.item_count, nowIso(), exp.id);
            }
          }
        } catch (e) {
          // If JSON parsing fails, skip this export
        }
      }

      // 6. Purge memory_use_audits for this memory (optional - keep for audit trail of usage)
      // We keep usage audits as they don't contain content, only metadata

      // 7. Verify purge completeness - scan all content-bearing stores for the memory's content
      const purgeFailures = [];

      // Check memory_revisions
      const remainingRevisions = this.db.query(`
        SELECT id FROM memory_revisions
        WHERE memory_id = ? AND content_text != '[purged]'
      `).all(memoryId);
      if (remainingRevisions.length > 0) {
        purgeFailures.push({ table: 'memory_revisions', count: remainingRevisions.length });
      }

      // Check memory_evidence
      const remainingEvidence = this.db.query(`
        SELECT e.id FROM memory_evidence e
        JOIN memory_revisions r ON r.id = e.memory_revision_id
        WHERE r.memory_id = ? AND e.exact_quote != '[purged]'
      `).all(memoryId);
      if (remainingEvidence.length > 0) {
        purgeFailures.push({ table: 'memory_evidence', count: remainingEvidence.length });
      }

      // Check memory_index
      const remainingIndex = this.db.query(`
        SELECT rowid FROM memory_index WHERE memory_id = ?
      `).all(memoryId);
      if (remainingIndex.length > 0) {
        purgeFailures.push({ table: 'memory_index', count: remainingIndex.length });
      }

      // Check memory_command_audits for any remaining content (before_json/after_json containing the memory_id with content)
      const remainingAudits = this.db.query(`
        SELECT id FROM memory_command_audits
        WHERE memory_id = ? 
        AND (before_json LIKE '%"content"%' OR after_json LIKE '%"content"%')
      `).all(memoryId);
      if (remainingAudits.length > 0) {
        purgeFailures.push({ table: 'memory_command_audits', count: remainingAudits.length });
      }

      if (purgeFailures.length > 0) {
        const failureMsg = `PURGE_INCOMPLETE: ${JSON.stringify(purgeFailures)}`;
        this.db.query("UPDATE memory_purge_jobs SET state='FAILED',error_code=?,updated_at=? WHERE id=?")
          .run(failureMsg.slice(0, 120), nowIso(), jobId);
        throw new Error(failureMsg);
      }

      this.db.query("UPDATE memory_purge_jobs SET state='COMPLETED',completed_at=?,updated_at=? WHERE id=?")
        .run(nowIso(), nowIso(), jobId);
    } catch(error) {
      if (!String(error.message).startsWith('PURGE_INCOMPLETE')) {
        this.db.query("UPDATE memory_purge_jobs SET state='FAILED',error_code=?,updated_at=? WHERE id=?")
          .run(String(error.message).slice(0,120),nowIso(),jobId);
      }
      throw error;
    }
    return this.db.query('SELECT * FROM memory_purge_jobs WHERE id=?').get(jobId);
  }

  _detectContradictions(workspaceId,id) {
    const item=this.db.query(`SELECT m.*,r.content_text FROM memory_items m JOIN memory_revisions r ON r.id=m.current_revision_id WHERE m.id=?`).get(id);
    if(!item||item.status!=='CONFIRMED') return [];
    const others=this.db.query(`SELECT m.id,r.content_text FROM memory_items m JOIN memory_revisions r ON r.id=m.current_revision_id
      WHERE m.workspace_id=? AND m.scope_type=? AND m.scope_id=? AND m.canonical_key=? AND m.status='CONFIRMED' AND m.id!=?`)
      .all(workspaceId,item.scope_type,item.scope_id,item.canonical_key,id);
    const created=[];
    for(const other of others){if(normalizeContent(other.content_text)===normalizeContent(item.content_text))continue;
      const [left,right]=[id,other.id].sort();
      const existing=this.db.query('SELECT id FROM memory_contradictions WHERE left_memory_id=? AND right_memory_id=?').get(left,right);
      if(existing)continue;
      const cid=generateId('mcon'),now=nowIso();
      this.db.query(`INSERT INTO memory_contradictions
        (id,workspace_id,left_memory_id,right_memory_id,state,reason,confidence,created_at,updated_at)
        VALUES (?,?,?,?,'OPEN','same canonical key with different confirmed content',0.9,?,?)`).run(cid,workspaceId,left,right,now,now);created.push(cid);
    }
    return created;
  }

  resolveContradiction(workspaceId,id,resolution,options={}) {
    const row=this.db.query('SELECT * FROM memory_contradictions WHERE id=? AND workspace_id=?').get(id,workspaceId);
    if(!row) throw new Error('CONTRADICTION_NOT_FOUND');
    const state=String(resolution||'').toUpperCase();
    if(!['RESOLVED_LEFT','RESOLVED_RIGHT','MERGED','DISMISSED'].includes(state)) throw new Error('CONTRADICTION_RESOLUTION_INVALID');
    const now=nowIso();
    this.db.transaction(()=>{
      this.db.query('UPDATE memory_contradictions SET state=?,resolved_by=?,resolved_at=?,updated_at=? WHERE id=?').run(state,'USER',now,now,id);
      if(state==='RESOLVED_LEFT')this.db.query("UPDATE memory_items SET status='SUPERSEDED',updated_at=? WHERE id=?").run(now,row.right_memory_id);
      if(state==='RESOLVED_RIGHT')this.db.query("UPDATE memory_items SET status='SUPERSEDED',updated_at=? WHERE id=?").run(now,row.left_memory_id);
      if(state==='MERGED')this.db.query("UPDATE memory_items SET status='SUPERSEDED',updated_at=? WHERE id=?").run(now,row.right_memory_id);
    })();
    this.engine.rebuildMemoryIndex(workspaceId);
    const updated=this.db.query('SELECT * FROM memory_contradictions WHERE id=?').get(id);
    this._audit({workspaceId,command:'RESOLVE_CONTRADICTION',after:{id,state},idempotencyKey:options.idempotencyKey});
    return this.engine._mapContradiction(updated);
  }

  exportMemories(workspaceId,format='BOTH') {
    const normalized=['JSON','MARKDOWN','BOTH'].includes(String(format).toUpperCase())?String(format).toUpperCase():'BOTH';
    const id=generateId('mexp'),now=nowIso();
    this.db.query(`INSERT INTO memory_exports
      (id,workspace_id,state,format,item_count,created_at,updated_at) VALUES (?,?,'RUNNING',?,0,?,?)`).run(id,workspaceId,normalized,now,now);
    try {
      const rows=this.db.query(`SELECT m.*,r.content_text,r.revision memory_revision FROM memory_items m
        JOIN memory_revisions r ON r.id=m.current_revision_id WHERE m.workspace_id=? AND m.status!='DELETED' ORDER BY m.updated_at DESC`).all(workspaceId);
      const items=rows.map(mapItem);
      const payload={schemaVersion:1,exportedAt:nowIso(),workspaceId,items:items.map(item=>({
        id:item.id,scopeType:item.scopeType,scopeId:item.scopeId,memoryType:item.memoryType,canonicalKey:item.canonicalKey,
        status:item.status,content:item.content,confidence:item.confidence,sensitivity:item.sensitivity,validFrom:item.validFrom,validUntil:item.validUntil,
        revision:item.revision,source:item.source,createdAt:item.createdAt,updatedAt:item.updatedAt
      }))};
      const markdown=['# Auralis Memory Export','',`Exported: ${payload.exportedAt}`,'',...payload.items.map(item=>`## ${item.canonicalKey}\n\n- Scope: ${item.scopeType}:${item.scopeId}\n- Type: ${item.memoryType}\n- Status: ${item.status}\n- Content: ${item.content}\n`) ].join('\n');
      this.db.query(`UPDATE memory_exports SET state='COMPLETED',payload_json=?,payload_markdown=?,item_count=?,completed_at=?,updated_at=? WHERE id=?`)
        .run(normalized==='MARKDOWN'?null:JSON.stringify(payload),normalized==='JSON'?null:markdown,items.length,nowIso(),nowIso(),id);
      for(const [rank,item] of items.entries())this.db.query(`INSERT INTO memory_use_audits
        (id,memory_id,purpose,rank,score,included_chars,created_at) VALUES (?,?,'EXPORT',?,?,?,?)`)
        .run(generateId('muse'),item.id,rank+1,1,item.content.length,nowIso());
      this._audit({workspaceId,command:'EXPORT',after:{jobId:id,itemCount:items.length},idempotencyKey:`export:${id}`});
    }catch(error){this.db.query("UPDATE memory_exports SET state='FAILED',error_code=?,updated_at=? WHERE id=?").run(String(error.message).slice(0,120),nowIso(),id);}
    return this.engine.getExport(workspaceId,id);
  }
}
