export function normalizeFa(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\u200c/g, " ")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const interrogatives = new Set([
  "چرا",
  "چی",
  "چه",
  "کجا",
  "کی",
  "چند",
  "چقدر",
  "آیا",
  "کدام",
  "چطور",
  "چگونه",
  "چجوری",
  "چیه",
  "چیست",
  "کدوم",
  "مگه",
  "میشه",
  "می‌شود",
  "می‌شه",
  "میتونی",
  "می‌توانی",
]);

const requestPatterns = [
  "توضیح بده",
  "دوباره بگو",
  "شرح بده",
  "تعریف کن",
  "مقایسه کن",
  "فرق",
  "بگو",
  "بررسی کن",
  "تحلیل کن",
  "حل کن",
  "مثال بزن",
  "نشون بده",
  "نشان بده",
  "روشن کن",
];

const explicitQuestionPatterns = [
  /(?:چیست|چیه|یعنی چی|یعنی چه|درسته|درست است)\s*[؟?]?$/u,
  /(?:چه فرقی|چه تفاوتی|فرق .* چیه|تفاوت .* چیست)/u,
];

export function routePersian(text, mode = "study") {
  const normalized = normalizeFa(text);
  const tokens = normalized
    .replace(/[؟?!.،,:؛؛]/g, " ")
    .split(/\s+/u)
    .filter(Boolean);

  const hasQuestionMark = /[؟?]/u.test(normalized);
  const hasInterrogative = tokens.some((token) => interrogatives.has(token));
  const hasRequest = requestPatterns.some((pattern) => normalized.includes(pattern));
  const hasQuestionForm = explicitQuestionPatterns.some((re) => re.test(normalized));

  // Study/oral/discussion use the same conservative gate in this preview:
  // statements are persisted, but only explicit questions/requests are answerable.
  const shouldAnswer = Boolean(
    hasQuestionMark || hasInterrogative || hasRequest || hasQuestionForm
  );
  const kind = shouldAnswer
    ? hasRequest && !hasQuestionMark
      ? "request"
      : "question"
    : "statement";
  const reason = hasQuestionMark
    ? "question-mark"
    : hasInterrogative
      ? "interrogative"
      : hasRequest
        ? "request-pattern"
        : hasQuestionForm
          ? "question-form"
          : "statement";

  const featureCount = [hasQuestionMark, hasInterrogative, hasRequest, hasQuestionForm].filter(
    Boolean
  ).length;
  const score = shouldAnswer ? Math.min(1, 0.55 + featureCount * 0.12) : 0.08;

  return { normalized, shouldAnswer, kind, reason, score, mode };
}
