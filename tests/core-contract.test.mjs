import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersian } from '../core/persian-router.mjs';
import { parseAnswerEnvelope, AnswerSchemaError } from '../core/answer-schema.mjs';

const requiredQuestions = [
  'چرا', 'چرا اینطور شد', 'چی شد', 'کجا بود', 'آیا درست است', 'چه اتفاقی افتاد',
  'کی میاد', 'چند نفر بودند', 'چقدر طول می‌کشد', 'میانگین چیست', 'لطفاً توضیح بده',
  'این بخش رو دوباره بگو', 'فرق این دو تا چیه'
];

test('Persian router accepts all required question/request regressions', () => {
  for (const q of requiredQuestions) assert.equal(routePersian(q).shouldAnswer, true, q);
});

test('Persian router does not answer ordinary statements', () => {
  for (const s of ['امروز درباره واریانس صحبت کردیم', 'کلاس ساعت ده شروع شد', 'این یک جمله خبری ساده است']) {
    const r = routePersian(s);
    assert.equal(r.shouldAnswer, false, s);
    assert.equal(r.kind, 'statement');
  }
});

test('answer parser accepts direct JSON and filters citations', () => {
  const out = parseAnswerEnvelope('{"answer":"پاسخ","sourceChunkIds":["a","x"],"grounding":"source"}', new Set(['a']));
  assert.equal(out.answer, 'پاسخ');
  assert.deepEqual(out.sourceChunkIds, ['a']);
  assert.equal(out.invalidCitationCount, 1);
});

test('answer parser unwraps fenced JSON', () => {
  const out = parseAnswerEnvelope('```json\n{"answer":"متن سالم","sourceChunkIds":[],"grounding":"general"}\n```', new Set());
  assert.equal(out.answer, 'متن سالم');
});

test('answer parser unwraps nested JSON answer envelope', () => {
  const nested = JSON.stringify({answer: JSON.stringify({answer:'جواب نهایی',sourceChunkIds:['c1'],grounding:'source'}), sourceChunkIds:[], grounding:'general'});
  const out = parseAnswerEnvelope(nested, new Set(['c1']));
  assert.equal(out.answer, 'جواب نهایی');
  assert.deepEqual(out.sourceChunkIds, ['c1']);
});

test('answer parser rejects malformed provider payload instead of leaking it', () => {
  assert.throws(() => parseAnswerEnvelope('{"answer":"ناقص"', new Set()), AnswerSchemaError);
});

test('source grounding without an allowed citation is marked unverified', () => {
  const out = parseAnswerEnvelope('{"answer":"پاسخ","sourceChunkIds":["fake"],"grounding":"source"}', new Set(['real']));
  assert.equal(out.grounding, 'grounding_unverified');
});
