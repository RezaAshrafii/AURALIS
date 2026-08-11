import { Store } from './store.js';

const $ = id => document.getElementById(id);
const store = new Store({
  token: '', version: '', sessionId: null, mode: 'study', health: null,
  turns: [], transcripts: [], answer: null, selectedTurnId: null, sources: [], metrics: null, native: null, asr: null, busyCommit: false
});

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (store.get().token) headers.set('x-auralis-token', store.get().token);
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(data.message || data.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function clsState(value) {
  const s = String(value || '').toUpperCase();
  if (s.includes('HEALTHY') || s.includes('READY')) return 'good';
  if (s.includes('NOT_BUILT') || s.includes('FAILED') || s.includes('ERROR')) return 'bad';
  return 'warn';
}

function renderHealth(h) {
  const grid = $('healthGrid');
  grid.innerHTML = '';
  if (!h) return;
  for (const [key, value] of Object.entries(h.components || {})) {
    const item = document.createElement('div');
    item.className = 'health-item';
    item.innerHTML = `<div class="name"></div><div class="state ${clsState(value.state)}"></div><small></small>`;
    item.querySelector('.name').textContent = key;
    item.querySelector('.state').textContent = value.state;
    item.querySelector('small').textContent = value.engine || '';
    grid.appendChild(item);
  }
  $('globalStatus').textContent = h.status?.toUpperCase() || 'UNKNOWN';
  $('globalStatus').className = `badge ${h.status === 'healthy' ? 'good' : h.status === 'failed' ? 'bad' : 'warn'}`;
}

function renderTurns(turns) {
  const box = $('turns');
  const selectedId = store.get().selectedTurnId;
  box.innerHTML = '';
  if (!turns?.length) {
    box.innerHTML = '<div class="empty">هنوز Turn ثبت نشده.</div>';
    return;
  }
  for (const turn of turns) {
    const card = document.createElement('div');
    card.className = `turn${selectedId === turn.id ? ' selected' : ''}`;
    card.dataset.turnId = turn.id;
    card.innerHTML = `
      <div class="turn-top"><span class="turn-label"></span><span class="turn-time"></span></div>
      <div class="turn-kind-row"><span class="turn-q-label"></span><span class="turn-source-badge"></span></div>
      <div class="turn-text"></div>
      <div class="turn-answer-wrap"></div>
      <div class="turn-route"></div>`;
    card.querySelector('.turn-label').textContent = `Turn ${turn.ordinal} · ${turn.kind}`;
    card.querySelector('.turn-time').textContent = new Date(turn.created_at || Date.now()).toLocaleTimeString('fa-IR');
    card.querySelector('.turn-q-label').textContent = turn.kind === 'statement' ? 'متن' : 'پرسش / درخواست';
    card.querySelector('.turn-source-badge').textContent = turn.source_role || 'manual';
    card.querySelector('.turn-text').textContent = turn.text_raw || '';
    const aw = card.querySelector('.turn-answer-wrap');
    if (selectedId === turn.id) card.classList.add('expanded');
    if (turn.answer_text) {
      const label = document.createElement('div'); label.className='turn-a-label'; label.textContent='پاسخ';
      const preview = document.createElement('div'); preview.className=`turn-answer-preview${selectedId === turn.id ? ' full' : ''}`; preview.textContent=turn.answer_text;
      aw.append(label, preview);
    } else {
      const empty = document.createElement('div'); empty.className='turn-no-answer'; empty.textContent = ['question','request'].includes(turn.kind) ? 'هنوز پاسخی برای این Turn ثبت نشده.' : 'Statement — بدون درخواست Brain'; aw.appendChild(empty);
    }
    card.querySelector('.turn-route').textContent = `router: ${turn.route_reason || '—'} · score ${Number(turn.route_score || 0).toFixed(2)} · ${String(turn.id).slice(0, 8)}`;
    card.onclick = () => selectTurn(turn.id);
    box.appendChild(card);
  }
}

async function selectTurn(turnId) {
  if (!turnId) return;
  store.set({ selectedTurnId: turnId });
  renderTurns(store.get().turns || []);
  try {
    const detail = await api(`/v1/turns/${turnId}`);
    const latest = detail.latestAnswer;
    if (latest) {
      renderAnswer({ result: latest, turn: detail.turn, segments: detail.segments || [] });
    } else {
      renderTurnWithoutAnswer(detail);
    }
    const answerable = ['question','request'].includes(detail.turn?.kind);
    $('answerSelected').disabled = !answerable;
  } catch (error) {
    showAnswerNotice(`TURN_DETAIL_ERROR\n${error.message}`, 'bad');
  }
}

function renderTurnWithoutAnswer(detail) {
  const box = $('answerBox'); $('evidenceBox').innerHTML='';
  const turn = detail?.turn || {};
  box.innerHTML = '<div class="answer-binding"></div><div class="answer-question"></div><div class="answer-notice"></div><div class="turn-detail-meta"></div><div class="segment-meta"></div>';
  box.querySelector('.answer-binding').textContent = `Turn ${turn.ordinal || '—'} · ${String(turn.id||'').slice(0,8)} · ${turn.source_role || 'manual'}`;
  box.querySelector('.answer-question').textContent = turn.text_raw || '';
  box.querySelector('.answer-notice').textContent = ['question','request'].includes(turn.kind) ? 'این Turn قابل پاسخ است ولی هنوز Answer ندارد.' : 'این Turn statement است و به Brain ارسال نمی‌شود.';
  const meta=box.querySelector('.turn-detail-meta');
  meta.innerHTML=`<div>kind<br><strong>${turn.kind||'—'}</strong></div><div>router<br><strong>${turn.route_reason||'—'}</strong></div><div>score<br><strong>${Number(turn.route_score||0).toFixed(2)}</strong></div>`;
  const seg = detail?.segments?.[0];
  const segBox=box.querySelector('.segment-meta');
  segBox.textContent = seg ? `segment=${seg.id}\nASR=${seg.transcript_provider || '—'} / ${seg.transcript_model || '—'}\nrevision=${seg.transcript_revision || '—'}\nseq=${seg.seq_start}..${seg.seq_end}\nendpoint=${seg.endpoint_reason}` : 'manual turn · no audio segment';
}

function renderAnswer(payload) {
  const box = $('answerBox');
  const evidence = $('evidenceBox');
  evidence.innerHTML = '';
  if (!payload) {
    box.innerHTML = '<div class="empty">پاسخ اینجا نمایش داده می‌شود.</div>';
    return;
  }
  const result = payload.result || payload;
  const turn = payload.turn || {};
  box.innerHTML = `
    <div class="answer-binding"></div>
    <div class="answer-question"></div>
    <div class="answer-text"></div>
    <div class="answer-meta"></div>`;
  box.querySelector('.answer-binding').textContent = turn.ordinal ? `Answer ↔ Turn ${turn.ordinal} · ${String(turn.id || '').slice(0, 8)}` : 'Brain result';
  box.querySelector('.answer-question').textContent = turn.text_raw || turn.text_normalized || '';
  box.querySelector('.answer-text').textContent = result.answer || '';
  box.querySelector('.answer-meta').textContent = `grounding: ${result.grounding || '—'} · citations: ${(result.sourceChunkIds || []).length} · invalid citations: ${result.invalidCitationCount || 0}${payload.deduplicated ? ' · idempotent cache' : ''}`;
  if (payload.segments?.length) {
    const seg = payload.segments[0];
    const meta=document.createElement('div'); meta.className='segment-meta';
    meta.textContent=`segment=${seg.id}
ASR=${seg.transcript_provider || '—'} / ${seg.transcript_model || '—'}
revision=${seg.transcript_revision || '—'}
seq=${seg.seq_start}..${seg.seq_end}
endpoint=${seg.endpoint_reason}`;
    box.appendChild(meta);
  }

  const cited = new Set(result.sourceChunkIds || []);
  for (const item of result.retrieved || []) {
    const card = document.createElement('div');
    card.className = `evidence-item${cited.has(item.chunkId) ? ' cited' : ''}`;
    card.innerHTML = `<div class="evidence-head"></div><div class="evidence-excerpt"></div>`;
    card.querySelector('.evidence-head').textContent = `${cited.has(item.chunkId) ? 'CITED · ' : ''}${item.title} · chunk ${item.ordinal} · score ${Number(item.score || 0).toFixed(3)}`;
    card.querySelector('.evidence-excerpt').textContent = item.excerpt || '';
    evidence.appendChild(card);
  }
}

function showAnswerNotice(text, kind = 'neutral') {
  const box = $('answerBox');
  $('evidenceBox').innerHTML = '';
  box.innerHTML = '<div class="answer-notice"></div>';
  box.querySelector('.answer-notice').textContent = text;
  box.querySelector('.answer-notice').classList.add(kind);
}


function transcriptStateClass(item) {
  const s = String(item?.asr_status || item?.segment_state || '').toUpperCase();
  if (item?.text_raw || s === 'COMPLETED' || s === 'TRANSCRIBED') return 'good';
  if (s.includes('FAILED') || item?.asr_error) return 'bad';
  return 'warn';
}

function renderTranscripts(items = []) {
  store.set({ transcripts: items });
  const feed = $('liveTranscriptFeed');
  feed.innerHTML = '';
  const asr = store.get().asr;
  if (!items.length) {
    $('liveTranscriptText').textContent = asr?.enabled ? 'منتظر گفتار… بعد از مکث کوتاه، متن نهایی اینجا ظاهر می‌شود.' : 'ASR خاموش است. در تب Brain، «راه‌اندازی صوت→متن + Brain» را فعال کن.';
    $('liveTranscriptMeta').textContent = asr?.enabled ? `${asr.provider} · ${asr.model}` : 'Capture می‌تواند فعال باشد، اما بدون ASR متن ساخته نمی‌شود.';
    $('liveAsrBadge').textContent = asr?.enabled ? (asr.lastState || 'READY') : 'ASR OFF';
    $('liveAsrBadge').className = `badge ${asr?.enabled ? 'warn' : 'neutral'}`;
    feed.innerHTML = '<div class="empty compact-empty">هنوز Speech Segment نهایی نشده.</div>';
    return;
  }
  const latest = items[0];
  const latestText = String(latest.text_raw || '').trim();
  $('liveTranscriptText').textContent = latestText || (latest.asr_status === 'RUNNING' ? 'در حال تبدیل این Segment به متن…' : latest.asr_error ? `ASR failed: ${latest.asr_error}` : 'صوت ثبت شد؛ متن هنوز آماده نیست.');
  $('liveTranscriptMeta').textContent = `${latest.channel_id} · ${Math.round(Number(latest.duration_ms||0))}ms · segment ${String(latest.segment_id||'').slice(-12)} · ${latest.provider || latest.asr_status || latest.segment_state || 'FROZEN'}`;
  $('liveAsrBadge').textContent = latestText ? 'FINAL' : (latest.asr_status || latest.segment_state || 'WAITING');
  $('liveAsrBadge').className = `badge ${transcriptStateClass(latest)}`;
  for (const item of items.slice(0, 8)) {
    const row = document.createElement('div');
    row.className = `transcript-row ${transcriptStateClass(item)}`;
    row.innerHTML = '<div class="transcript-row-top"><span class="tr-state"></span><span class="tr-meta"></span></div><div class="tr-text"></div>';
    row.querySelector('.tr-state').textContent = item.text_raw ? 'FINAL' : (item.asr_status || item.segment_state || 'FROZEN');
    row.querySelector('.tr-meta').textContent = `${item.channel_id} · ${Math.round(Number(item.duration_ms||0))}ms · rev ${item.revision || '—'}`;
    row.querySelector('.tr-text').textContent = item.text_raw || (item.asr_error ? `خطا: ${item.asr_error}` : 'منتظر transcription…');
    feed.appendChild(row);
  }
}

async function refreshTranscripts() {
  const sid = store.get().sessionId;
  if (!sid) { renderTranscripts([]); return; }
  try {
    const data = await api(`/v1/sessions/${sid}/transcripts?limit=40`);
    renderTranscripts(data.transcripts || []);
  } catch (error) {
    $('liveTranscriptText').textContent = `TRANSCRIPT_FEED_ERROR: ${error.message}`;
  }
}

async function quickSetupRuntime() {
  const key = $('apiKey').value.trim();
  if (!key) throw new Error('ابتدا Gemini API Key را وارد کن.');
  const sid = await ensureSession();
  $('quickSetupStatus').textContent = 'در حال فعال‌سازی ASR + Brain…';
  const data = await api('/v1/runtime/quick-setup', { method:'POST', body:JSON.stringify({
    sessionId:sid, apiKey:key, model:$('model').value, strictSource:$('strictSource').checked, autoAnswer:$('autoBrain').checked
  }) });
  $('asrApiKey').value = key;
  $('asrGeminiModel').value = $('model').value;
  renderAsrStatus(data.asr);
  $('brainStatus').textContent = `Runtime ON · auto ${data.brain?.autoAnswer ? 'ON' : 'OFF'} · key RAM OK`;
  $('quickSetupStatus').textContent = `PASS · Audio→Text ON · Brain ON · pending segments queued: ${data.queuedPending || 0}`;
  await Promise.all([refreshHealth(), refreshTranscripts()]);
}

function fmtBytes(n) {
  const v = Number(n || 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024**2) return `${(v/1024).toFixed(1)} KB`;
  if (v < 1024**3) return `${(v/1024**2).toFixed(1)} MB`;
  return `${(v/1024**3).toFixed(2)} GB`;
}

function renderNative(data) {
  store.set({ native: data });
  $('nativeState').textContent = data.state || 'READY';
  $('nativeState').className = `badge ${['FAILED'].includes(data.state) ? 'bad' : ['CAPTURING','STARTING','STOPPING'].includes(data.state) ? 'warn' : 'neutral'}`;
  const hb = data.lastHeartbeatAt ? new Date(data.lastHeartbeatAt).toLocaleTimeString('fa-IR') : '—';
  $('nativeSummary').textContent = `chunks ${data.chunks || 0} · ${fmtBytes(data.bytes)} · gaps ${data.gaps || 0} · queue ${data.queueDepth || 0}/${data.queueCapacity || 0} · heartbeat ${hb}${data.lastError ? ` · ${data.lastError}` : ''}`;
  const box = $('nativeChannels'); box.innerHTML = '';
  const channels = Object.entries(data.channels || {});
  if (!channels.length) { box.innerHTML = '<div class="empty">هنوز channel فعال نشده.</div>'; return; }
  for (const [id, ch] of channels) {
    const el = document.createElement('div'); el.className='native-channel';
    const rate = ch.sample_rate || ch.sampleRate || 0, count = ch.channels || 0, seq = ch.lastSequence || 0;
    el.innerHTML='<strong></strong><span class="state"></span><div class="mono"></div>';
    el.querySelector('strong').textContent=id;
    el.querySelector('.state').textContent=ch.state || '—';
    el.querySelector('.mono').textContent=`${rate} Hz · ${count} ch · seq ${seq}`;
    box.appendChild(el);
  }
}

async function refreshNative() {
  try { renderNative(await api('/v1/native-capture/status')); } catch {}
}

async function startNative() {
  const sessionId = await ensureSession();
  const data = await api('/v1/native-capture/start', { method:'POST', body:JSON.stringify({ sessionId, mic:$('captureMic').checked, loopback:$('captureLoopback').checked, chunkSeconds:Number($('chunkSeconds').value) }) });
  renderNative(data);
  setTimeout(refreshNative, 500);
}

async function stopNative() {
  const data = await api('/v1/native-capture/stop', { method:'POST', body:'{}' });
  renderNative(data);
  setTimeout(refreshNative, 700);
}

async function refreshHealth() {
  const health = await api('/v1/health');
  store.set({ health });
  renderHealth(health);
  $('versionHandshake').textContent = `UI ${store.get().version || '?'} ↔ Core ${health.version} ${store.get().version === health.version ? 'OK' : 'MISMATCH'}`;
}

async function refreshTurns({ autoSelectNewest = false } = {}) {
  const id = store.get().sessionId;
  if (!id) { renderTurns([]); return; }
  const before = store.get().turns || [];
  const data = await api(`/v1/sessions/${id}/turns`);
  const selected = store.get().selectedTurnId;
  const grew = data.turns.length > before.length;
  let selectedTurnId = selected;
  if ((!selectedTurnId || (autoSelectNewest && grew)) && data.turns.length) selectedTurnId = data.turns.at(-1).id;
  store.set({ turns: data.turns, selectedTurnId });
  renderTurns(data.turns);
  if (selectedTurnId && (grew || !store.get().answer)) await selectTurn(selectedTurnId);
}

async function refreshSources() {
  const data = await api('/v1/sources');
  store.set({ sources: data.sources });
  const box = $('sourceList');
  box.innerHTML = '';
  if (!data.sources.length) {
    box.innerHTML = '<div class="empty">منبعی وجود ندارد.</div>';
    return;
  }
  for (const source of data.sources) {
    const el = document.createElement('div');
    el.className = 'source-item';
    const meta = document.createElement('div');
    meta.innerHTML = '<strong></strong><br><small></small>';
    meta.querySelector('strong').textContent = source.title;
    meta.querySelector('small').textContent = `${source.chunk_count} chunks · ${source.sha256.slice(0, 12)}…`;
    const button = document.createElement('button');
    button.className = 'ghost small';
    button.textContent = 'حذف';
    button.onclick = async () => { await api(`/v1/sources/${source.id}`, { method: 'DELETE' }); await refreshSources(); await refreshMetrics(); };
    el.append(meta, button);
    box.appendChild(el);
  }
}

async function refreshMetrics() {
  const data = await api('/v1/metrics/summary');
  store.set({ metrics: data });
  const labels = {
    sessions: 'Sessions', turns: 'Turns', answers: 'Answers', gaps: 'Gaps',
    sources: 'Sources', chunks: 'Chunks', schemaErrors: 'Schema Errors', audioChunks: 'Audio Chunks', nativeRuns: 'Native Runs', segments: 'Segments', transcripts: 'Transcripts', asrJobs: 'ASR Jobs'
  };
  $('metrics').innerHTML = Object.entries(labels)
    .map(([key, label]) => `<div class="metric"><span>${label}</span><b>${data[key] ?? 0}</b></div>`)
    .join('');
}

async function ensureSession() {
  if (store.get().sessionId) return store.get().sessionId;
  const data = await api('/v1/sessions', { method: 'POST', body: JSON.stringify({ mode: 'study' }) });
  store.set({ sessionId: data.id });
  $('sessionBadge').textContent = `Session ${data.id.slice(0, 8)}`;
  return data.id;
}

async function commitCurrent({ withAnswer = false } = {}) {
  if (store.get().busyCommit) return null;
  const text = $('manualText').value.trim();
  if (!text) return null;
  store.set({ busyCommit: true });
  $('commitTurn').disabled = true;
  $('askBrain').disabled = true;
  try {
    const sessionId = await ensureSession();
    const clientRequestId = crypto.randomUUID();
    const data = await api('/v1/questions', {
      method: 'POST',
      body: JSON.stringify({ sessionId, text, clientRequestId })
    });
    $('manualText').value = '';
    $('routeResult').textContent = `${data.route.kind} · ${data.route.reason} · ${Number(data.route.score || 0).toFixed(2)}`;
    $('routeResult').className = `route-chip ${data.route.shouldAnswer ? 'answerable' : 'statement'}`;
    store.set({ selectedTurnId: data.turn.id });
    await refreshTurns();
    await selectTurn(data.turn.id);

    if (withAnswer) {
      if (!data.route.shouldAnswer) {
        showAnswerNotice(`Turn ${data.turn.ordinal} به‌عنوان statement تشخیص داده شد؛ هیچ درخواست Brain ارسال نشد.`, 'good');
      } else {
        await askBrainForTurn(data.turn);
      }
    }
    return data;
  } finally {
    store.set({ busyCommit: false });
    $('commitTurn').disabled = false;
    $('askBrain').disabled = false;
  }
}

async function askBrainForTurn(turn) {
  showAnswerNotice(`در حال پاسخ به Turn ${turn.ordinal}…`);
  try {
    const data = await api(`/v1/turns/${turn.id}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        apiKey: $('apiKey').value,
        model: $('model').value,
        lane: 'fast',
        strictSource: $('strictSource').checked,
        idempotencyKey: `${turn.id}:fast:${$('model').value}:${$('strictSource').checked ? 'strict' : 'open'}`
      })
    });
    store.set({ answer: data, selectedTurnId: turn.id });
    renderAnswer(data);
    await refreshTurns();
    await selectTurn(turn.id);
    await refreshMetrics();
  } catch (error) {
    const code = error.data?.error || 'ERROR';
    const retry = error.data?.retryAfter ? ` · retry-after=${error.data.retryAfter}` : '';
    const diag = error.data?.diagnosticsId ? ` · diagnostics=${error.data.diagnosticsId}` : '';
    showAnswerNotice(`${code}${retry}${diag}\n${error.data?.message || error.message}`, 'bad');
    await refreshMetrics();
  }
}

function updateAsrProviderFields() {
  const google = $('asrProvider').value === 'google-stt-v2';
  $('asrGoogleFields').classList.toggle('hidden', !google);
  $('asrGeminiFields').classList.toggle('hidden', google);
}

function renderAsrStatus(data) {
  store.set({ asr: data });
  $('asrState').textContent = data?.lastState || (data?.enabled ? 'READY' : 'DISABLED');
  $('asrState').className = `badge ${data?.lastState === 'HEALTHY' ? 'good' : data?.lastState?.includes('ERROR') || data?.lastState === 'FAILED' ? 'bad' : data?.enabled ? 'warn' : 'neutral'}`;
  $('asrStatusText').textContent = `${data?.provider || '—'} · ${data?.model || '—'} · ${data?.language || '—'} · credential ${data?.hasCredential ? 'RAM OK' : 'missing'}${data?.lastError ? ` · ${data.lastError}` : ''}`;
}

async function refreshAsr() { try { renderAsrStatus(await api('/v1/asr/status')); if (!(store.get().transcripts||[]).length) renderTranscripts([]); } catch {} }

async function applyAsr(enabled = true) {
  const provider = $('asrProvider').value;
  const body = {
    enabled,
    provider,
    model: provider === 'google-stt-v2' ? $('asrGoogleModel').value : $('asrGeminiModel').value,
    apiKey: provider === 'gemini-audio-experimental' ? $('asrApiKey').value : '',
    accessToken: provider === 'google-stt-v2' ? $('asrAccessToken').value : '',
    projectId: $('asrProjectId').value,
    location: $('asrLocation').value,
    language: $('asrLanguage').value,
    autoCommitTurns: $('asrAutoCommit').checked
  };
  const data = await api('/v1/asr/config', { method:'POST', body:JSON.stringify(body) });
  renderAsrStatus(data);
  await Promise.all([refreshHealth(), refreshTranscripts()]);
}

async function applyBrainRuntime() {
  const data = await api('/v1/brain/runtime-config', { method:'POST', body:JSON.stringify({
    enabled:true, autoAnswer:$('autoBrain').checked, apiKey:$('apiKey').value, model:$('model').value, strictSource:$('strictSource').checked
  }) });
  $('brainStatus').textContent = `Runtime ${data.enabled ? 'ON' : 'OFF'} · auto ${data.autoAnswer ? 'ON' : 'OFF'} · key ${data.hasCredential ? 'RAM OK' : 'missing'}`;
  await refreshHealth();
}

function renderRetrieveResults(data) {
  const box = $('retrieveCards');
  box.innerHTML = '';
  if (!data.results?.length) {
    box.innerHTML = '<div class="empty">نتیجه‌ای پیدا نشد.</div>';
    return;
  }
  for (const item of data.results) {
    const card = document.createElement('div');
    card.className = 'retrieve-card';
    card.innerHTML = '<div class="retrieve-head"></div><div class="retrieve-excerpt"></div><div class="retrieve-id"></div>';
    card.querySelector('.retrieve-head').textContent = `${item.title} · chunk ${item.ordinal} · score ${Number(item.score || 0).toFixed(3)}`;
    card.querySelector('.retrieve-excerpt').textContent = item.excerpt || '';
    card.querySelector('.retrieve-id').textContent = item.chunkId;
    box.appendChild(card);
  }
}

async function runRouterTests() {
  const cases = [
    'چرا', 'چرا اینطور شد', 'چی شد', 'کجا بود', 'آیا درست است', 'چه اتفاقی افتاد',
    'کی میاد', 'چند نفر بودند', 'چقدر طول می‌کشد', 'میانگین چیست', 'لطفاً توضیح بده',
    'این بخش رو دوباره بگو', 'فرق این دو تا چیه', 'امروز درباره واریانس صحبت کردیم'
  ];
  const box = $('routerTests');
  box.innerHTML = '';
  for (const text of cases) {
    const result = await api('/v1/router/classify', { method: 'POST', body: JSON.stringify({ text }) });
    const expected = text !== 'امروز درباره واریانس صحبت کردیم';
    const pass = result.shouldAnswer === expected;
    const row = document.createElement('div');
    row.className = 'test-row';
    row.innerHTML = `<span></span><strong class="state ${pass ? 'good' : 'bad'}"></strong>`;
    row.querySelector('span').textContent = text;
    row.querySelector('strong').textContent = `${pass ? 'PASS' : 'FAIL'} · ${result.kind} · ${result.reason}`;
    box.appendChild(row);
  }
}

function bind() {
  document.querySelectorAll('.tabs button').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === button));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      $(`view-${button.dataset.view}`).classList.add('active');
    };
  });

  $('startSession').onclick = async () => { if (!store.get().sessionId) await ensureSession(); };
  $('stopSession').onclick = async () => {
    const id = store.get().sessionId;
    if (!id) return;
    await api(`/v1/sessions/${id}/stop`, { method: 'POST' });
    store.set({ sessionId: null, turns: [], transcripts: [], answer: null, selectedTurnId: null });
    $('sessionBadge').textContent = 'بدون جلسه';
    $('routeResult').textContent = 'Auto Router';
    $('routeResult').className = 'route-chip';
    renderTurns([]);
    renderTranscripts([]);
    renderAnswer(null);
  };

  $('commitTurn').onclick = () => commitCurrent({ withAnswer: false });
  $('askBrain').onclick = () => commitCurrent({ withAnswer: true });
  $('answerSelected').onclick = async () => { const id=store.get().selectedTurnId; if(!id) return; const turn=(store.get().turns||[]).find(t=>t.id===id); if(turn) await askBrainForTurn(turn); };
  $('manualText').addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      commitCurrent({ withAnswer: true });
    }
  });

  $('refreshHealth').onclick = refreshHealth;
  $('refreshSources').onclick = refreshSources;
  $('refreshMetrics').onclick = refreshMetrics;
  $('startNativeCapture').onclick = async () => { try { $('captureMic').disabled=true; $('captureLoopback').disabled=true; $('chunkSeconds').disabled=true; await startNative(); } catch (e) { $('nativeSummary').textContent = e.data?.error || e.message; $('captureMic').disabled=false; $('captureLoopback').disabled=false; $('chunkSeconds').disabled=false; } };
  $('stopNativeCapture').onclick = async () => { try { await stopNative(); } catch (e) { $('nativeSummary').textContent = e.data?.error || e.message; } finally { setTimeout(()=>{ $('captureMic').disabled=false; $('captureLoopback').disabled=false; $('chunkSeconds').disabled=false; },1000); } };
  $('asrProvider').onchange = updateAsrProviderFields;
  $('applyAsr').onclick = () => applyAsr(true).catch(e => $('asrStatusText').textContent = e.data?.error || e.message);
  $('disableAsr').onclick = () => applyAsr(false).catch(e => $('asrStatusText').textContent = e.data?.error || e.message);
  $('retryAsr').onclick = async () => { const sid=store.get().sessionId; if(!sid) return; const out=await api('/v1/asr/retry-failed',{method:'POST',body:JSON.stringify({sessionId:sid})}); $('asrStatusText').textContent=`queued ${out.queued}`; };
  $('applyBrainRuntime').onclick = () => applyBrainRuntime().catch(e => $('brainStatus').textContent=e.data?.error||e.message);
  $('quickSetupRuntime').onclick = () => quickSetupRuntime().catch(e => $('quickSetupStatus').textContent = e.data?.message || e.message);
  $('goAsrSetup').onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.view === 'brain'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-brain').classList.add('active');
    $('apiKey').focus();
  };

  $('sourceFile').onchange = async event => {
    const file = event.target.files?.[0];
    if (file) {
      $('sourceTitle').value = file.name;
      $('sourceText').value = await file.text();
    }
  };

  $('importSource').onclick = async () => {
    const text = $('sourceText').value;
    const title = $('sourceTitle').value.trim() || 'Source';
    $('sourceImportStatus').textContent = 'Indexing…';
    try {
      const data = await api('/v1/sources', { method: 'POST', body: JSON.stringify({ title, text, mimeType: 'text/plain' }) });
      $('sourceImportStatus').textContent = `PASS · ${data.document.chunks} chunks · ${data.document.sha256.slice(0, 16)}…`;
      await refreshSources();
      await refreshMetrics();
    } catch (error) {
      $('sourceImportStatus').textContent = `FAIL · ${error.message}`;
    }
  };

  $('runRetrieve').onclick = async () => {
    const data = await api('/v1/retrieve', { method: 'POST', body: JSON.stringify({ query: $('retrieveQuery').value, limit: 8 }) });
    renderRetrieveResults(data);
  };

  $('testBrain').onclick = async () => {
    const status = $('brainStatus');
    status.textContent = 'Testing…';
    try {
      const data = await api('/v1/brain/test', { method: 'POST', body: JSON.stringify({ apiKey: $('apiKey').value, model: $('model').value }) });
      status.textContent = `PASS · ${data.model || $('model').value} · ${String(data.result?.answer || '').slice(0, 80)}`;
    } catch (error) {
      status.textContent = `FAIL · ${error.data?.error || error.message}${error.data?.diagnosticsId ? ` · ${error.data.diagnosticsId}` : ''}`;
    }
  };

  $('clearKey').onclick = () => {
    $('apiKey').value = '';
    $('brainStatus').textContent = 'API key از فرم پاک شد؛ اگر Runtime فعال بوده، برای حذف از Core دوباره Runtime را بدون key اعمال کن.';
  };

  $('runRouterTests').onclick = runRouterTests;
  $('routerProbeBtn').onclick = async () => {
    const data = await api('/v1/router/classify', { method: 'POST', body: JSON.stringify({ text: $('routerProbe').value }) });
    $('routerProbeResult').textContent = JSON.stringify(data, null, 2);
  };

  $('exportDiag').onclick = async () => {
    const data = await api('/v1/diagnostics/export');
    $('diagPreview').textContent = JSON.stringify(data, null, 2);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `auralis-v0104-live-transcript-diagnostics-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
}

(async () => {
  const bootstrap = await fetch('/v1/bootstrap').then(r => r.json());
  store.set({ token: bootstrap.token, version: bootstrap.version });
  bind();
  updateAsrProviderFields();
  await runRouterTests();
  await Promise.all([refreshHealth(), refreshSources(), refreshMetrics(), refreshNative(), refreshAsr(), refreshTranscripts()]);
  setInterval(async () => {
    const state = store.get().native?.state;
    if (['STARTING','CAPTURING','STOPPING'].includes(state)) { await refreshNative(); await refreshHealth(); }
    if (store.get().sessionId) { await refreshTranscripts(); await refreshTurns({ autoSelectNewest: true }); }
    if (store.get().asr?.enabled) await refreshAsr();
  }, 1000);
})();
