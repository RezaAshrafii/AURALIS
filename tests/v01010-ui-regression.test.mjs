import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/app-react.js', import.meta.url), 'utf8');
const kit = await readFile(new URL('../app/ui-kit.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const css = (await readFile(new URL('../app/styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const react = await readFile(new URL('../app/vendor/react.production.min.js', import.meta.url), 'utf8');
const reactDom = await readFile(new URL('../app/vendor/react-dom.production.min.js', import.meta.url), 'utf8');

test('portable UI uses locally vendored React 18 and createRoot', () => {
  assert.match(react, /18\.3\.1/);
  assert.match(reactDom, /18\.3\.1/);
  assert.ok(html.includes('/ui-kit.js'));
  assert.ok(app.includes('ReactDOM.createRoot'));
});

test('React #191 navigation regression cannot recur', () => {
  assert.ok(!app.includes("onClick:this.setState.bind(this,{view:"));
  assert.ok(app.includes("onClick:function(){this.setState({view:item.value});}.bind(this)"));
  assert.ok(kit.includes('getDerivedStateFromError'));
});

test('all product sections remain directly reachable', () => {
  for (const value of ['session','sources','settings','system']) assert.ok(kit.includes(`value:'${value}'`), value);
  for (const label of ['جلسه','منابع','تنظیمات','وضعیت سیستم']) assert.ok(kit.includes(label), label);
  assert.ok(!css.match(/\.top-nav\s*\{[^}]*display\s*:\s*none/s));
});

test('session workspace exposes controls, durable cycle, history and activity', () => {
  for (const value of ['renderSessionCommand','renderPipeline','renderSessionRail','جلسات اخیر','چرخهٔ پردازش','فعالیت‌های اخیر']) {
    assert.ok(app.includes(value), value);
  }
  assert.ok(server.includes("u.pathname === '/v1/sessions' && req.method === 'GET'"));
  assert.ok(server.includes('/activity$/'));
});

test('session context is persisted and passed to text-only Brain', () => {
  assert.ok(server.includes('context_text'));
  assert.ok(server.includes('SESSION CONTEXT'));
  assert.ok(server.includes('response_style'));
  assert.ok(app.includes('saveSessionSettings'));
  assert.ok(app.includes('کانتکست جلسه'));
});

test('audio inputs default to simultaneous mic and loopback', () => {
  assert.ok(app.includes("mic:lsGet('mic',true)"));
  assert.ok(app.includes("loopback:lsGet('loopback',true)"));
  assert.ok(server.includes('AUDIO_SOURCE_REQUIRED'));
});

test('UI never stores API keys in localStorage', () => {
  assert.ok(!app.includes("lsSet('apiKey'"));
  assert.ok(!app.includes("localStorage.setItem('apiKey'"));
  assert.ok(app.includes("apiKey:''"));
});

test('object-valued API fields are normalized before component rendering', () => {
  assert.ok(kit.includes('function text(value,fallback)'));
  assert.ok(kit.includes('JSON.stringify(value)'));
  assert.ok(kit.includes("h('span',null,text(props.children,''))"));
});

test('closed sessions are immutable and persisted JSON cannot crash answer rendering', () => {
  assert.ok(server.includes("session.state === 'CLOSED'"));
  assert.ok(server.includes("error: 'SESSION_CLOSED'"));
  assert.ok(server.includes('function parseJsonArray(value)'));
  assert.ok(server.includes('sourceChunkIds: parseJsonArray'));
  assert.ok(server.includes('payload: parseJsonObject'));
});

test('responsive navigation remains visible and layouts collapse cleanly', () => {
  assert.ok(css.includes('@media(max-width:1240px)'));
  assert.ok(css.includes('@media(max-width:820px)'));
  assert.ok(css.includes('.top-nav{overflow-x:auto'));
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'));
});

test('low-level telemetry stays out of the central conversation column', () => {
  const start=app.indexOf('renderTranscript(){');
  const end=app.indexOf('renderSources(){');
  const block=app.slice(start,end);
  for (const noisy of ['queueCapacity','analysis:native.analysis','component-grid']) assert.ok(!block.includes(noisy), noisy);
  assert.ok(app.includes('renderSystem(){'));
});

test('release metadata identifies the focused workspace conversation hub build', () => {
  assert.ok(server.includes("0.11.0-engineering-foundation.1"));
  assert.ok(server.includes("FOCUSED_WORKSPACE_CONVERSATION_HUB"));
  assert.ok(html.includes('Auralis v0.11.0'));
});


test('Z hotkey answers selected or latest eligible turn and never fires while typing', () => {
  assert.ok(app.includes("String(event.key||'').toLowerCase()!=='z'"));
  assert.ok(app.includes('isEditableTarget(event.target)'));
  assert.ok(app.includes('preferredHotkeyTurn()'));
  assert.ok(app.includes('ensureTurnAnswer(turn'));
  assert.ok(app.includes("'Z · پاسخ Turn آماده شد.'"));
});

test('eligible answers are prepared in background and selection only displays stored result', () => {
  assert.ok(server.includes('queueMicrotask(()=>persistAutoAnswer(turn)'));
  assert.ok(server.includes("brainRuntime.autoAnswer"));
  assert.ok(app.includes("turn.answer_text?'پاسخ آماده':autoExpected?'در حال آماده‌سازی':'دستی'"));
  assert.ok(app.includes('inspectorPinned:false'));
  assert.ok(app.includes('liveCandidate=turns.find'));
  assert.ok(app.includes("'دنبال‌کردن زنده'"));
});

test('manual text turns join the same auto-answer policy when mode allows it', () => {
  assert.ok(server.includes("shouldAutoAnswerTurn({kind:route.kind,source_role:'manual'}, session.mode, turnPolicyContext(sessionId))"));
  assert.ok(server.includes("source:'manual'"));
});

test('session rail is a full-width non-overlapping desktop row at wide and mid widths', () => {
  assert.ok(css.includes('.session-workspace{\n  grid-template-columns:minmax(0,1.42fr) minmax(360px,.78fr);'));
  assert.ok(css.includes('.session-rail{\n  grid-column:1/-1;'));
  assert.ok(css.includes('grid-template-columns:minmax(240px,.82fr) minmax(520px,1.7fr) minmax(270px,.9fr);'));
  assert.ok(css.includes('overflow:hidden;'));
  assert.ok(css.includes('.pipeline-list{grid-template-columns:repeat(3,minmax(0,1fr));'));
  assert.ok(css.includes('.session-history-list{display:grid;grid-template-columns:1fr 1fr;'));
});

test('mode hints explain automatic answer ownership', () => {
  assert.ok(kit.includes('سؤال و درخواست شما از میکروفون به‌صورت خودکار پاسخ می‌گیرد'));
  assert.ok(kit.includes('سؤال طرف مقابل از صدای سیستم خودکار پاسخ می‌گیرد'));
  assert.ok(kit.includes('برای جلوگیری از لو رفتن جواب'));
});
