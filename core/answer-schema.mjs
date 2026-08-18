export class AnswerSchemaError extends Error {
  constructor(message, code = 'PROVIDER_SCHEMA_ERROR') {
    super(message);
    this.name = 'AnswerSchemaError';
    this.code = code;
  }
}

const allowedGrounding = new Set(['source', 'mixed', 'general', 'insufficient', 'runtime']);

function stripFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim();
}

function extractBalancedObject(value) {
  const s = String(value || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (start < 0) {
      if (ch === '{') {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseObjectCandidate(raw) {
  let candidate = stripFence(raw);
  for (let depth = 0; depth < 4; depth += 1) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      const embedded = extractBalancedObject(candidate);
      if (!embedded || embedded === candidate) {
        throw new AnswerSchemaError('Provider output was not valid JSON.');
      }
      candidate = embedded;
      continue;
    }

    if (typeof parsed === 'string') {
      candidate = stripFence(parsed);
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AnswerSchemaError('Provider output JSON was not an object.');
    }

    // Some providers occasionally wrap the intended object inside answer/content.
    for (const key of ['answer', 'content', 'result']) {
      const nested = parsed[key];
      if (typeof nested === 'string' && /\{[\s\S]*"answer"/u.test(nested)) {
        try {
          const nestedParsed = JSON.parse(stripFence(nested));
          if (nestedParsed && typeof nestedParsed === 'object' && !Array.isArray(nestedParsed) && 'answer' in nestedParsed) {
            parsed = nestedParsed;
          }
        } catch {
          // Keep the outer object; validation below will still prevent raw JSON leakage.
        }
      }
    }
    return parsed;
  }
  throw new AnswerSchemaError('Provider output nesting exceeded the parser limit.');
}

export function parseAnswerEnvelope(raw, allowedChunkIds = []) {
  const parsed = parseObjectCandidate(raw);
  const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
  if (!answer) throw new AnswerSchemaError('Provider output did not contain a non-empty answer string.');

  // Never let a second JSON envelope appear as user-visible answer text.
  if (/^\s*\{[\s\S]*"(?:answer|sourceChunkIds|grounding)"/u.test(answer)) {
    const nested = parseObjectCandidate(answer);
    if (typeof nested.answer !== 'string' || !nested.answer.trim()) {
      throw new AnswerSchemaError('Nested provider envelope was invalid.');
    }
    return parseAnswerEnvelope(JSON.stringify(nested), allowedChunkIds);
  }

  const allow = allowedChunkIds instanceof Set ? allowedChunkIds : new Set(allowedChunkIds);
  const requestedIds = Array.isArray(parsed.sourceChunkIds) ? parsed.sourceChunkIds.map(String) : [];
  const sourceChunkIds = requestedIds.filter(id => allow.has(id));
  let grounding = allowedGrounding.has(String(parsed.grounding)) ? String(parsed.grounding) : 'general';
  if ((grounding === 'source' || grounding === 'mixed') && sourceChunkIds.length === 0) {
    grounding = 'grounding_unverified';
  }

  return {
    answer,
    sourceChunkIds,
    grounding,
    invalidCitationCount: requestedIds.length - sourceChunkIds.length,
    schemaVersion: 1
  };
}
