import { validateCitations } from "./citation-integrity.mjs";

export function runCitationBenchmark(
  cases,
  { minimumPrecision = 1, minimumQuoteCoverage = 1 } = {}
) {
  const results = (cases || []).map((item) => {
    const validation = validateCitations({ citations: item.citations || [] }, item.evidence || []);
    const actualChunkIds = validation.sourceChunkIds;
    const expectedChunkIds = (item.expectedChunkIds || []).map(String);
    return {
      id: String(item.id || ""),
      passed: JSON.stringify(actualChunkIds) === JSON.stringify(expectedChunkIds),
      expectedChunkIds,
      actualChunkIds,
      validatorPrecision: validation.precision,
      quoteCoverage: validation.quoteCoverage,
      invalidCitationCount: validation.invalidCitationCount,
    };
  });
  const truePositive = results.reduce(
    (sum, item) =>
      sum + item.actualChunkIds.filter((id) => item.expectedChunkIds.includes(id)).length,
    0
  );
  const falsePositive = results.reduce(
    (sum, item) =>
      sum + item.actualChunkIds.filter((id) => !item.expectedChunkIds.includes(id)).length,
    0
  );
  const expectedValid = results.reduce((sum, item) => sum + item.expectedChunkIds.length, 0);
  const quotedValid = results.reduce(
    (sum, item) =>
      sum + (item.expectedChunkIds.length ? item.quoteCoverage * item.actualChunkIds.length : 0),
    0
  );
  const precision =
    truePositive + falsePositive
      ? Number((truePositive / (truePositive + falsePositive)).toFixed(4))
      : 1;
  const quoteCoverage = expectedValid ? Number((quotedValid / expectedValid).toFixed(4)) : 1;
  const passedCases = results.filter((item) => item.passed).length;
  return Object.freeze({
    schemaVersion: 1,
    passed:
      passedCases === results.length &&
      precision >= minimumPrecision &&
      quoteCoverage >= minimumQuoteCoverage,
    caseCount: results.length,
    passedCases,
    precision,
    quoteCoverage,
    thresholds: { minimumPrecision, minimumQuoteCoverage },
    results,
  });
}
