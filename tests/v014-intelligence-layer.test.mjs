import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeTurn } from '../core/turn-intelligence.mjs';
import { buildQueryPlan, chunkDocument, rankCandidates } from '../core/rag-engine.mjs';
import { validateCitations } from '../core/citation-integrity.mjs';
import { runCitationBenchmark } from '../core/citation-benchmark.mjs';

const server=await readFile(new URL('../server.mjs',import.meta.url),'utf8');
const contracts=await readFile(new URL('../packages/contracts/src/index.ts',import.meta.url),'utf8');
const app=await readFile(new URL('../apps/web/public/app-react.js',import.meta.url),'utf8');

test('turn intelligence resolves an explicit continuation to the latest answerable turn', () => {
  const result = analyzeTurn({
    text: 'حالا تفاوتش را بیشتر توضیح بده',
    mode: 'study',
    previousTurns: [
      { id: 't1', kind: 'question', text_normalized: 'رگرسیون خطی چیست' },
      { id: 't2', kind: 'statement', text_normalized: 'یک نکته فرعی' }
    ]
  });
  assert.equal(result.intent, 'compare');
  assert.equal(result.parentTurnId, 't1');
  assert.equal(result.continuation, true);
  assert.match(result.retrievalQuery, /رگرسیون خطی چیست/);
});

test('turn intelligence fails closed for a referential turn without a parent', () => {
  const result = analyzeTurn({ text: 'این را بیشتر بگو', previousTurns: [] });
  assert.equal(result.ambiguous, true);
  assert.equal(result.parentTurnId, null);
  assert.ok(result.confidence < 0.7);
});

test('production chunker is deterministic, overlapping, and preserves exact offsets', () => {
  const text = `${'بخش اول درباره رگرسیون خطی است. '.repeat(30)}\n\n${'بخش دوم درباره واریانس است. '.repeat(30)}`;
  const a = chunkDocument(text, { targetChars: 500, overlapChars: 60 });
  const b = chunkDocument(text, { targetChars: 500, overlapChars: 60 });
  assert.deepEqual(a, b);
  assert.ok(a.length > 2);
  for (const chunk of a) assert.equal(text.replace(/\r\n?/g, '\n').slice(chunk.start, chunk.end), chunk.raw);
  assert.ok(a[1].start < a[0].end);
});

test('hybrid ranker prioritizes coverage and enforces document diversity', () => {
  const plan = buildQueryPlan('تفاوت واریانس و انحراف معیار چیست');
  const ranked = rankCandidates([
    { chunk_id:'a1',document_id:'a',title:'آمار',text_raw:'واریانس و انحراف معیار دو معیار پراکندگی هستند',ftsRank:3 },
    { chunk_id:'a2',document_id:'a',title:'آمار',text_raw:'واریانس تعریف می‌شود',ftsRank:0 },
    { chunk_id:'a3',document_id:'a',title:'آمار',text_raw:'انحراف معیار تعریف می‌شود',ftsRank:1 },
    { chunk_id:'b1',document_id:'b',title:'پراکندگی',text_raw:'تفاوت واریانس و انحراف معیار به واحد اندازه‌گیری مربوط است',ftsRank:4 }
  ], plan, { limit:3, maxPerDocument:2 });
  assert.equal(ranked[0].chunk_id, 'b1');
  assert.equal(ranked.filter(item => item.document_id === 'a').length, 2);
});

test('citation validator rejects unknown ids and quotes absent from evidence', () => {
  const result = validateCitations({ citations:[
    {chunkId:'c1',quote:'واریانس یک معیار پراکندگی است'},
    {chunkId:'c2',quote:'نقل قول ساختگی'},
    {chunkId:'fake',quote:'هر متن'}
  ]}, [
    {chunkId:'c1',text:'در این فصل واریانس یک معیار پراکندگی است.'},
    {chunkId:'c2',text:'این متن درباره میانگین است.'}
  ]);
  assert.deepEqual(result.sourceChunkIds, ['c1']);
  assert.equal(result.invalidCitationCount, 2);
  assert.equal(result.precision, 0.3333);
  assert.equal(result.quoteCoverage, 1);
});

test('citation benchmark scores accepted evidence and adversarial rejection without false positives', () => {
  const report=runCitationBenchmark([
    {id:'valid',evidence:[{chunkId:'c1',text:'این متن یک شاهد معتبر و قابل نقل است.'}],citations:[{chunkId:'c1',quote:'یک شاهد معتبر و قابل نقل است'}],expectedChunkIds:['c1']},
    {id:'invalid',evidence:[{chunkId:'c2',text:'متن واقعی'}],citations:[{chunkId:'c2',quote:'متن جعلی طولانی'}],expectedChunkIds:[]}
  ]);
  assert.equal(report.passed,true);
  assert.equal(report.precision,1);
  assert.equal(report.quoteCoverage,1);
});

test('v0.14 server persists intelligence, retrieval provenance, source lineage, and citation audits',()=>{
  for(const table of ['turn_intelligence','retrieval_runs','retrieval_hits','citation_audits']) assert.ok(server.includes(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.ok(server.includes("UPDATE source_documents SET status='SUPERSEDED'"));
  assert.ok(server.includes("UPDATE source_documents SET status='DELETED'"));
  assert.ok(server.includes('persistAnswerResult({answerId'));
  assert.ok(server.includes('backfillTurnIntelligence();'));
  assert.ok(server.includes("releaseClass: 'PERSONAL_MEMORY_ENGINE_CANDIDATE'"));
});

test('v0.14 contracts and locked inspector expose intelligence and exact citations',()=>{
  assert.ok(contracts.includes('interface TurnIntelligenceRecord'));
  assert.ok(contracts.includes('interface RetrievalRunRecord'));
  assert.ok(contracts.includes("'grounding_unverified'"));
  assert.ok(app.includes("v0.16.0 · Personal Memory Engine"));
  assert.ok(app.includes("className:'intelligence-strip'"));
  assert.ok(app.includes("className:'citation-quote'"));
});
