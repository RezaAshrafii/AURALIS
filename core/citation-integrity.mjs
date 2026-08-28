import { normalizeFa } from "./persian-router.mjs";

function evidenceMap(evidence) {
  if (evidence instanceof Set)
    return new Map([...evidence].map((id) => [String(id), { chunkId: String(id), text: null }]));
  if (evidence instanceof Map) return evidence;
  const map = new Map();
  for (const item of evidence || []) {
    const chunkId = String(item?.chunkId || item?.chunk_id || "").trim();
    if (!chunkId) continue;
    map.set(chunkId, {
      chunkId,
      text: String(item?.text || item?.textRaw || item?.text_raw || ""),
      title: String(item?.title || ""),
    });
  }
  return map;
}

export function validateCitations(parsed, evidence = []) {
  const allowed = evidenceMap(evidence);
  const requested = Array.isArray(parsed?.citations)
    ? parsed.citations.map((item) => ({
        chunkId: String(item?.chunkId || item?.chunk_id || ""),
        quote: String(item?.quote || "").trim(),
      }))
    : Array.isArray(parsed?.sourceChunkIds)
      ? parsed.sourceChunkIds.map((chunkId) => ({ chunkId: String(chunkId), quote: "" }))
      : [];
  const seen = new Set();
  const citations = [];
  let invalidCitationCount = 0;
  let duplicateCitationCount = 0;
  for (const citation of requested) {
    if (!citation.chunkId || !allowed.has(citation.chunkId)) {
      invalidCitationCount += 1;
      continue;
    }
    if (seen.has(citation.chunkId)) {
      duplicateCitationCount += 1;
      continue;
    }
    const source = allowed.get(citation.chunkId);
    if (!citation.quote && source.text !== null) {
      invalidCitationCount += 1;
      continue;
    }
    if (citation.quote && source.text !== null) {
      const normalizedQuote = normalizeFa(citation.quote);
      const normalizedSource = normalizeFa(source.text);
      if (normalizedQuote.length < 6 || !normalizedSource.includes(normalizedQuote)) {
        invalidCitationCount += 1;
        continue;
      }
    }
    seen.add(citation.chunkId);
    citations.push(
      Object.freeze({ chunkId: citation.chunkId, quote: citation.quote, title: source.title || "" })
    );
  }
  const sourceChunkIds = citations.map((item) => item.chunkId);
  const requestedCount = requested.length;
  return Object.freeze({
    citations,
    sourceChunkIds,
    requestedCount,
    validCitationCount: citations.length,
    invalidCitationCount,
    duplicateCitationCount,
    precision: requestedCount ? Number((citations.length / requestedCount).toFixed(4)) : 1,
    quoteCoverage: citations.length
      ? Number((citations.filter((item) => item.quote).length / citations.length).toFixed(4))
      : 0,
  });
}
