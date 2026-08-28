import { normalizeFa, routePersian } from "./persian-router.mjs";

const STOP_WORDS = new Set([
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
  "همین",
  "همون",
  "است",
  "هست",
  "بود",
  "شد",
  "شود",
  "شده",
  "می",
  "شود",
  "کرد",
  "کن",
  "کنه",
  "بده",
  "بگو",
  "لطفا",
  "لطفاً",
  "درباره",
  "راجع",
  "روی",
  "بعد",
  "قبل",
]);

const CONTINUATION_PATTERNS = [
  /^(?:حالا|پس|بنابراین|یعنی|خب|در ادامه|ادامه|بیشتر|دوباره|این(?:و|‌رو)?|اون(?:و|‌رو)?|همین|همون)\b/u,
  /(?:بیشتر توضیح بده|ادامه بده|منظورت چیه|مثال بزن|باز کن|کامل‌تر بگو)$/u,
];

const INTENT_RULES = [
  ["compare", /(?:مقایسه|فرق|تفاوت|بهتر|بدتر|در برابر|نسبت به)/u],
  ["summarize", /(?:خلاصه|جمع‌بندی|چکیده)/u],
  ["calculate", /(?:محاسبه|حساب کن|چقدر|چند درصد|فرمول)/u],
  ["verify", /(?:بررسی کن|درسته|صحت|تأیید|مطمئن|واقعاً)/u],
  ["define", /(?:تعریف کن|چیست|چیه|یعنی چی|منظور از)/u],
  ["explain", /(?:توضیح|شرح|چرا|چگونه|چطور|چجوری)/u],
  ["list", /(?:فهرست|لیست|نام ببر|موارد|گزینه‌ها)/u],
  ["instruct", /(?:مراحل|روش|چطور|چگونه|راهنما|انجام بده|بساز)/u],
];

function tokenize(value) {
  return normalizeFa(value)
    .replace(/[^\p{L}\p{N}_+.-]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function extractQuotedTerms(text) {
  const out = [];
  const pattern = /[«"“]([^»"”]{2,80})[»"”]/gu;
  for (const match of String(text || "").matchAll(pattern)) out.push(normalizeFa(match[1]));
  return out;
}

function inferIntent(normalized, route) {
  for (const [intent, pattern] of INTENT_RULES) {
    if (pattern.test(normalized)) return intent;
  }
  if (route.kind === "request") return "request";
  if (route.kind === "question") return "question";
  return "statement";
}

function selectParent(previousTurns) {
  return (
    [...previousTurns]
      .reverse()
      .find(
        (turn) =>
          turn &&
          turn.id &&
          ["question", "request"].includes(String(turn.kind)) &&
          String(turn.text_normalized || turn.text_raw || "").trim()
      ) || null
  );
}

export function analyzeTurn({ text, mode = "study", sourceRole = "manual", previousTurns = [] }) {
  const normalized = normalizeFa(text);
  const route = routePersian(normalized, mode);
  const tokens = tokenize(normalized);
  const quotedTerms = extractQuotedTerms(text);
  const topicTerms = unique([
    ...quotedTerms,
    ...tokens.filter(
      (token) => token.length > 2 && !STOP_WORDS.has(token) && !/^\d+$/u.test(token)
    ),
  ]).slice(0, 10);
  const entities = unique([
    ...quotedTerms,
    ...tokens.filter((token) => /\d/u.test(token) || /[A-Za-z]/u.test(token)),
  ]).slice(0, 10);

  const continuation =
    CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    (tokens.length <= 5 &&
      tokens.some((token) => ["این", "اون", "همین", "همون", "بیشتر", "ادامه"].includes(token)));
  const parent = continuation ? selectParent(previousTurns) : null;
  const contextTurns = previousTurns
    .filter((turn) => turn?.id && String(turn.text_normalized || turn.text_raw || "").trim())
    .slice(-3);
  const contextTurnIds = contextTurns.map((turn) => String(turn.id));
  const retrievalQuery = parent
    ? `${String(parent.text_normalized || parent.text_raw).trim()} ${normalized}`.slice(0, 4_000)
    : normalized.slice(0, 4_000);
  const contextQuery = parent
    ? String(parent.text_normalized || parent.text_raw)
        .trim()
        .slice(0, 2_000)
    : "";
  const ambiguousContinuation = continuation && !parent;
  const intent = inferIntent(normalized, route);
  const requiresRetrieval = route.shouldAnswer && intent !== "runtime";
  const confidence = Math.max(
    0,
    Math.min(
      1,
      route.score +
        (topicTerms.length > 0 ? 0.08 : 0) +
        (parent ? 0.08 : 0) -
        (ambiguousContinuation ? 0.25 : 0)
    )
  );

  return Object.freeze({
    schemaVersion: 1,
    normalized,
    kind: route.kind,
    intent,
    mode,
    sourceRole,
    shouldAnswer: route.shouldAnswer,
    requiresRetrieval,
    confidence: Number(confidence.toFixed(3)),
    ambiguous: ambiguousContinuation,
    continuation,
    parentTurnId: parent ? String(parent.id) : null,
    contextTurnIds,
    topicTerms,
    entities,
    retrievalQuery,
    contextQuery,
    routeReason: route.reason,
    routeScore: route.score,
  });
}
