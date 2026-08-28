import { createHash } from "node:crypto";
import { normalizeFa } from "./persian-router.mjs";

const QUERY_STOP_WORDS = new Set([
  "از",
  "به",
  "در",
  "با",
  "برای",
  "که",
  "این",
  "آن",
  "اون",
  "یک",
  "و",
  "یا",
  "را",
  "رو",
  "من",
  "تو",
  "ما",
  "شما",
  "او",
  "هم",
  "است",
  "هست",
  "بود",
  "شد",
  "شود",
  "چی",
  "چه",
  "چرا",
  "چطور",
  "چگونه",
  "کدام",
  "میشه",
  "می‌شود",
  "لطفا",
  "لطفاً",
  "بگو",
  "بده",
  "کن",
]);

function tokenize(value) {
  return normalizeFa(value)
    .replace(/[^\p{L}\p{N}_+.-]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function quotedPhrases(value) {
  const phrases = [];
  for (const match of String(value || "").matchAll(/[«"“]([^»"”]{2,120})[»"”]/gu)) {
    const normalized = normalizeFa(match[1]);
    if (normalized) phrases.push(normalized);
  }
  return unique(phrases).slice(0, 6);
}

export function buildQueryPlan(query, { contextQuery = "" } = {}) {
  const normalized = normalizeFa(query);
  const contextNormalized = normalizeFa(contextQuery);
  const primaryTerms = unique(
    tokenize(normalized).filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term))
  ).slice(0, 18);
  const contextTerms = unique(
    tokenize(contextNormalized).filter((term) => term.length > 2 && !QUERY_STOP_WORDS.has(term))
  )
    .filter((term) => !primaryTerms.includes(term))
    .slice(0, 6);
  const terms = [...primaryTerms, ...contextTerms];
  const phrases = quotedPhrases(query);
  const ftsQuery = terms.map((term) => `"${term.replaceAll('"', "")}"`).join(" OR ");
  return Object.freeze({
    schemaVersion: 1,
    query: String(query || "").trim(),
    normalized,
    contextNormalized,
    primaryTerms,
    contextTerms,
    terms,
    phrases,
    ftsQuery,
  });
}

function adjustTrimmedSpan(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

function chooseBoundary(text, start, targetEnd, minimumEnd) {
  const candidates = [
    text.lastIndexOf("\n\n", targetEnd),
    text.lastIndexOf("\n", targetEnd),
    text.lastIndexOf("؟", targetEnd),
    text.lastIndexOf(". ", targetEnd),
    text.lastIndexOf("! ", targetEnd),
    text.lastIndexOf("؛", targetEnd),
  ].filter((index) => index >= minimumEnd);
  if (candidates.length === 0) return targetEnd;
  return Math.max(...candidates) + 1;
}

export function chunkDocument(text, { targetChars = 1_100, overlapChars = 140 } = {}) {
  const source = String(text || "").replace(/\r\n?/g, "\n");
  if (!Number.isInteger(targetChars) || targetChars < 300 || targetChars > 4_000)
    throw new TypeError("targetChars must be between 300 and 4000");
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= targetChars / 2)
    throw new TypeError("overlapChars must be non-negative and less than half targetChars");
  const chunks = [];
  let cursor = 0;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;
    const targetEnd = Math.min(source.length, cursor + targetChars);
    const minimumEnd = Math.min(source.length, cursor + Math.floor(targetChars * 0.62));
    let end =
      targetEnd < source.length
        ? chooseBoundary(source, cursor, targetEnd, minimumEnd)
        : source.length;
    if (end <= cursor) end = targetEnd;
    const span = adjustTrimmedSpan(source, cursor, end);
    const raw = source.slice(span.start, span.end);
    if (raw) {
      chunks.push(
        Object.freeze({
          ordinal: chunks.length,
          raw,
          normalized: normalizeFa(raw),
          start: span.start,
          end: span.end,
          tokenCount: tokenize(raw).length,
          sha256: createHash("sha256").update(raw).digest("hex"),
        })
      );
    }
    if (end >= source.length) break;
    const next = Math.max(cursor + 1, end - overlapChars);
    const whitespace = source.indexOf(" ", next);
    cursor = whitespace >= 0 && whitespace < end ? whitespace + 1 : next;
  }
  return chunks;
}

function scoreCandidate(candidate, plan) {
  const text = normalizeFa(
    candidate.text_normalized ||
      candidate.textNormalized ||
      candidate.text_raw ||
      candidate.textRaw ||
      ""
  );
  const title = normalizeFa(candidate.title || "");
  const matchedTerms = plan.terms.filter((term) => text.includes(term));
  const primaryMatched = plan.primaryTerms.filter((term) => text.includes(term));
  const lexicalCoverage = plan.primaryTerms.length
    ? primaryMatched.length / plan.primaryTerms.length
    : 0;
  const contextCoverage = plan.contextTerms.length
    ? matchedTerms.filter((term) => plan.contextTerms.includes(term)).length /
      plan.contextTerms.length
    : 0;
  const phraseHits = plan.phrases.filter((phrase) => text.includes(phrase)).length;
  const titleHits = plan.primaryTerms.filter((term) => title.includes(term)).length;
  const ftsRank = Number.isFinite(Number(candidate.ftsRank))
    ? Math.max(0, Number(candidate.ftsRank))
    : 20;
  const ftsSignal = 1 / (1 + ftsRank);
  const score =
    lexicalCoverage * 0.56 +
    contextCoverage * 0.08 +
    Math.min(1, phraseHits) * 0.16 +
    Math.min(1, titleHits / Math.max(1, plan.primaryTerms.length)) * 0.08 +
    ftsSignal * 0.12;
  return {
    ...candidate,
    matchedTerms,
    lexicalCoverage: Number(lexicalCoverage.toFixed(4)),
    retrievalScore: Number(score.toFixed(6)),
  };
}

export function rankCandidates(candidates, plan, { limit = 8, maxPerDocument = 3 } = {}) {
  const deduped = new Map();
  for (const candidate of candidates || []) {
    const id = String(candidate.chunk_id || candidate.chunkId || "");
    if (!id || deduped.has(id)) continue;
    deduped.set(id, scoreCandidate(candidate, plan));
  }
  const sorted = [...deduped.values()].sort(
    (a, b) =>
      b.retrievalScore - a.retrievalScore ||
      Number(a.ftsRank || 0) - Number(b.ftsRank || 0) ||
      String(a.chunk_id || a.chunkId).localeCompare(String(b.chunk_id || b.chunkId))
  );
  const counts = new Map();
  const selected = [];
  for (const candidate of sorted) {
    const documentId = String(candidate.document_id || candidate.documentId || "unknown");
    const count = counts.get(documentId) || 0;
    if (count >= maxPerDocument) continue;
    counts.set(documentId, count + 1);
    selected.push({ ...candidate, rank: selected.length + 1 });
    if (selected.length >= limit) break;
  }
  return selected;
}
