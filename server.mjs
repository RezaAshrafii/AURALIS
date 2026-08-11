import { Database } from 'bun:sqlite';
import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { routePersian, normalizeFa } from './core/persian-router.mjs';
import { parseAnswerEnvelope, AnswerSchemaError } from './core/answer-schema.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const APP = join(ROOT, 'app');
const DATA = join(ROOT, 'data');
await mkdir(DATA, { recursive: true });

const HOST = '127.0.0.1';
const PORT = 47826;
const ORIGIN = `http://${HOST}:${PORT}`;
const TOKEN = randomBytes(32).toString('hex');
const VERSION = '0.10.4-live-transcript-validation.1';
const SCHEMA_VERSION = 5;
const DB_PATH = join(DATA, 'auralis-v0104-ledger.sqlite');
const NATIVE_PROBE = join(ROOT, 'native', 'auralis-capture-probe.exe');
const AUDIO_ROOT = join(DATA, 'audio');
await mkdir(AUDIO_ROOT, { recursive: true });
const PROVIDER_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const db = new Database(DB_PATH, { create: true, strict: true });
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  source_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  route_reason TEXT NOT NULL,
  route_score REAL NOT NULL,
  client_request_id TEXT,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_session_ordinal ON turns(session_id,ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_request_id ON turns(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS answer_results(
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  lane TEXT NOT NULL,
  model TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  grounding TEXT NOT NULL,
  source_chunk_ids_json TEXT NOT NULL,
  retrieved_json TEXT NOT NULL,
  invalid_citation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(turn_id) REFERENCES turns(id)
);
CREATE INDEX IF NOT EXISTS idx_answer_turn ON answer_results(turn_id,created_at);
CREATE TABLE IF NOT EXISTS gaps(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  seq_start INTEGER,
  seq_end INTEGER,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audio_channels(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  sample_rate INTEGER,
  channels INTEGER,
  block_align INTEGER,
  format_tag INTEGER,
  bits_per_sample INTEGER,
  state TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  stopped_at TEXT,
  last_error TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE TABLE IF NOT EXISTS audio_chunks(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  qpc_start_100ns INTEGER,
  qpc_end_100ns INTEGER,
  sample_rate INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  block_align INTEGER NOT NULL,
  format_tag INTEGER,
  bits_per_sample INTEGER,
  path TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  discontinuity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(session_id,channel_id,seq_start,seq_end),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_audio_chunks_session_channel_seq ON audio_chunks(session_id,channel_id,seq_start);
CREATE TABLE IF NOT EXISTS native_capture_runs(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  pid INTEGER,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  last_heartbeat_at TEXT,
  queue_depth INTEGER NOT NULL DEFAULT 0,
  queue_capacity INTEGER NOT NULL DEFAULT 0,
  probe_engine TEXT NOT NULL,
  error TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE TABLE IF NOT EXISTS source_documents(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_chunks(
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  text_raw TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES source_documents(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_chunk_ordinal ON source_chunks(document_id,ordinal);
CREATE VIRTUAL TABLE IF NOT EXISTS source_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  text_normalized,
  tokenize='unicode61'
);
CREATE TABLE IF NOT EXISTS speech_segments(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  qpc_start_100ns INTEGER,
  qpc_end_100ns INTEGER,
  duration_ms REAL NOT NULL,
  audio_path TEXT NOT NULL,
  endpoint_reason TEXT NOT NULL,
  vad_engine TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_segments_session_seq ON speech_segments(session_id,channel_id,seq_start);
CREATE TABLE IF NOT EXISTS transcript_revisions(
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_normalized TEXT NOT NULL,
  language TEXT NOT NULL,
  is_final INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(segment_id,revision),
  FOREIGN KEY(segment_id) REFERENCES speech_segments(id)
);
CREATE TABLE IF NOT EXISTS asr_jobs(
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  provider_status INTEGER,
  error_code TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(segment_id) REFERENCES speech_segments(id)
);
CREATE TABLE IF NOT EXISTS turn_segments(
  turn_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(turn_id,segment_id),
  FOREIGN KEY(turn_id) REFERENCES turns(id),
  FOREIGN KEY(segment_id) REFERENCES speech_segments(id)
);
CREATE TABLE IF NOT EXISTS event_log(
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  session_id TEXT,
  correlation_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
`);
try { db.exec('ALTER TABLE gaps ADD COLUMN detail_json TEXT'); } catch {}
try { db.exec('ALTER TABLE gaps ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE gaps ADD COLUMN resolved_at TEXT'); } catch {}

db.query("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)").run(String(SCHEMA_VERSION));
db.query("INSERT OR REPLACE INTO meta(key,value) VALUES('app_version',?)").run(VERSION);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml'
};
const now = () => new Date().toISOString();
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});
const safeHost = req => {
  const h = req.headers.get('host') || '';
  return h === `${HOST}:${PORT}` || h === `localhost:${PORT}`;
};
const sameOrigin = req => {
  const o = req.headers.get('origin');
  return !o || o === ORIGIN || o === `http://localhost:${PORT}`;
};
const authed = req => req.headers.get('x-auralis-token') === TOKEN;
const requireState = req => safeHost(req) && sameOrigin(req) && authed(req);

function emit(eventType, payload = {}, sessionId = null) {
  const id = randomUUID();
  const correlationId = payload.correlation_id || randomUUID();
  const occurredAt = now();
  db.query('INSERT INTO event_log VALUES(?,?,?,?,?,?)')
    .run(id, eventType, sessionId, correlationId, JSON.stringify(payload), occurredAt);
  return { id, schema_version: 1, event_type: eventType, session_id: sessionId, correlation_id: correlationId, payload, occurred_at: occurredAt };
}

function chunkText(text, max = 1200) {
  const src = String(text || '');
  const out = [];
  let start = 0;
  let ordinal = 0;
  while (start < src.length) {
    let end = Math.min(src.length, start + max);
    if (end < src.length) {
      const cuts = [
        src.lastIndexOf('\n\n', end),
        src.lastIndexOf('\n', end),
        src.lastIndexOf('. ', end),
        src.lastIndexOf('؟', end)
      ];
      const cut = Math.max(...cuts);
      if (cut > start + Math.floor(max * 0.55)) end = cut + 1;
    }
    const raw = src.slice(start, end).trim();
    if (raw) out.push({ ordinal: ordinal++, raw, start, end });
    start = Math.max(end, start + 1);
  }
  return out;
}

function ftsQuery(q) {
  const tokens = normalizeFa(q)
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/u)
    .filter(x => x.length > 1)
    .slice(0, 14);
  return tokens.length ? tokens.map(x => `"${x.replaceAll('"', '')}"`).join(' OR ') : '';
}

function excerpt(text, query, max = 420) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= max) return raw;
  const tokens = normalizeFa(query).split(/\s+/u).filter(x => x.length > 2);
  const normRaw = normalizeFa(raw);
  let idx = -1;
  for (const token of tokens) {
    idx = normRaw.indexOf(token);
    if (idx >= 0) break;
  }
  if (idx < 0) return `${raw.slice(0, max)}…`;
  const start = Math.max(0, idx - Math.floor(max * 0.35));
  const end = Math.min(raw.length, start + max);
  return `${start > 0 ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}`;
}

function retrieve(q, limit = 8) {
  const match = ftsQuery(q);
  if (!match) return [];
  try {
    const rows = db.query(`
      SELECT c.id chunk_id,c.document_id,d.title,c.ordinal,c.text_raw,c.start_offset,c.end_offset,
             bm25(source_fts) score
      FROM source_fts
      JOIN source_chunks c ON c.id=source_fts.chunk_id
      JOIN source_documents d ON d.id=c.document_id
      WHERE source_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(match, limit);
    return rows.map(r => ({ ...r, excerpt: excerpt(r.text_raw, q) }));
  } catch (error) {
    emit('retrieval.failed', { message: String(error?.message || error).slice(0, 500) });
    return [];
  }
}


let nativeCapture = {
  proc: null,
  runId: null,
  sessionId: null,
  state: 'READY',
  startedAt: null,
  stoppedAt: null,
  lastHeartbeatAt: null,
  queueDepth: 0,
  queueCapacity: 0,
  stopFile: null,
  channels: {},
  lastError: null
};

let asrRuntime = {
  enabled: false,
  provider: 'gemini-audio-experimental',
  model: 'gemini-3.1-flash-lite',
  apiKey: '',
  accessToken: '',
  projectId: '',
  location: 'asia-southeast1',
  language: 'fa-IR',
  autoCommitTurns: true,
  lastState: 'DISABLED',
  lastError: null,
  lastSuccessAt: null
};

let brainRuntime = {
  enabled: false,
  autoAnswer: true,
  apiKey: '',
  model: 'gemini-3.1-flash-lite',
  strictSource: true,
  lastState: 'DISABLED',
  lastError: null,
  lastSuccessAt: null
};

const redactedAsrStatus = () => ({
  enabled: asrRuntime.enabled,
  provider: asrRuntime.provider,
  model: asrRuntime.model,
  projectId: asrRuntime.projectId,
  location: asrRuntime.location,
  language: asrRuntime.language,
  autoCommitTurns: asrRuntime.autoCommitTurns,
  hasCredential: Boolean(asrRuntime.provider === 'google-stt-v2' ? asrRuntime.accessToken : asrRuntime.apiKey),
  lastState: asrRuntime.lastState,
  lastError: asrRuntime.lastError,
  lastSuccessAt: asrRuntime.lastSuccessAt
});

const redactedBrainRuntime = () => ({
  enabled: brainRuntime.enabled,
  autoAnswer: brainRuntime.autoAnswer,
  model: brainRuntime.model,
  strictSource: brainRuntime.strictSource,
  hasCredential: Boolean(brainRuntime.apiKey),
  lastState: brainRuntime.lastState,
  lastError: brainRuntime.lastError,
  lastSuccessAt: brainRuntime.lastSuccessAt
});

function pendingSegments(sessionId, limit = 100) {
  if (!sessionId) return [];
  return db.query(`SELECT s.id FROM speech_segments s
    WHERE s.session_id=?
      AND s.state IN ('FROZEN','ASR_FAILED','TRANSCRIBED_EMPTY')
      AND NOT EXISTS (
        SELECT 1 FROM transcript_revisions tr WHERE tr.segment_id=s.id AND tr.is_final=1 AND length(trim(tr.text_raw))>0
      )
    ORDER BY s.created_at LIMIT ?`).all(sessionId, limit);
}

function queuePendingAsr(sessionId, limit = 100) {
  if (!asrRuntime.enabled || !sessionId) return 0;
  const rows = pendingSegments(sessionId, limit);
  for (const row of rows) queueMicrotask(() => processSegmentAsr(row.id).catch(error => {
    emit('asr.worker_error', { segment_id: row.id, message: String(error?.message || error).slice(0,500) }, sessionId);
  }));
  return rows.length;
}

function transcriptTimeline(sessionId, limit = 80) {
  if (!sessionId) return [];
  return db.query(`SELECT s.id segment_id,s.session_id,s.channel_id,s.seq_start,s.seq_end,
      s.duration_ms,s.endpoint_reason,s.vad_engine,s.state segment_state,s.created_at,
      tr.id transcript_revision_id,tr.revision,tr.provider,tr.provider_model,tr.text_raw,tr.text_normalized,tr.is_final,tr.created_at transcript_created_at,
      aj.status asr_status,aj.attempt asr_attempt,aj.error_code asr_error,aj.provider_status asr_provider_status
    FROM speech_segments s
    LEFT JOIN transcript_revisions tr ON tr.id=(SELECT id FROM transcript_revisions x WHERE x.segment_id=s.id ORDER BY revision DESC LIMIT 1)
    LEFT JOIN asr_jobs aj ON aj.id=(SELECT id FROM asr_jobs j WHERE j.segment_id=s.id ORDER BY updated_at DESC LIMIT 1)
    WHERE s.session_id=?
    ORDER BY s.created_at DESC LIMIT ?`).all(sessionId, limit);
}

const relPath = p => {
  try { return String(p || '').replaceAll('\\', '/').replace(ROOT.replaceAll('\\','/') + '/', ''); }
  catch { return String(p || ''); }
};

function ingestNativeEvent(ev, replay = false) {
  if (!ev || typeof ev !== 'object' || !ev.type) return;
  const sid = String(ev.session_id || nativeCapture.sessionId || '');
  const cid = String(ev.channel_id || '');
  const payload = ev.payload || {};
  const occurredAt = String(ev.occurred_at || now());
  if (ev.type !== 'probe.heartbeat') emit(`native.${ev.type}`, { replay, ...payload, channel_id: cid }, sid || null);

  if (ev.type === 'probe.heartbeat') {
    nativeCapture.lastHeartbeatAt = occurredAt;
    nativeCapture.queueDepth = Number(payload.queue_depth || 0);
    nativeCapture.queueCapacity = Number(payload.queue_capacity || 0);
    if (nativeCapture.runId) db.query('UPDATE native_capture_runs SET last_heartbeat_at=?,queue_depth=?,queue_capacity=? WHERE id=?')
      .run(occurredAt, nativeCapture.queueDepth, nativeCapture.queueCapacity, nativeCapture.runId);
    return;
  }
  if (ev.type === 'capture.channel_started' && sid && cid) {
    nativeCapture.channels[cid] = { state: 'CAPTURING', ...payload, lastSequence: 0 };
    db.query(`INSERT INTO audio_channels(id,session_id,source_kind,sample_rate,channels,block_align,format_tag,bits_per_sample,state,last_sequence,started_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET sample_rate=excluded.sample_rate,channels=excluded.channels,block_align=excluded.block_align,format_tag=excluded.format_tag,bits_per_sample=excluded.bits_per_sample,state='CAPTURING',started_at=excluded.started_at,last_error=NULL`)
      .run(`${sid}:${cid}`, sid, cid, Number(payload.sample_rate||0), Number(payload.channels||0), Number(payload.block_align||0), Number(payload.format_tag||0), Number(payload.bits_per_sample||0), 'CAPTURING', 0, occurredAt);
    return;
  }
  if (ev.type === 'capture.channel_stopped' && sid && cid) {
    const seq = Number(payload.sequence || 0);
    nativeCapture.channels[cid] = { ...(nativeCapture.channels[cid] || {}), state:'STOPPED', lastSequence:seq };
    db.query('UPDATE audio_channels SET state=?,last_sequence=?,stopped_at=? WHERE id=?').run('STOPPED', seq, occurredAt, `${sid}:${cid}`);
    return;
  }
  if (ev.type === 'capture.channel_failed' && sid && cid) {
    const message = String(payload.error || 'capture failed').slice(0, 1000);
    nativeCapture.channels[cid] = { ...(nativeCapture.channels[cid] || {}), state:'FAILED', error:message };
    nativeCapture.lastError = message;
    db.query(`INSERT INTO audio_channels(id,session_id,source_kind,state,last_error,started_at)
              VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state='FAILED',last_error=excluded.last_error`)
      .run(`${sid}:${cid}`, sid, cid, 'FAILED', message, occurredAt);
    return;
  }
  if (ev.type === 'audio.chunk_closed' && sid && cid) {
    const id = `${sid}:${cid}:${String(payload.chunk_id || `${payload.seq_start}-${payload.seq_end}`)}`;
    db.query(`INSERT OR IGNORE INTO audio_chunks(id,session_id,channel_id,seq_start,seq_end,qpc_start_100ns,qpc_end_100ns,sample_rate,channels,block_align,format_tag,bits_per_sample,path,byte_length,sha256,discontinuity,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, sid, cid, Number(payload.seq_start||0), Number(payload.seq_end||0), Number(payload.qpc_start_100ns||0), Number(payload.qpc_end_100ns||0), Number(payload.sample_rate||0), Number(payload.channels||0), Number(payload.block_align||0), Number(payload.format_tag||0), Number(payload.bits_per_sample||0), relPath(payload.path), Number(payload.byte_length||0), String(payload.sha256||''), payload.discontinuity ? 1 : 0, occurredAt);
    db.query('UPDATE audio_channels SET last_sequence=? WHERE id=?').run(Number(payload.seq_end||0), `${sid}:${cid}`);
    if (nativeCapture.channels[cid]) nativeCapture.channels[cid].lastSequence = Number(payload.seq_end||0);
    return;
  }
  if (ev.type === 'segment.frozen' && sid && cid) {
    const segmentId = String(payload.segment_id || randomUUID());
    db.query(`INSERT OR IGNORE INTO speech_segments(id,session_id,channel_id,seq_start,seq_end,qpc_start_100ns,qpc_end_100ns,duration_ms,audio_path,endpoint_reason,vad_engine,state,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(segmentId, sid, cid, Number(payload.seq_start||0), Number(payload.seq_end||0), Number(payload.qpc_start_100ns||0), Number(payload.qpc_end_100ns||0), Number(payload.duration_ms||0), relPath(payload.path), String(payload.endpoint_reason||'unknown'), String(payload.vad_engine||'unknown'), 'FROZEN', occurredAt);
    emit('segment.frozen.persisted', { segment_id: segmentId, channel_id: cid, duration_ms: Number(payload.duration_ms||0), endpoint_reason: String(payload.endpoint_reason||'unknown') }, sid);
    if (asrRuntime.enabled) queueMicrotask(() => processSegmentAsr(segmentId).catch(error => {
      emit('asr.worker_error', { segment_id: segmentId, message: String(error?.message || error).slice(0,500) }, sid);
    }));
    return;
  }
  if (ev.type === 'audio.gap_detected' && sid && cid) {
    const seqStart = Number(payload.seq_start || 0), seqEnd = Number(payload.seq_end || seqStart);
    const reason = String(payload.reason || 'unknown');
    const gapId = createHash('sha256').update(`${sid}|${cid}|${seqStart}|${seqEnd}|${reason}|${occurredAt}`).digest('hex').slice(0, 32);
    db.query('INSERT OR IGNORE INTO gaps(id,session_id,channel_id,seq_start,seq_end,reason,status,created_at,detail_json) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(gapId, sid, cid, seqStart, seqEnd, reason, 'OPEN', occurredAt, JSON.stringify(payload));
  }
}

async function recoverNativeLedgers() {
  let dirs = [];
  try { dirs = await readdir(AUDIO_ROOT, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const sid = d.name;
    const sessionDir = join(AUDIO_ROOT, sid);
    if (!db.query('SELECT id FROM sessions WHERE id=?').get(sid)) {
      db.query('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sid, now(), null, 'recovered', 'RECOVERABLE');
    }
    const ledger = join(sessionDir, 'native-ledger.jsonl');
    try {
      const text = await readFile(ledger, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { ingestNativeEvent(JSON.parse(line), true); } catch {}
      }
    } catch {}

    // Recover a raw file that was fs-written but never emitted as chunk_closed because of a crash.
    let channelDirs = [];
    try { channelDirs = await readdir(sessionDir, { withFileTypes:true }); } catch { channelDirs = []; }
    for (const cd of channelDirs) {
      if (!cd.isDirectory()) continue;
      const cid = cd.name;
      const ch = db.query('SELECT * FROM audio_channels WHERE id=?').get(`${sid}:${cid}`);
      if (!ch || !Number(ch.block_align)) continue;
      let files = [];
      try { files = await readdir(join(sessionDir,cid), { withFileTypes:true }); } catch { continue; }
      for (const f of files) {
        if (!f.isFile() || !/^chunk-\d+\.raw$/i.test(f.name)) continue;
        const abs = join(sessionDir,cid,f.name), rel = relPath(abs);
        if (db.query('SELECT id FROM audio_chunks WHERE path=?').get(rel)) continue;
        try {
          const st = await stat(abs);
          const usableBytes = st.size - (st.size % Number(ch.block_align));
          if (usableBytes <= 0) continue;
          const frames = Math.floor(usableBytes / Number(ch.block_align));
          const prev = db.query('SELECT COALESCE(MAX(seq_end),0) seq FROM audio_chunks WHERE session_id=? AND channel_id=?').get(sid,cid);
          const seqStart = Number(prev?.seq || 0), seqEnd = seqStart + frames;
          const bytes = await readFile(abs);
          const sha = createHash('sha256').update(bytes.subarray(0,usableBytes)).digest('hex');
          const id = `${sid}:${cid}:recovered:${f.name}`;
          db.query(`INSERT OR IGNORE INTO audio_chunks(id,session_id,channel_id,seq_start,seq_end,qpc_start_100ns,qpc_end_100ns,sample_rate,channels,block_align,format_tag,bits_per_sample,path,byte_length,sha256,discontinuity,created_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(id,sid,cid,seqStart,seqEnd,0,0,Number(ch.sample_rate||0),Number(ch.channels||0),Number(ch.block_align),Number(ch.format_tag||0),Number(ch.bits_per_sample||0),rel,usableBytes,sha,1,now());
          emit('native.audio.chunk_recovered', { channel_id:cid, path:rel, seq_start:seqStart, seq_end:seqEnd, byte_length:usableBytes, trailing_bytes:st.size-usableBytes }, sid);
        } catch {}
      }
    }
  }
}
await recoverNativeLedgers();

async function nativeProbeAvailable() {
  try { const st = await stat(NATIVE_PROBE); return st.isFile(); } catch { return false; }
}

async function startNativeCapture(sessionId, opts = {}) {
  if (nativeCapture.proc) return { error:'CAPTURE_ALREADY_RUNNING', status:nativeStatus() };
  const session = db.query('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!session) return { error:'SESSION_NOT_FOUND' };
  if (!(await nativeProbeAvailable())) return { error:'NATIVE_PROBE_NOT_FOUND' };
  const runId = randomUUID();
  const outDir = join(AUDIO_ROOT, sessionId);
  await mkdir(outDir, { recursive:true });
  const stopFile = join(outDir, `.stop-${runId}`);
  try { await unlink(stopFile); } catch {}
  const args = ['--session', sessionId, '--output', outDir, '--chunk-seconds', String(Math.max(2,Math.min(10,Number(opts.chunkSeconds)||5))), '--mic', String(opts.mic !== false), '--loopback', String(opts.loopback !== false), '--stop-file', stopFile];
  const proc = spawn(NATIVE_PROBE, args, { cwd: ROOT, windowsHide:true, stdio:['ignore','pipe','pipe'] });
  nativeCapture = { proc, runId, sessionId, state:'STARTING', startedAt:now(), stoppedAt:null, lastHeartbeatAt:null, queueDepth:0, queueCapacity:0, stopFile, channels:{}, lastError:null };
  db.query('INSERT INTO native_capture_runs(id,session_id,pid,state,started_at,probe_engine) VALUES(?,?,?,?,?,?)')
    .run(runId, sessionId, proc.pid || 0, 'STARTING', nativeCapture.startedAt, 'WASAPI validation probe');
  db.query('UPDATE sessions SET state=? WHERE id=?').run('CAPTURING_NATIVE_VALIDATION', sessionId);

  let pending = '';
  proc.stdout.on('data', chunk => {
    pending += chunk.toString('utf8');
    const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        ingestNativeEvent(ev, false);
        if (ev.type === 'capture.channel_started') {
          nativeCapture.state = 'CAPTURING';
          db.query('UPDATE native_capture_runs SET state=? WHERE id=?').run('CAPTURING', runId);
        }
      } catch (error) { emit('native.probe_parse_error', { message:String(error.message||error), line:line.slice(0,500) }, sessionId); }
    }
  });
  proc.stderr.on('data', chunk => {
    const message = chunk.toString('utf8').slice(0,1500);
    nativeCapture.lastError = message;
    emit('native.probe_stderr', { message }, sessionId);
  });
  proc.on('error', error => {
    nativeCapture.lastError = String(error.message||error);
    nativeCapture.state = 'FAILED';
    db.query('UPDATE native_capture_runs SET state=?,error=? WHERE id=?').run('FAILED', nativeCapture.lastError, runId);
  });
  proc.on('exit', (code, signal) => {
    const ended = now();
    const state = code === 0 || nativeCapture.state === 'STOPPING' ? 'STOPPED' : 'FAILED';
    db.query('UPDATE native_capture_runs SET state=?,stopped_at=?,error=COALESCE(error,?) WHERE id=?')
      .run(state, ended, code === 0 ? null : `exit=${code} signal=${signal}`, runId);
    nativeCapture.state = state;
    nativeCapture.stoppedAt = ended;
    for (const [cid,ch] of Object.entries(nativeCapture.channels || {})) {
      if (ch?.state === 'CAPTURING' || ch?.state === 'STARTING') nativeCapture.channels[cid] = { ...ch, state };
    }
    nativeCapture.proc = null;
  });
  return { runId, sessionId, pid:proc.pid, state:'STARTING', outputDir:relPath(outDir) };
}

async function stopNativeCapture() {
  if (!nativeCapture.proc) return nativeStatus();
  nativeCapture.state = 'STOPPING';
  db.query('UPDATE native_capture_runs SET state=? WHERE id=?').run('STOPPING', nativeCapture.runId);
  try { await writeFile(nativeCapture.stopFile, 'stop\n', 'utf8'); } catch {}
  const proc = nativeCapture.proc;
  setTimeout(() => { try { if (nativeCapture.proc === proc) proc.kill(); } catch {} }, 3500);
  return nativeStatus();
}

function nativeStatus() {
  const sid = nativeCapture.sessionId;
  const chunks = sid ? db.query('SELECT COUNT(*) n,COALESCE(SUM(byte_length),0) bytes FROM audio_chunks WHERE session_id=?').get(sid) : {n:0,bytes:0};
  const gaps = sid ? db.query('SELECT COUNT(*) n FROM gaps WHERE session_id=?').get(sid).n : 0;
  return {
    runId:nativeCapture.runId, sessionId:sid, state:nativeCapture.state,
    startedAt:nativeCapture.startedAt, stoppedAt:nativeCapture.stoppedAt, lastHeartbeatAt:nativeCapture.lastHeartbeatAt,
    queueDepth:nativeCapture.queueDepth, queueCapacity:nativeCapture.queueCapacity,
    channels:nativeCapture.channels, lastError:nativeCapture.lastError,
    chunks:Number(chunks?.n||0), bytes:Number(chunks?.bytes||0), gaps:Number(gaps||0),
    implementation:'WASAPI validation probe', targetArchitecture:'Rust auralis-core.exe (not yet compiled in this environment)'
  };
}

function health() {
  const probeReady = nativeCapture.state !== 'UNAVAILABLE';
  const mic = nativeCapture.channels['user-mic'];
  const sys = nativeCapture.channels['system-loopback'];
  const captureState = ch => ch?.state || (nativeCapture.proc ? 'STARTING' : 'READY');
  return {
    product: 'Auralis',
    version: VERSION,
    releaseClass: 'LIVE_TRANSCRIPT_VALIDATION',
    status: nativeCapture.state === 'FAILED' || asrRuntime.lastState === 'ASR_PROVIDER_ERROR' ? 'degraded' : 'degraded',
    reason: 'segment-final-transcript-is-testable; production-rust-core-neural-vad-and-grpc-streaming-partials-still-pending',
    schemaVersion: SCHEMA_VERSION,
    components: {
      captureMic: { state: captureState(mic), critical: true, engine: 'WASAPI event-driven validation probe' },
      captureSystem: { state: captureState(sys), critical: true, engine: 'WASAPI loopback validation probe' },
      spoolWriter: { state: nativeCapture.proc ? 'CAPTURING' : 'READY', critical: true, engine: 'append-only raw chunks' },
      audioLedger: { state: 'HEALTHY', critical: true, engine: 'SQLite WAL + probe JSONL recovery journal' },
      vad: { state: nativeCapture.proc ? 'VALIDATION_ACTIVE' : 'VALIDATION_READY', critical: false, engine: 'adaptive RMS validation; neural VAD pending' },
      asrPrimary: { state: asrRuntime.enabled ? (asrRuntime.lastState || 'READY') : 'NOT_CONFIGURED', critical: true, engine: asrRuntime.provider },
      asrLocal: { state: 'NOT_CONFIGURED', critical: false },
      router: { state: 'HEALTHY', critical: true, engine: 'server-side Unicode-safe' },
      brain: { state: brainRuntime.enabled ? (brainRuntime.lastState || 'READY') : 'READY_FOR_CONFIG', critical: false, schema: 'strict-v1' },
      storage: { state: 'HEALTHY', engine: 'SQLite WAL' },
      retrieval: { state: 'HEALTHY', engine: 'SQLite FTS5' }
    },
    capabilities: [
      'native-wasapi-mic-validation', 'native-wasapi-loopback-validation', 'simultaneous-mic-loopback',
      'sequence-and-qpc-metadata', 'append-only-raw-audio-spool', 'explicit-gap-recording', 'crash-ledger-replay',
      'derived-speech-segments','immutable-segment-ids','live-transcript-panel','final-segment-transcription','pending-segment-replay','google-stt-v2-recognize-adapter','gemini-audio-experimental-adapter',
      'server-side-auto-router','strict-answer-schema','answer-turn-binding','answer-idempotency','selectable-turn-cards','turn-question-answer-view','turn-detail-api',
      'retrieval-evidence-excerpts','sqlite-wal-ledger','fts5-single-source-index','turn-isolation','citation-allowlist-validation','component-health-ui','diagnostics-export'
    ],
    nonCapabilities: ['rust-auralis-core-production-binary','neural-vad','grpc-streaming-partials','whisper-worker','120m-release-gate']
  };
}

function serializeRetrieved(rows) {
  return rows.map(x => ({
    chunkId: x.chunk_id,
    documentId: x.document_id,
    title: x.title,
    ordinal: x.ordinal,
    score: x.score,
    startOffset: x.start_offset,
    endOffset: x.end_offset,
    excerpt: x.excerpt
  }));
}

async function callBrain({ question, apiKey, model, strictSource = true, correlationId = randomUUID() }) {
  if (!apiKey) return { error: 'AUTH_REQUIRED', message: 'Gemini API key is required for this request.' };
  if (!/^gemini-[a-z0-9.\-]+$/i.test(model)) return { error: 'MODEL_NOT_ALLOWED' };

  const chunks = retrieve(question, 8);
  const retrieved = serializeRetrieved(chunks);
  const evidence = chunks.map((x, i) =>
    `[${i + 1}] chunk_id=${x.chunk_id}\ndocument=${x.title}\n${x.text_raw}`
  ).join('\n\n');

  const sourcePolicy = strictSource
    ? 'This is STRICT SOURCE MODE. Use only the retrieved evidence for factual claims. If the evidence does not support the requested fact, explicitly say the source does not contain enough information and set grounding to insufficient.'
    : 'Use retrieved evidence when relevant; general knowledge is allowed when evidence is insufficient.';

  const system = `You are Auralis v0.10.4 Text-only Brain. Answer ONLY the current question. ${sourcePolicy}\nNever answer previous questions again. Never invent source IDs. Return exactly one JSON object with this schema: {"answer":"string","sourceChunkIds":["chunk-id"],"grounding":"source|mixed|general|insufficient"}. No Markdown fence and no extra text.`;
  const user = `CURRENT QUESTION:\n${normalizeFa(question)}\n\nRETRIEVED EVIDENCE:\n${evidence || 'NONE'}`;

  let upstream;
  try {
    upstream = await fetch(PROVIDER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: 900,
        stream: false
      })
    });
  } catch (error) {
    emit('provider.network_error', { correlation_id: correlationId, message: String(error?.message || error).slice(0, 500) });
    return { error: 'PROVIDER_NETWORK_ERROR', diagnosticsId: correlationId, message: 'ارتباط با Brain برقرار نشد.' };
  }

  if (!upstream.ok) {
    const providerBody = (await upstream.text()).slice(0, 1200);
    const retryAfter = upstream.headers.get('retry-after');
    emit('provider.http_error', {
      correlation_id: correlationId,
      providerStatus: upstream.status,
      retryAfter,
      providerBody
    });
    return {
      error: upstream.status === 429 ? 'RATE_LIMITED' : upstream.status === 401 || upstream.status === 403 ? 'AUTH_REQUIRED' : 'PROVIDER_ERROR',
      providerStatus: upstream.status,
      retryAfter,
      diagnosticsId: correlationId,
      message: upstream.status === 429 ? 'سهمیه یا نرخ درخواست Brain محدود شده است.' : 'Brain پاسخ معتبر HTTP نداد.'
    };
  }

  const data = await upstream.json();
  const raw = String(data?.choices?.[0]?.message?.content || '');
  try {
    const parsed = parseAnswerEnvelope(raw, new Set(chunks.map(x => x.chunk_id)));
    return { result: { ...parsed, retrieved }, model: data.model || model, correlationId };
  } catch (error) {
    if (error instanceof AnswerSchemaError) {
      emit('provider.schema_error', {
        correlation_id: correlationId,
        code: error.code,
        message: error.message,
        rawPreview: raw.slice(0, 700)
      });
      return {
        error: 'PROVIDER_SCHEMA_ERROR',
        diagnosticsId: correlationId,
        message: 'ساختار پاسخ مدل معتبر نبود؛ JSON خام برای جلوگیری از نشت به UI نمایش داده نشد.'
      };
    }
    throw error;
  }
}


function absDataPath(rel) {
  const p = resolve(ROOT, String(rel || ''));
  if (p !== ROOT && !p.startsWith(`${ROOT}${sep}`)) throw new Error('PATH_OUTSIDE_ROOT');
  return p;
}

async function callGeminiAudioAsr(segment, cfg, correlationId) {
  if (!cfg.apiKey) return { error:'AUTH_REQUIRED', message:'Gemini API key برای ASR آزمایشی لازم است.' };
  const wav = await readFile(absDataPath(segment.audio_path));
  const content = wav.toString('base64');
  let upstream;
  try {
    upstream = await fetch(PROVIDER_URL, {
      method:'POST',
      headers:{ 'content-type':'application/json', authorization:`Bearer ${cfg.apiKey}` },
      body:JSON.stringify({
        model: cfg.model || 'gemini-3.1-flash-lite',
        messages:[{ role:'user', content:[
          { type:'text', text:'Transcribe only the spoken words in this WAV. Language is Persian (fa-IR) unless the speaker uses another language. Return transcript text only, with no explanation, no JSON, and no quotation marks. If there is no intelligible speech, return exactly NO_SPEECH.' },
          { type:'input_audio', input_audio:{ data:content, format:'wav' } }
        ]}],
        max_tokens:500,
        stream:false
      })
    });
  } catch (error) {
    return { error:'ASR_NETWORK_ERROR', diagnosticsId:correlationId, message:String(error?.message||error) };
  }
  if (!upstream.ok) {
    const body=(await upstream.text()).slice(0,800), retryAfter=upstream.headers.get('retry-after');
    return { error:upstream.status===429?'RATE_LIMITED':upstream.status===401||upstream.status===403?'AUTH_REQUIRED':'ASR_PROVIDER_ERROR', providerStatus:upstream.status, retryAfter, diagnosticsId:correlationId, message:body };
  }
  const data=await upstream.json();
  const text=String(data?.choices?.[0]?.message?.content||'').trim().replace(/^['"“”]+|['"“”]+$/g,'').trim();
  return { text: /^NO_SPEECH[.!]?$/i.test(text)?'':text, provider:'gemini-audio-experimental', model:data?.model||cfg.model||'gemini-3.1-flash-lite', providerStatus:upstream.status };
}

async function callGoogleSttAsr(segment, cfg, correlationId) {
  if (!cfg.accessToken || !cfg.projectId) return { error:'AUTH_REQUIRED', message:'Google Cloud OAuth access token و Project ID لازم است.' };
  const wav=await readFile(absDataPath(segment.audio_path));
  const location=String(cfg.location||'asia-southeast1').replace(/[^a-z0-9-]/gi,'');
  const project=String(cfg.projectId||'').replace(/[^a-z0-9-:._]/gi,'');
  if (!project || !location) return { error:'ASR_CONFIG_INVALID' };
  const url=`https://speech.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/recognizers/_:recognize`;
  let upstream;
  try {
    upstream=await fetch(url,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${cfg.accessToken}`},
      body:JSON.stringify({
        config:{ autoDecodingConfig:{}, languageCodes:[cfg.language||'fa-IR'], model:cfg.model||'chirp_3', features:{ enableAutomaticPunctuation:true } },
        content:wav.toString('base64')
      })
    });
  } catch(error){ return { error:'ASR_NETWORK_ERROR', diagnosticsId:correlationId, message:String(error?.message||error) }; }
  if(!upstream.ok){
    const body=(await upstream.text()).slice(0,1000), retryAfter=upstream.headers.get('retry-after');
    return { error:upstream.status===429?'RATE_LIMITED':upstream.status===401||upstream.status===403?'AUTH_REQUIRED':'ASR_PROVIDER_ERROR',providerStatus:upstream.status,retryAfter,diagnosticsId:correlationId,message:body };
  }
  const data=await upstream.json();
  const parts=[];
  for(const r of data?.results||[]){ const t=String(r?.alternatives?.[0]?.transcript||'').trim(); if(t) parts.push(t); }
  return { text:parts.join(' ').replace(/\s+/g,' ').trim(), provider:'google-stt-v2', model:cfg.model||'chirp_3', providerStatus:upstream.status, metadata:data?.metadata||null };
}

async function persistAutoAnswer(turn, cfg=brainRuntime) {
  if (!cfg.enabled || !cfg.apiKey || !cfg.autoAnswer || !['question','request'].includes(turn.kind)) return null;
  const lane='fast', model=cfg.model||'gemini-3.1-flash-lite';
  const idempotencyKey=`auto:${turn.id}:${lane}:${model}:${cfg.strictSource?'strict':'open'}`;
  const existing=db.query('SELECT * FROM answer_results WHERE idempotency_key=?').get(idempotencyKey);
  if(existing) return answerFromRow(existing);
  const correlationId=randomUUID();
  emit('answer.queued',{correlation_id:correlationId,turn_id:turn.id,lane,model,source:'auto-asr'},turn.session_id);
  const out=await callBrain({question:turn.text_normalized,apiKey:cfg.apiKey,model,strictSource:cfg.strictSource,correlationId});
  if(out.error){ brainRuntime.lastState=out.error; brainRuntime.lastError=out.message||out.error; emit('answer.failed',{correlation_id:correlationId,turn_id:turn.id,error:out.error},turn.session_id); return null; }
  const answerId=randomUUID();
  db.query('INSERT INTO answer_results VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(answerId,turn.id,idempotencyKey,lane,out.model||model,out.result.answer,out.result.grounding,JSON.stringify(out.result.sourceChunkIds||[]),JSON.stringify(out.result.retrieved||[]),Number(out.result.invalidCitationCount||0),now());
  brainRuntime.lastState='HEALTHY'; brainRuntime.lastError=null; brainRuntime.lastSuccessAt=now();
  emit('answer.completed',{correlation_id:correlationId,answer_id:answerId,turn_id:turn.id,grounding:out.result.grounding,source:'auto-asr'},turn.session_id);
  return answerFromRow(db.query('SELECT * FROM answer_results WHERE id=?').get(answerId));
}

async function processSegmentAsr(segmentId) {
  const segment=db.query('SELECT * FROM speech_segments WHERE id=?').get(segmentId);
  if(!segment || !asrRuntime.enabled) return null;
  const cfg={...asrRuntime};
  const provider=cfg.provider, model=cfg.model|| (provider==='google-stt-v2'?'chirp_3':'gemini-3.1-flash-lite');
  const idempotencyKey=`${segment.id}:${provider}:${model}`;
  const existing=db.query('SELECT * FROM asr_jobs WHERE idempotency_key=?').get(idempotencyKey);
  if(existing && ['COMPLETED','EMPTY'].includes(existing.status)) return existing;
  const jobId=existing?.id||randomUUID(), correlationId=randomUUID(), started=now();
  if(existing) db.query('UPDATE asr_jobs SET status=?,attempt=attempt+1,started_at=?,updated_at=?,error_code=NULL WHERE id=?').run('RUNNING',started,started,jobId);
  else db.query('INSERT INTO asr_jobs(id,segment_id,idempotency_key,provider,model,status,attempt,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(jobId,segment.id,idempotencyKey,provider,model,'RUNNING',1,started,started,started);
  db.query('UPDATE speech_segments SET state=? WHERE id=?').run('TRANSCRIBING',segment.id);
  asrRuntime.lastState='TRANSCRIBING'; asrRuntime.lastError=null;
  emit('asr.started',{correlation_id:correlationId,segment_id:segment.id,provider,model},segment.session_id);
  let out;
  try { out=provider==='google-stt-v2'?await callGoogleSttAsr(segment,cfg,correlationId):await callGeminiAudioAsr(segment,cfg,correlationId); }
  catch(error){ out={error:'ASR_INTERNAL_ERROR',message:String(error?.message||error)}; }
  if(out.error){
    asrRuntime.lastState=out.error; asrRuntime.lastError=out.message||out.error;
    db.query('UPDATE asr_jobs SET status=?,provider_status=?,error_code=?,completed_at=?,updated_at=? WHERE id=?').run('FAILED',Number(out.providerStatus||0)||null,out.error,now(),now(),jobId);
    db.query('UPDATE speech_segments SET state=? WHERE id=?').run('ASR_FAILED',segment.id);
    emit('asr.failed',{correlation_id:correlationId,segment_id:segment.id,error:out.error,provider_status:out.providerStatus||null},segment.session_id);
    return null;
  }
  const text=String(out.text||'').trim();
  if(!text){
    db.query('UPDATE asr_jobs SET status=?,provider_status=?,completed_at=?,updated_at=? WHERE id=?').run('EMPTY',Number(out.providerStatus||0)||null,now(),now(),jobId);
    db.query('UPDATE speech_segments SET state=? WHERE id=?').run('TRANSCRIBED_EMPTY',segment.id);
    asrRuntime.lastState='HEALTHY';asrRuntime.lastError=null;asrRuntime.lastSuccessAt=now();
    emit('transcript.empty',{correlation_id:correlationId,segment_id:segment.id},segment.session_id);
    return null;
  }
  const revision=(db.query('SELECT COALESCE(MAX(revision),0)+1 n FROM transcript_revisions WHERE segment_id=?').get(segment.id)?.n)||1;
  const revId=randomUUID();
  db.query('INSERT INTO transcript_revisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(revId,segment.id,revision,out.provider||provider,out.model||model,text,normalizeFa(text),cfg.language||'fa-IR',1,now());
  db.query('UPDATE speech_segments SET state=? WHERE id=?').run('TRANSCRIBED',segment.id);
  db.query('UPDATE asr_jobs SET status=?,provider_status=?,completed_at=?,updated_at=? WHERE id=?').run('COMPLETED',Number(out.providerStatus||0)||null,now(),now(),jobId);
  asrRuntime.lastState='HEALTHY';asrRuntime.lastError=null;asrRuntime.lastSuccessAt=now();
  emit('transcript.final',{correlation_id:correlationId,segment_id:segment.id,revision,text,provider:out.provider||provider,model:out.model||model},segment.session_id);
  if(!cfg.autoCommitTurns) return {segment,text};
  const session=db.query('SELECT * FROM sessions WHERE id=?').get(segment.session_id);
  if(!session) return {segment,text};
  const route=routePersian(text,session.mode);
  const ordinal=(db.query('SELECT COALESCE(MAX(ordinal),0)+1 n FROM turns WHERE session_id=?').get(segment.session_id)?.n)||1;
  const turnId=randomUUID();
  const sourceRole=segment.channel_id==='system-loopback'?'system':'user';
  db.query('INSERT INTO turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(turnId,segment.session_id,ordinal,sourceRole,route.kind,text,route.normalized,route.reason,route.score,null,'COMMITTED',now());
  db.query('INSERT OR IGNORE INTO turn_segments(turn_id,segment_id,ordinal) VALUES(?,?,1)').run(turnId,segment.id);
  emit('turn.committed',{turn_id:turnId,ordinal,kind:route.kind,route_reason:route.reason,should_answer:route.shouldAnswer,source:'asr',segment_id:segment.id},segment.session_id);
  const turn=db.query('SELECT * FROM turns WHERE id=?').get(turnId);
  if(route.shouldAnswer && brainRuntime.enabled && brainRuntime.autoAnswer) queueMicrotask(()=>persistAutoAnswer(turn).catch(error=>emit('answer.auto_error',{turn_id:turn.id,message:String(error?.message||error).slice(0,500)},turn.session_id)));
  return {segment,text,turn};
}

function turnWithLatestAnswerRows(sessionId) {
  return db.query(`SELECT t.*,
      (SELECT ar.id FROM answer_results ar WHERE ar.turn_id=t.id ORDER BY ar.created_at DESC LIMIT 1) answer_id,
      (SELECT ar.answer_text FROM answer_results ar WHERE ar.turn_id=t.id ORDER BY ar.created_at DESC LIMIT 1) answer_text,
      (SELECT ar.grounding FROM answer_results ar WHERE ar.turn_id=t.id ORDER BY ar.created_at DESC LIMIT 1) answer_grounding,
      (SELECT ar.created_at FROM answer_results ar WHERE ar.turn_id=t.id ORDER BY ar.created_at DESC LIMIT 1) answer_created_at
    FROM turns t WHERE t.session_id=? ORDER BY t.ordinal`).all(sessionId);
}

async function staticFile(pathname) {
  const req = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const p = resolve(APP, req);
  if (p !== APP && !p.startsWith(`${APP}${sep}`)) return null;
  try { return { body: await readFile(p), ext: extname(p) }; } catch { return null; }
}

function openBrowser() {
  if (process.platform !== 'win32' || process.env.AURALIS_NO_OPEN === '1') return;
  try {
    const child = spawn('cmd', ['/d', '/s', '/c', 'start', '', ORIGIN], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {}
}

function answerFromRow(row) {
  if (!row) return null;
  return {
    answerId: row.id,
    turnId: row.turn_id,
    lane: row.lane,
    model: row.model,
    answer: row.answer_text,
    grounding: row.grounding,
    sourceChunkIds: JSON.parse(row.source_chunk_ids_json),
    retrieved: JSON.parse(row.retrieved_json),
    invalidCitationCount: row.invalid_citation_count,
    createdAt: row.created_at
  };
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    const u = new URL(req.url);
    if (!safeHost(req)) return json({ error: 'HOST_REJECTED' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 405 });

    if (u.pathname === '/v1/bootstrap' && req.method === 'GET') {
      if (!sameOrigin(req)) return json({ error: 'ORIGIN_REJECTED' }, 403);
      return json({ token: TOKEN, version: VERSION, schemaVersion: SCHEMA_VERSION, releaseClass: 'LIVE_TRANSCRIPT_VALIDATION' });
    }
    if (u.pathname === '/v1/health' && req.method === 'GET') return json(health());
    if (u.pathname === '/v1/metrics/summary' && req.method === 'GET') {
      const counts = {
        sessions: db.query('SELECT COUNT(*) n FROM sessions').get().n,
        turns: db.query('SELECT COUNT(*) n FROM turns').get().n,
        answers: db.query('SELECT COUNT(*) n FROM answer_results').get().n,
        gaps: db.query('SELECT COUNT(*) n FROM gaps').get().n,
        sources: db.query('SELECT COUNT(*) n FROM source_documents').get().n,
        chunks: db.query('SELECT COUNT(*) n FROM source_chunks').get().n,
        schemaErrors: db.query("SELECT COUNT(*) n FROM event_log WHERE event_type='provider.schema_error'").get().n,
        audioChunks: db.query('SELECT COUNT(*) n FROM audio_chunks').get().n,
        audioBytes: db.query('SELECT COALESCE(SUM(byte_length),0) n FROM audio_chunks').get().n,
        nativeRuns: db.query('SELECT COUNT(*) n FROM native_capture_runs').get().n,
        segments: db.query('SELECT COUNT(*) n FROM speech_segments').get().n,
        transcripts: db.query('SELECT COUNT(*) n FROM transcript_revisions').get().n,
        asrJobs: db.query('SELECT COUNT(*) n FROM asr_jobs').get().n
      };
      return json({ version: VERSION, ...counts, dbPath: 'data/auralis-v0104-ledger.sqlite', native: nativeStatus(), asr: redactedAsrStatus(), brainRuntime: redactedBrainRuntime(), warning: 'WASAPI + live final transcript validation are active. Production target remains Rust + neural VAD + gRPC streaming partial/final ASR.' });
    }

    if (u.pathname === '/v1/native-capture/status' && req.method === 'GET') return json(nativeStatus());
    if (u.pathname === '/v1/native-capture/start' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      const b = await req.json().catch(() => ({}));
      const out = await startNativeCapture(String(b.sessionId||''), { mic:b.mic !== false, loopback:b.loopback !== false, chunkSeconds:b.chunkSeconds });
      if (out.error) return json(out, out.error === 'SESSION_NOT_FOUND' ? 404 : 409);
      return json(out, 201);
    }
    if (u.pathname === '/v1/native-capture/stop' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      return json(await stopNativeCapture());
    }
    if (u.pathname === '/v1/audio/chunks' && req.method === 'GET') {
      const sid = String(u.searchParams.get('sessionId') || '');
      if (!sid) return json({ error:'SESSION_REQUIRED' },400);
      const chunks = db.query('SELECT * FROM audio_chunks WHERE session_id=? ORDER BY channel_id,seq_start DESC LIMIT 200').all(sid);
      return json({ chunks });
    }

    if (u.pathname === '/v1/asr/status' && req.method === 'GET') return json(redactedAsrStatus());
    if (u.pathname === '/v1/asr/config' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      const b=await req.json().catch(()=>({}));
      const provider=['google-stt-v2','gemini-audio-experimental'].includes(String(b.provider))?String(b.provider):'gemini-audio-experimental';
      asrRuntime={...asrRuntime,enabled:b.enabled===true,provider,model:String(b.model|| (provider==='google-stt-v2'?'chirp_3':'gemini-3.1-flash-lite')).trim(),apiKey:String(b.apiKey||'').trim(),accessToken:String(b.accessToken||'').trim(),projectId:String(b.projectId||'').trim(),location:String(b.location||'asia-southeast1').trim(),language:String(b.language||'fa-IR').trim(),autoCommitTurns:b.autoCommitTurns!==false,lastState:b.enabled===true?'READY':'DISABLED',lastError:null};
      const queued = asrRuntime.enabled ? queuePendingAsr(nativeCapture.sessionId, 100) : 0;
      emit('asr.config_changed',{provider:asrRuntime.provider,enabled:asrRuntime.enabled,model:asrRuntime.model,location:asrRuntime.location,language:asrRuntime.language,auto_commit_turns:asrRuntime.autoCommitTurns,has_credential:Boolean(asrRuntime.provider==='google-stt-v2'?asrRuntime.accessToken:asrRuntime.apiKey),queued_pending:queued},nativeCapture.sessionId||null);
      return json({...redactedAsrStatus(), queuedPending: queued});
    }
    if (u.pathname === '/v1/runtime/quick-setup' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      const b=await req.json().catch(()=>({}));
      const apiKey=String(b.apiKey||'').trim();
      const model=String(b.model||'gemini-3.1-flash-lite').trim();
      if (!apiKey) return json({error:'API_KEY_REQUIRED',message:'برای تست صوت→متن آزمایشی، Gemini API key لازم است.'},400);
      if (!/^gemini-[a-z0-9.\-]+$/i.test(model)) return json({error:'MODEL_NOT_ALLOWED'},400);
      asrRuntime={...asrRuntime,enabled:true,provider:'gemini-audio-experimental',model,apiKey,accessToken:'',projectId:'',language:'fa-IR',autoCommitTurns:true,lastState:'READY',lastError:null};
      brainRuntime={...brainRuntime,enabled:true,autoAnswer:b.autoAnswer!==false,apiKey,model,strictSource:b.strictSource!==false,lastState:'READY',lastError:null};
      const queued=queuePendingAsr(String(b.sessionId||nativeCapture.sessionId||''),100);
      emit('runtime.quick_setup',{asr_provider:asrRuntime.provider,model,brain_auto_answer:brainRuntime.autoAnswer,strict_source:brainRuntime.strictSource,queued_pending:queued},nativeCapture.sessionId||null);
      return json({asr:redactedAsrStatus(),brain:redactedBrainRuntime(),queuedPending:queued});
    }

    if (u.pathname === '/v1/brain/runtime-config' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      const b=await req.json().catch(()=>({}));
      brainRuntime={...brainRuntime,enabled:b.enabled===true,autoAnswer:b.autoAnswer!==false,apiKey:String(b.apiKey||'').trim(),model:String(b.model||'gemini-3.1-flash-lite').trim(),strictSource:b.strictSource!==false,lastState:b.enabled===true?'READY':'DISABLED',lastError:null};
      emit('brain.runtime_config_changed',{enabled:brainRuntime.enabled,auto_answer:brainRuntime.autoAnswer,model:brainRuntime.model,strict_source:brainRuntime.strictSource,has_credential:Boolean(brainRuntime.apiKey)},nativeCapture.sessionId||null);
      return json(redactedBrainRuntime());
    }
    if (u.pathname === '/v1/asr/retry-failed' && req.method === 'POST') {
      if (!requireState(req)) return json({ error:'AUTH_REQUIRED' },403);
      const b=await req.json().catch(()=>({})); const sid=String(b.sessionId||nativeCapture.sessionId||'');
      const rows=db.query("SELECT id FROM speech_segments WHERE session_id=? AND state IN ('ASR_FAILED','FROZEN','TRANSCRIBED_EMPTY') ORDER BY created_at LIMIT 50").all(sid);
      for(const row of rows) queueMicrotask(()=>processSegmentAsr(row.id).catch(()=>{}));
      return json({queued:rows.length});
    }

    if (u.pathname === '/v1/router/classify' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      return json(routePersian(String(b.text || ''), String(b.mode || 'study')));
    }

    if (u.pathname === '/v1/sessions' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      const id = randomUUID();
      db.query('INSERT INTO sessions VALUES(?,?,?,?,?)').run(id, now(), null, String(b.mode || 'study'), 'READY_NATIVE_CAPTURE');
      emit('session.started', { mode: b.mode || 'study' }, id);
      return json({ id, state: 'READY_NATIVE_CAPTURE', nativeCaptureAvailable: await nativeProbeAvailable() }, 201);
    }

    const stop = u.pathname.match(/^\/v1\/sessions\/([^/]+)\/stop$/);
    if (stop && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      if (nativeCapture.proc && nativeCapture.sessionId === stop[1]) await stopNativeCapture();
      db.query('UPDATE sessions SET ended_at=?,state=? WHERE id=?').run(now(), 'CLOSED', stop[1]);
      emit('session.closed', {}, stop[1]);
      return json({ id: stop[1], state: 'CLOSED' });
    }

    const turnsPath = u.pathname.match(/^\/v1\/sessions\/([^/]+)\/turns$/);
    if (turnsPath && req.method === 'GET') {
      return json({ turns: turnWithLatestAnswerRows(turnsPath[1]) });
    }

    const transcriptsPath = u.pathname.match(/^\/v1\/sessions\/([^/]+)\/transcripts$/);
    if (transcriptsPath && req.method === 'GET') {
      return json({ transcripts: transcriptTimeline(transcriptsPath[1], Math.max(1, Math.min(200, Number(u.searchParams.get('limit')) || 80))) });
    }

    const gapsPath = u.pathname.match(/^\/v1\/sessions\/([^/]+)\/gaps$/);
    if (gapsPath && req.method === 'GET') {
      return json({ gaps: db.query('SELECT * FROM gaps WHERE session_id=? ORDER BY created_at').all(gapsPath[1]) });
    }

    if (u.pathname === '/v1/questions' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      const sessionId = String(b.sessionId || '');
      const session = db.query('SELECT id,mode,state FROM sessions WHERE id=?').get(sessionId);
      if (!session) return json({ error: 'SESSION_NOT_FOUND' }, 404);
      const text = String(b.text || '').trim();
      if (!text) return json({ error: 'EMPTY_TEXT' }, 400);
      if (text.length > 20_000) return json({ error: 'TEXT_TOO_LARGE' }, 413);

      const clientRequestId = String(b.clientRequestId || '').trim() || null;
      if (clientRequestId) {
        const existing = db.query('SELECT * FROM turns WHERE client_request_id=?').get(clientRequestId);
        if (existing) return json({ turn: existing, route: { kind: existing.kind, shouldAnswer: ['question','request'].includes(existing.kind), reason: existing.route_reason, score: existing.route_score }, deduplicated: true });
      }

      const route = routePersian(text, session.mode);
      const ordinal = (db.query('SELECT COALESCE(MAX(ordinal),0)+1 n FROM turns WHERE session_id=?').get(sessionId)?.n) || 1;
      const id = randomUUID();
      db.query('INSERT INTO turns VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, sessionId, ordinal, 'manual', route.kind, text, route.normalized, route.reason, route.score, clientRequestId, 'COMMITTED', now());
      emit('turn.committed', { turn_id: id, ordinal, kind: route.kind, route_reason: route.reason, should_answer: route.shouldAnswer }, sessionId);
      const turn = db.query('SELECT * FROM turns WHERE id=?').get(id);
      return json({ turn, route }, 201);
    }

    const turnDetailPath = u.pathname.match(/^\/v1\/turns\/([^/]+)$/);
    if (turnDetailPath && req.method === 'GET') {
      const turn=db.query('SELECT * FROM turns WHERE id=?').get(turnDetailPath[1]);
      if(!turn) return json({error:'TURN_NOT_FOUND'},404);
      const answers=db.query('SELECT * FROM answer_results WHERE turn_id=? ORDER BY created_at').all(turn.id).map(answerFromRow);
      const segments=db.query(`SELECT s.*,tr.text_raw transcript_text,tr.provider transcript_provider,tr.provider_model transcript_model,tr.revision transcript_revision
        FROM turn_segments ts JOIN speech_segments s ON s.id=ts.segment_id
        LEFT JOIN transcript_revisions tr ON tr.id=(SELECT id FROM transcript_revisions x WHERE x.segment_id=s.id ORDER BY revision DESC LIMIT 1)
        WHERE ts.turn_id=? ORDER BY ts.ordinal`).all(turn.id);
      return json({turn,answers,latestAnswer:answers.at(-1)||null,segments});
    }

    const answerPath = u.pathname.match(/^\/v1\/turns\/([^/]+)\/answer$/);
    if (answerPath && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const turn = db.query('SELECT * FROM turns WHERE id=?').get(answerPath[1]);
      if (!turn) return json({ error: 'TURN_NOT_FOUND' }, 404);
      if (!['question', 'request'].includes(turn.kind)) {
        return json({ error: 'TURN_NOT_ANSWERABLE', message: 'این Turn به عنوان statement تشخیص داده شد؛ هیچ درخواست Brain ارسال نشد.', turnId: turn.id }, 409);
      }

      const b = await req.json().catch(() => ({}));
      const lane = String(b.lane || 'fast');
      const model = String(b.model || 'gemini-3.1-flash-lite').trim();
      const idempotencyKey = String(b.idempotencyKey || `${turn.id}:${lane}:${model}`);
      const existing = db.query('SELECT * FROM answer_results WHERE idempotency_key=?').get(idempotencyKey);
      if (existing) return json({ result: answerFromRow(existing), turn, deduplicated: true });

      const correlationId = randomUUID();
      emit('answer.queued', { correlation_id: correlationId, turn_id: turn.id, lane, model }, turn.session_id);
      const out = await callBrain({
        question: turn.text_normalized,
        apiKey: String(b.apiKey || brainRuntime.apiKey || '').trim(),
        model,
        strictSource: b.strictSource !== false,
        correlationId
      });

      if (out.error === 'RATE_LIMITED') return json(out, 429, out.retryAfter ? { 'retry-after': out.retryAfter } : {});
      if (out.error === 'AUTH_REQUIRED') return json(out, 401);
      if (out.error === 'PROVIDER_SCHEMA_ERROR') return json(out, 502);
      if (out.error) return json(out, 502);

      const answerId = randomUUID();
      db.query('INSERT INTO answer_results VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        answerId,
        turn.id,
        idempotencyKey,
        lane,
        out.model || model,
        out.result.answer,
        out.result.grounding,
        JSON.stringify(out.result.sourceChunkIds || []),
        JSON.stringify(out.result.retrieved || []),
        Number(out.result.invalidCitationCount || 0),
        now()
      );
      emit('answer.completed', { correlation_id: correlationId, answer_id: answerId, turn_id: turn.id, grounding: out.result.grounding }, turn.session_id);
      const saved = db.query('SELECT * FROM answer_results WHERE id=?').get(answerId);
      return json({ result: answerFromRow(saved), turn, correlationId });
    }

    if (u.pathname === '/v1/brain/test' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      const out = await callBrain({
        question: 'فقط با یک کلمه و در فیلد answer بگو OK',
        apiKey: String(b.apiKey || brainRuntime.apiKey || '').trim(),
        model: String(b.model || 'gemini-3.1-flash-lite').trim(),
        strictSource: false
      });
      if (out.error === 'RATE_LIMITED') return json(out, 429, out.retryAfter ? { 'retry-after': out.retryAfter } : {});
      if (out.error === 'AUTH_REQUIRED') return json(out, 401);
      if (out.error) return json(out, 502);
      return json(out);
    }

    if (u.pathname === '/v1/sources' && req.method === 'GET') {
      return json({ sources: db.query('SELECT d.*,COUNT(c.id) chunk_count FROM source_documents d LEFT JOIN source_chunks c ON c.document_id=d.id GROUP BY d.id ORDER BY d.created_at DESC').all() });
    }

    if (u.pathname === '/v1/sources' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      const text = String(b.text || '');
      if (!text.trim() || text.length > 8_000_000) return json({ error: 'SOURCE_SIZE_INVALID' }, 400);
      const id = randomUUID();
      const title = String(b.title || 'Source').slice(0, 240);
      const type = String(b.mimeType || 'text/plain');
      const sha = createHash('sha256').update(text).digest('hex');
      const chunks = chunkText(text);
      db.transaction(() => {
        db.query('INSERT INTO source_documents VALUES(?,?,?,?,?)').run(id, title, type, sha, now());
        for (const c of chunks) {
          const cid = `${id}:${c.ordinal}`;
          const normalized = normalizeFa(c.raw);
          db.query('INSERT INTO source_chunks VALUES(?,?,?,?,?,?,?)').run(cid, id, c.ordinal, c.raw, normalized, c.start, c.end);
          db.query('INSERT INTO source_fts(chunk_id,document_id,text_normalized) VALUES(?,?,?)').run(cid, id, normalized);
        }
      })();
      emit('source.indexed', { document_id: id, title, chunks: chunks.length });
      return json({ document: { id, title, sha256: sha, chunks: chunks.length } }, 201);
    }

    const del = u.pathname.match(/^\/v1\/sources\/([^/]+)$/);
    if (del && req.method === 'DELETE') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const id = del[1];
      db.transaction(() => {
        db.query('DELETE FROM source_fts WHERE document_id=?').run(id);
        db.query('DELETE FROM source_documents WHERE id=?').run(id);
      })();
      return json({ deleted: id });
    }

    if (u.pathname === '/v1/retrieve' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const b = await req.json().catch(() => ({}));
      const query = String(b.query || '');
      const results = retrieve(query, Math.max(1, Math.min(12, Number(b.limit) || 8)));
      return json({ query: normalizeFa(query), results: serializeRetrieved(results) });
    }

    if (u.pathname === '/v1/diagnostics/export' && req.method === 'GET') {
      if (!authed(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      const recentFailures = db.query("SELECT event_type,correlation_id,payload_json,occurred_at FROM event_log WHERE event_type IN ('provider.schema_error','provider.http_error','provider.network_error','retrieval.failed','native.capture.channel_failed','native.audio.gap_detected','native.probe_stderr','native.segment.write_failed','asr.failed','asr.worker_error') ORDER BY occurred_at DESC LIMIT 30").all()
        .map(r => ({ ...r, payload: JSON.parse(r.payload_json), payload_json: undefined }));
      return json({
        generatedAt: now(),
        health: health(),
        metrics: {
          sessions: db.query('SELECT COUNT(*) n FROM sessions').get().n,
          turns: db.query('SELECT COUNT(*) n FROM turns').get().n,
          answers: db.query('SELECT COUNT(*) n FROM answer_results').get().n,
          gaps: db.query('SELECT COUNT(*) n FROM gaps').get().n,
          sources: db.query('SELECT COUNT(*) n FROM source_documents').get().n,
          chunks: db.query('SELECT COUNT(*) n FROM source_chunks').get().n,
          audioChunks: db.query('SELECT COUNT(*) n FROM audio_chunks').get().n,
          audioBytes: db.query('SELECT COALESCE(SUM(byte_length),0) n FROM audio_chunks').get().n,
          segments: db.query('SELECT COUNT(*) n FROM speech_segments').get().n,
          transcripts: db.query('SELECT COUNT(*) n FROM transcript_revisions').get().n,
          asrJobs: db.query('SELECT COUNT(*) n FROM asr_jobs').get().n
        },
        native: nativeStatus(),
        asr: redactedAsrStatus(),
        brainRuntime: redactedBrainRuntime(),
        recentSegments: db.query('SELECT id,session_id,channel_id,seq_start,seq_end,duration_ms,endpoint_reason,vad_engine,state,created_at FROM speech_segments ORDER BY created_at DESC LIMIT 20').all(),
        recentTranscripts: db.query('SELECT segment_id,revision,provider,provider_model,text_raw,language,is_final,created_at FROM transcript_revisions ORDER BY created_at DESC LIMIT 20').all(),
        recentFailures,
        secretsIncluded: false,
        audioIncluded: false,
        note: 'Diagnostics exclude secrets and raw audio. WASAPI + live segment-final transcript validation are testable; production Rust neural VAD + gRPC streaming partial/final release gates remain pending.'
      });
    }

    if (u.pathname === '/v1/shutdown' && req.method === 'POST') {
      if (!requireState(req)) return json({ error: 'AUTH_REQUIRED' }, 403);
      setTimeout(() => process.exit(0), 150);
      return json({ status: 'closing' });
    }

    const file = await staticFile(u.pathname);
    if (file) {
      return new Response(file.body, {
        headers: {
          'content-type': mime[file.ext] || 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:;"
        }
      });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  }
});

setTimeout(openBrowser, 250);
console.log(`Auralis ${VERSION} at ${ORIGIN}`);
