import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { currentContract, targetFutureContract } from '../packages/contracts/index.mjs';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/app-react.js', import.meta.url), 'utf8');

const sorted = values => [...values].sort();
const routeKey = route => `${route.method} ${route.path}`;

function extractRoutes(source) {
  const routes = [];
  for (const match of source.matchAll(/u\.pathname === '(\/v1\/[^']+)' && req\.method === '([A-Z]+)'/g)) {
    routes.push(`${match[2]} ${match[1]}`);
  }

  const dynamicDeclarations = new Map();
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*u\.pathname\.match\(\/\^(.*?)\$\/\);/g)) {
    if (!match[2].startsWith('\\/v1\\/')) continue;
    const parameterNames = {
      replaySegmentPath: 'segmentId',
      sessionDetailPath: 'sessionId',
      stop: 'sessionId',
      turnsPath: 'sessionId',
      transcriptsPath: 'sessionId',
      gapsPath: 'sessionId',
      activityPath: 'sessionId',
      turnDetailPath: 'turnId',
      answerPath: 'turnId',
      del: 'sourceId',
    };
    let path = match[2].replaceAll('\\/', '/');
    path = path.replace('([^/]+)', `{${parameterNames[match[1]]}}`);
    dynamicDeclarations.set(match[1], path);
  }

  for (const match of source.matchAll(/if \((\w+) && req\.method === '([A-Z]+)'\)/g)) {
    const path = dynamicDeclarations.get(match[1]);
    if (path) routes.push(`${match[2]} ${path}`);
  }
  return sorted(new Set(routes));
}

function extractEmittedEvents(source) {
  const events = [...source.matchAll(/\bemit\(\s*'([^']+)'/g)].map(match => match[1]);
  const nativePrefix = source.match(/emit\(`native\.\$\{ev\.type\}`/);
  assert.ok(nativePrefix, 'native probe events must continue to be persisted with the native. prefix');
  const nativeTypes = [...source.matchAll(/ev\.type === '([^']+)'/g)]
    .map(match => match[1])
    .filter(type => type !== 'probe.heartbeat')
    .map(type => `native.${type}`);
  return sorted(new Set([...events, ...nativeTypes]));
}

test('authoritative CURRENT routes exactly match the implemented /v1 surface', () => {
  assert.deepEqual(sorted(currentContract.routes.map(routeKey)), extractRoutes(server));
  for (const route of currentContract.routes) {
    const pathParameters = [...route.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    assert.deepEqual(route.parameters, pathParameters, routeKey(route));
  }
});

test('authoritative CURRENT event vocabulary exactly matches event_log emissions', () => {
  assert.deepEqual(sorted(currentContract.eventLog.emittedTypes), extractEmittedEvents(server));
  assert.match(server, /CREATE TABLE IF NOT EXISTS event_log\(/);
  assert.match(server, /INSERT INTO event_log VALUES/);
  assert.equal(currentContract.eventLog.dynamicTypeRule, 'Every native probe type except probe.heartbeat is persisted as native.<probeEvent.type>');
  assert.match(server, /if \(ev\.type !== 'probe\.heartbeat'\) emit\(`native\.\$\{ev\.type\}`/);
  const allowlistMatch = server.match(/const allowedPayloadKeys = new Set\(\[([^\]]+)\]\)/);
  assert.ok(allowlistMatch, 'activity payload allowlist must remain explicit');
  const sourceAllowlist = [...allowlistMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(currentContract.eventLog.activityAllowedPayloadKeys, sourceAllowlist);
});

test('CURRENT realtime semantics remain non-overlapping HTTP polling over event_log', () => {
  assert.equal(currentContract.realtime.transport, 'HTTP polling');
  assert.equal(currentContract.realtime.eventSource, 'persisted SQLite event_log');
  assert.equal(currentContract.realtime.websocket, false);
  assert.equal(currentContract.realtime.serverSentEvents, false);
  assert.match(app, /setInterval\(function\(\)\{this\.poll\(\);\}\.bind\(this\),1000\)/);
  assert.match(app, /setInterval\(function\(\)\{this\.refreshMetrics\(\);\}\.bind\(this\),5000\)/);
  assert.ok(app.includes('if(this.pollInFlight)return'));
  assert.ok(server.includes('FROM event_log WHERE session_id=? ORDER BY occurred_at DESC'));
  assert.ok(!/\bWebSocket\b|\bEventSource\b/.test(server + app));
});

test('TARGET/FUTURE events and transports cannot be classified as CURRENT', () => {
  const futureEvents = ['audio.level', 'segment.started', 'transcript.partial', 'answer.partial', 'gap.detected', 'device.changed'];
  assert.equal(targetFutureContract.classification, 'TARGET/FUTURE');
  assert.equal(targetFutureContract.current, false);
  for (const event of futureEvents) {
    assert.ok(targetFutureContract.capabilities.includes(event));
    assert.ok(!currentContract.eventLog.emittedTypes.includes(event), `${event} leaked into CURRENT`);
  }
  assert.ok(targetFutureContract.capabilities.includes('WebSocket delivery'));
});

test('schema, known quirks, and credential-storage invariants stay source-backed', () => {
  assert.equal(currentContract.implementation.persistence.schemaVersion, 7);
  assert.match(server, /const SCHEMA_VERSION = 7;/);
  assert.match(server, /PRAGMA journal_mode=WAL/);
  assert.match(server, /status: nativeCapture\.state === 'FAILED' \|\| asrRuntime\.lastState === 'ASR_PROVIDER_ERROR' \? 'degraded' : 'degraded'/);
  assert.equal(currentContract.quirks.healthStatus, 'degraded');
  assert.match(server, /if \(!authed\(req\)\) return json\(\{ error: 'AUTH_REQUIRED' \}, 403\)/);
  assert.equal(currentContract.credentials.retainedInMemoryOnly, true);
  assert.match(server, /let asrRuntime = \{/);
  assert.match(server, /let brainRuntime = \{/);
  assert.match(server, /const redactedAsrStatus = \(\) => \(\{/);
  assert.match(server, /const redactedBrainRuntime = \(\) => \(\{/);
  const schemaSql = server.match(/db\.exec\(`([\s\S]*?)`\);/)?.[1] ?? '';
  assert.ok(schemaSql, 'SQLite schema must remain source-visible');
  assert.doesNotMatch(schemaSql, /api_?key|access_?token|credential|secret/i);
  assert.ok(!app.includes("localStorage.setItem('apiKey'"));
  assert.ok(!app.includes('lsSet(\'apiKey\''));
  assert.ok(!app.includes("changePreference('apiKey'"));
  assert.ok(!server.includes("INSERT OR REPLACE INTO meta(key,value) VALUES('api_key'"));
  assert.ok(!/console\.(?:log|error|warn)\([^\n]*(?:apiKey|accessToken)/.test(server));
  assert.ok(server.includes('secretsIncluded: false'));
});

test('important server/UI DTO field contracts remain represented', () => {
  const shapes = new Map(currentContract.shapes.map(item => [item.name, item.fields]));
  assert.deepEqual(shapes.get('BootstrapResponse'), ['token', 'version', 'schemaVersion', 'releaseClass']);
  assert.deepEqual(shapes.get('AnswerEnvelope'), ['answer', 'sourceChunkIds', 'grounding', 'invalidCitationCount', 'schemaVersion']);
  assert.deepEqual(shapes.get('ActivityEvent'), ['id', 'eventType', 'sessionId', 'correlationId', 'payload', 'occurredAt']);
  assert.deepEqual(shapes.get('TurnDetailResponse'), ['turn', 'answers', 'latestAnswer', 'segments']);
  assert.deepEqual(shapes.get('SessionListResponse'), ['sessions', 'activeSessionId', 'captureState']);
  for (const field of shapes.get('RetrievalResult')) assert.ok(server.includes(field), `RetrievalResult.${field}`);
  for (const field of ['sessions', 'turns', 'transcripts', 'gaps', 'activity']) assert.ok(app.includes(`.${field}`), `UI consumes ${field}`);
});
