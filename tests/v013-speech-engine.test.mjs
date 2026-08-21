import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TranscriptState,
  TranscriptRevisionAccumulator,
  normalizeLoopbackBaseUrl,
  shouldFallbackToLocal,
  extractWhisperCppText,
  transcriptFingerprint
} from '../core/speech-engine.mjs';
import { NeuralVadStateMachine, VadState } from '../core/vad-state.mjs';

const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const app=await readFile(new URL('../apps/web/public/app-react.js',import.meta.url),'utf8');
const rustAsr=await readFile(new URL('../native/core/src/asr/mod.rs',import.meta.url),'utf8');
const rustVad=await readFile(new URL('../native/core/src/vad/mod.rs',import.meta.url),'utf8');
const migration=await readFile(new URL('../native/core/src/storage/migrations/0006_speech_engine.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../native/core/src/storage/repository.rs',import.meta.url),'utf8');
const contracts=await readFile(new URL('../packages/contracts/src/index.ts',import.meta.url),'utf8');
const runtimeStore=await readFile(new URL('../apps/web/src/runtime-store.ts',import.meta.url),'utf8');
const version=(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const webPkg=JSON.parse(await readFile(new URL('../apps/web/package.json',import.meta.url),'utf8'));
const contractsPkg=JSON.parse(await readFile(new URL('../packages/contracts/package.json',import.meta.url),'utf8'));
const cargoLock=await readFile(new URL('../native/Cargo.lock',import.meta.url),'utf8');

test('v0.13 speech reliability remains intact in the v0.14 intelligence release',()=>{
  assert.equal(version,'0.14.1');
  assert.equal(pkg.version,'0.14.1');
  assert.equal(webPkg.version,'0.14.1');
  assert.equal(contractsPkg.version,'0.14.1');
  assert.match(cargoLock,/name = "auralis-core"\nversion = "0\.14\.1"/);
  assert.ok(server.includes("INTELLIGENCE_LAYER_CANDIDATE"));
  assert.ok(app.includes('v0.14.1 · Intelligence Layer'));
});

test('transcript accumulator enforces PARTIAL -> STABLE -> FINAL revision ownership',()=>{
  const acc=new TranscriptRevisionAccumulator('seg-1');
  const p=acc.accept({state:TranscriptState.PARTIAL,text:'سلام',provider:'test',model:'m'});
  const s=acc.accept({state:TranscriptState.STABLE,text:'سلام دنیا',provider:'test',model:'m'});
  const f=acc.accept({state:TranscriptState.FINAL,text:'سلام دنیا.',provider:'test',model:'m'});
  assert.equal(p.event.revision,1);
  assert.equal(s.event.revision,2);
  assert.equal(f.event.revision,3);
  assert.equal(acc.finalText,'سلام دنیا.');
});

test('stable transcript cannot regress and final transcript cannot be rewritten',()=>{
  const acc=new TranscriptRevisionAccumulator('seg-2');
  assert.equal(acc.accept({state:'STABLE',text:'رگرسیون خطی',provider:'p',model:'m'}).accepted,true);
  assert.equal(acc.accept({state:'STABLE',text:'متن دیگر',provider:'p',model:'m'}).reason,'STABLE_PREFIX_REGRESSION');
  assert.equal(acc.accept({state:'FINAL',text:'رگرسیون خطی ساده',provider:'p',model:'m'}).accepted,true);
  assert.equal(acc.accept({state:'PARTIAL',text:'دوباره',provider:'p',model:'m'}).reason,'ALREADY_FINAL');
});

test('local ASR endpoint is strictly loopback-only and strips URL decoration',()=>{
  assert.equal(normalizeLoopbackBaseUrl('http://127.0.0.1:8080/'),'http://127.0.0.1:8080');
  assert.equal(normalizeLoopbackBaseUrl('http://localhost:9000///'),'http://localhost:9000');
  assert.equal(normalizeLoopbackBaseUrl('http://127.0.0.1:8080/inference?token=secret#x'),'http://127.0.0.1:8080');
  assert.throws(()=>normalizeLoopbackBaseUrl('http://127.0.0.1:8080/admin'));
  assert.throws(()=>normalizeLoopbackBaseUrl('https://127.0.0.1:8080'));
  assert.throws(()=>normalizeLoopbackBaseUrl('http://192.168.1.20:8080'));
  assert.throws(()=>normalizeLoopbackBaseUrl('http://example.com:8080'));
});

test('fallback policy covers cloud auth quota network provider and internal failures',()=>{
  for(const error of ['AUTH_REQUIRED','RATE_LIMITED','ASR_NETWORK_ERROR','ASR_PROVIDER_ERROR','ASR_INTERNAL_ERROR','ASR_CONFIG_INVALID']){
    assert.equal(shouldFallbackToLocal({error}),true,error);
  }
  assert.equal(shouldFallbackToLocal({error:'ASR_AUDIO_READ_ERROR'}),false);
});

test('whisper.cpp response parser accepts common JSON response shapes',()=>{
  assert.equal(extractWhisperCppText({text:'  سلام دنیا  '}),'سلام دنیا');
  assert.equal(extractWhisperCppText({segments:[{text:'سلام'},{text:'دنیا'}]}),'سلام دنیا');
  assert.equal(extractWhisperCppText({transcription:[{text:'یک'},{text:'دو'}]}),'یک دو');
});

test('transcript fingerprint deduplicates identical provider events',()=>{
  const a=transcriptFingerprint({segmentId:'s',state:'FINAL',text:'سلام',provider:'p',model:'m'});
  const b=transcriptFingerprint({segmentId:'s',state:'FINAL',text:' سلام ',provider:'p',model:'m'});
  const c=transcriptFingerprint({segmentId:'s',state:'STABLE',text:'سلام',provider:'p',model:'m'});
  assert.equal(a,b);
  assert.notEqual(a,c);
});

test('neural VAD hysteresis suppresses short noise and closes after sustained silence',()=>{
  const vad=new NeuralVadStateMachine({minSpeechMs:60,minSilenceMs:90,startThreshold:0.6,endThreshold:0.4});
  assert.equal(vad.state,VadState.SILENCE);
  assert.deepEqual(vad.observe(0.8,30),[]);
  assert.equal(vad.observe(0.2,30).length,0); // short impulse discarded
  assert.deepEqual(vad.observe(0.8,30),[]);
  assert.equal(vad.observe(0.8,30)[0].type,'speech_started');
  assert.equal(vad.state,VadState.SPEECH);
  assert.deepEqual(vad.observe(0.2,30),[]);
  assert.deepEqual(vad.observe(0.2,30),[]);
  const ended=vad.observe(0.2,30);
  assert.equal(ended[0].type,'speech_ended');
  assert.equal(ended[0].reason,'silence');
  assert.equal(vad.state,VadState.SILENCE);
});

test('server persists transcript stream protocol separately from final transcript revisions',()=>{
  assert.ok(server.includes('CREATE TABLE IF NOT EXISTS transcript_stream_events'));
  assert.ok(server.includes("CHECK(state IN ('PARTIAL','STABLE','FINAL'))"));
  assert.ok(server.includes('fingerprint TEXT NOT NULL UNIQUE'));
  assert.ok(server.includes('recordTranscriptStreamEvent(segment, TranscriptState.FINAL'));
});

test('canonical FINAL is emitted once while stream FINAL remains durably persisted',()=>{
  assert.equal((server.match(/emit\('transcript\.final'/g)||[]).length,1);
  assert.ok(server.includes('if (normalizedState !== TranscriptState.FINAL)'));
});

test('shared contracts expose STABLE stream state without corrupting canonical final revision store',()=>{
  assert.ok(contracts.includes("export type TranscriptStreamState = 'PARTIAL' | 'STABLE' | 'FINAL'"));
  assert.ok(contracts.includes("type: 'transcript.stable'"));
  assert.ok(runtimeStore.includes("case 'transcript.stable':"));
  assert.ok(runtimeStore.includes('Streaming revisions are transient/protocol events'));
});

test('Brain identifies the current intelligence-layer contract',()=>{
  assert.ok(server.includes('You are Auralis v0.14.1 Intelligence Layer.'));
  assert.ok(!server.includes('You are Auralis v0.12.0 Text-only Brain.'));
});

test('server integrates whisper.cpp fallback without exposing arbitrary HTTP destinations',()=>{
  assert.ok(server.includes('async function callWhisperCppAsr'));
  assert.ok(server.includes("normalizeLoopbackBaseUrl(local.baseUrl"));
  assert.ok(server.includes("`${baseUrl}/inference`"));
  assert.ok(server.includes("asr.fallback_started"));
  assert.ok(server.includes("asr.fallback_completed"));
  assert.ok(server.includes("asr.fallback_failed"));
});

test('local fallback keeps primary AUTH_REQUIRED from disabling ASR when offline recovery exists',()=>{
  assert.ok(server.includes("if(out.error==='AUTH_REQUIRED' && !cfg.localFallback?.enabled) asrRuntime.enabled=false;"));
  assert.ok(server.includes('shouldFallbackToLocal(primary)'));
});

test('UI exposes local whisper fallback controls without redesigning the focused workspace',()=>{
  assert.ok(app.includes('Fallback محلی whisper.cpp'));
  assert.ok(app.includes('saveLocalAsr()'));
  assert.ok(app.includes('probeLocalAsr()'));
  assert.ok(app.includes('focused-workspace'));
});

test('Rust core defines streaming transcript and neural VAD boundaries',()=>{
  for(const needle of ['TranscriptState','StreamingTranscriptEvent','FallbackStarted','LocalWhisperConfig']) assert.ok(rustAsr.includes(needle),needle);
  for(const needle of ["rest.contains('@')","rsplit_once(':')",'host must be loopback']) assert.ok(rustAsr.includes(needle),needle);
  for(const needle of ['NeuralVadConfig','VadProbabilityPort','NeuralVadStateMachine','SpeechStarted','SpeechEnded']) assert.ok(rustVad.includes(needle),needle);
});

test('Rust ledger schema v6 persists streaming transcript events',()=>{
  assert.ok(migration.includes('CREATE TABLE IF NOT EXISTS TranscriptStreamEvent'));
  assert.ok(migration.includes("CHECK(state IN ('PARTIAL','STABLE','FINAL'))"));
  assert.ok(repository.includes('const SCHEMA_VERSION: u32 = 6;'));
  assert.ok(repository.includes('(6_u32, SPEECH_ENGINE_MIGRATION_0006)'));
});
