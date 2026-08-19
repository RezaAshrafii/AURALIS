import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { shouldAutoAnswerTurn } from '../core/turn-policy.mjs';

const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const app = await readFile(new URL('../app/app-react.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');

test('Oral Copilot mic-only request is automatically answerable', () => {
  const turn={kind:'request',source_role:'user'};
  assert.equal(shouldAutoAnswerTurn(turn,'oral_copilot',{loopbackEnabled:false}),true);
  assert.equal(shouldAutoAnswerTurn(turn,'oral_copilot',{loopbackEnabled:true}),false);
  assert.ok(server.includes('turnPolicyContext(turn.session_id)'));
  assert.ok(server.includes('turnPolicyContext(segment.session_id)'));
  assert.ok(app.includes("role==='user'&&loopbackEnabled===false"));
});

test('focused desktop workspace keeps main session free of narrow technical rails', () => {
  const patch=css.slice(css.indexOf('/* v0.10.12'));
  assert.ok(patch.includes('.focused-workspace'));
  assert.ok(patch.includes('grid-template-columns:minmax(0,1.5fr) minmax(360px,.78fr)'));
  assert.ok(patch.includes('.session-summary-strip'));
  assert.ok(app.includes('renderSessionsDrawer'));
  assert.ok(app.includes('renderConversationHub'));
});
