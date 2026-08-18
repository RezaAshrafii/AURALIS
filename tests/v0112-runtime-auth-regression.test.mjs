import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyGeminiHttpError, runtimeCredentialReady } from '../core/provider-errors.mjs';

const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const app=await readFile(new URL('../app/app-react.js',import.meta.url),'utf8');
const css=await readFile(new URL('../app/styles.css',import.meta.url),'utf8');
const version=(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();

test('Gemini authentication failures are actionable and do not masquerade as generic HTTP errors',()=>{
  const out=classifyGeminiHttpError(401,JSON.stringify({error:{message:'API key not valid. Please pass a valid API key.'}}),null,'brain');
  assert.equal(out.error,'AUTH_REQUIRED');
  assert.equal(out.providerStatus,401);
  assert.match(out.message,/کلید Gemini نامعتبر/);
  assert.doesNotMatch(out.message,/پاسخ معتبر HTTP نداد/);
});

test('provider error sanitizer redacts API-key-looking material',()=>{
  const out=classifyGeminiHttpError(400,JSON.stringify({error:{message:'bad AIza123456789012345678901234567890'}}),null,'brain');
  assert.doesNotMatch(out.providerMessage,/AIza123/);
  assert.match(out.providerMessage,/REDACTED/);
});

test('runtime readiness requires enabled state and a configured credential',()=>{
  assert.equal(runtimeCredentialReady({enabled:true,hasCredential:true,lastState:'READY'}),true);
  assert.equal(runtimeCredentialReady({enabled:true,hasCredential:false,lastState:'READY'}),false);
  assert.equal(runtimeCredentialReady({enabled:true,hasCredential:true,lastState:'AUTH_REQUIRED'}),false);
});

test('overall health is no longer permanently hard-coded degraded',()=>{
  assert.ok(server.includes("const overallStatus = nativeFailure || asrFailure || brainFailure ? 'degraded' : 'healthy';"));
  assert.ok(server.includes('status: overallStatus'));
  assert.ok(!server.includes("? 'degraded' : 'degraded'"));
});

test('quick setup validates Gemini before enabling ASR and Brain',()=>{
  const start=server.indexOf("if (u.pathname === '/v1/runtime/quick-setup'");
  const end=server.indexOf("if (u.pathname === '/v1/brain/runtime-config'",start);
  const block=server.slice(start,end);
  assert.ok(block.indexOf('await probeGeminiAccess') < block.indexOf('enabled:true'));
  assert.ok(block.includes("asrRuntime={...asrRuntime,enabled:false"));
  assert.ok(block.includes('queuedAnswers=queuePendingAnswers'));
});

test('authentication failure stops repeated automatic ASR attempts while preserving failed segments for replay',()=>{
  assert.ok(server.includes("if(out.error==='AUTH_REQUIRED') asrRuntime.enabled=false;"));
  assert.ok(server.includes("s.state IN ('FROZEN','ASR_FAILED','TRANSCRIBED_EMPTY')"));
});

test('authentication failure stops repeated Brain auto-answer attempts and later setup can backfill unanswered turns',()=>{
  assert.ok(server.includes("if(out.error==='AUTH_REQUIRED') brainRuntime.enabled=false;"));
  assert.ok(server.includes('function queuePendingAnswers'));
  assert.ok(server.includes('NOT EXISTS (SELECT 1 FROM answer_results a WHERE a.turn_id=t.id)'));
});

test('main Live Transcript renders only successful transcript text, not ASR errors as conversation',()=>{
  const start=app.indexOf('renderTranscript(){');
  const end=app.indexOf('renderTurns(){',start);
  const block=app.slice(start,end);
  assert.ok(block.includes("this.state.transcripts.filter"));
  assert.ok(block.includes("item&&item.text_raw"));
  assert.ok(!block.includes("'خطا: '+text(item.asr_error)"));
  assert.ok(block.includes('runtime-inline-alert'));
});

test('AI READY in UI requires actual credential-bearing healthy runtime state',()=>{
  assert.ok(app.includes('function runtimeReady(runtime)'));
  assert.ok(app.includes("runtime.hasCredential!==true"));
  assert.ok(app.includes('runtimeReady(this.state.asr)&&runtimeReady(this.state.brainRuntime)'));
});

test('settings use page-level scrolling instead of independent nested card scrollbars',()=>{
  assert.ok(app.includes("className:'page-shell settings-page'"));
  assert.ok(css.includes('.settings-page .settings-layout>.surface{overflow:visible'));
});

test('release metadata identifies v0.11.2 stabilization patch',()=>{
  assert.equal(version,'0.11.2');
  assert.ok(server.includes("const VERSION = '0.11.2'"));
  assert.ok(app.includes("v0.11.2 · Runtime Auth Stabilization"));
});
