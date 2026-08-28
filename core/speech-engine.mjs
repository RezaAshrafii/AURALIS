import { createHash } from "node:crypto";

export const TranscriptState = Object.freeze({
  PARTIAL: "PARTIAL",
  STABLE: "STABLE",
  FINAL: "FINAL",
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function normalizeTranscriptText(value) {
  return String(value ?? "")
    .replace(/\u200c+/g, "\u200c")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export function validateTranscriptEvent(input) {
  const state = String(input?.state || "").toUpperCase();
  if (!Object.values(TranscriptState).includes(state)) {
    throw new TypeError(`invalid transcript state: ${state || "<empty>"}`);
  }
  const segmentId = String(input?.segmentId || input?.segment_id || "").trim();
  if (!segmentId) throw new TypeError("segmentId is required");
  const text = normalizeTranscriptText(input?.text);
  if (!text && state !== TranscriptState.FINAL) {
    throw new TypeError(`${state} transcript must contain text`);
  }
  return {
    segmentId,
    state,
    text,
    provider: String(input?.provider || "unknown").trim() || "unknown",
    model: String(input?.model || "unknown").trim() || "unknown",
    language: String(input?.language || "fa-IR").trim() || "fa-IR",
    confidence: Number.isFinite(Number(input?.confidence)) ? Number(input.confidence) : null,
  };
}

/**
 * Maintains a monotonic transcript revision stream for one immutable segment.
 * A stable/final revision is never allowed to regress to a shorter unrelated
 * prefix. This prevents provider jitter from rewriting already surfaced text.
 */
export class TranscriptRevisionAccumulator {
  #segmentId;
  #revision = 0;
  #stableText = "";
  #finalText = "";

  constructor(segmentId) {
    this.#segmentId = String(segmentId || "").trim();
    if (!this.#segmentId) throw new TypeError("segmentId is required");
  }

  get revision() {
    return this.#revision;
  }
  get stableText() {
    return this.#stableText;
  }
  get finalText() {
    return this.#finalText;
  }

  accept(input) {
    const event = validateTranscriptEvent({ ...input, segmentId: this.#segmentId });
    if (this.#finalText) return { accepted: false, reason: "ALREADY_FINAL", event: null };

    if (event.state === TranscriptState.STABLE || event.state === TranscriptState.FINAL) {
      if (this.#stableText && !compatibleStablePrefix(this.#stableText, event.text)) {
        return { accepted: false, reason: "STABLE_PREFIX_REGRESSION", event: null };
      }
      if (event.text) this.#stableText = event.text;
    }

    if (event.state === TranscriptState.FINAL) this.#finalText = event.text;
    this.#revision += 1;
    return { accepted: true, reason: "ACCEPTED", event: { ...event, revision: this.#revision } };
  }
}

function compatibleStablePrefix(previous, next) {
  const a = normalizeTranscriptText(previous);
  const b = normalizeTranscriptText(next);
  if (!a) return true;
  if (!b) return false;
  if (a === b || b.startsWith(a)) return true;
  // ASR providers may normalize punctuation or ZWNJ between stable updates.
  const squash = (value) => value.replace(/[\s\u200c،,؛;:.!?؟]+/g, "");
  const sa = squash(a),
    sb = squash(b);
  return sb.startsWith(sa);
}

export function transcriptFingerprint({ segmentId, state, text, provider, model }) {
  return createHash("sha256")
    .update([segmentId, state, normalizeTranscriptText(text), provider, model].join("|"))
    .digest("hex");
}

export function normalizeLoopbackBaseUrl(value) {
  const raw = String(value || "http://127.0.0.1:8080").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("local ASR URL is invalid");
  }
  if (url.protocol !== "http:") throw new TypeError("local ASR must use http on loopback");
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) throw new TypeError("local ASR URL must resolve to loopback");
  url.username = "";
  url.password = "";
  url.hash = "";
  url.search = "";
  const cleanPath = url.pathname.replace(/\/+$/, "") || "/";
  if (cleanPath !== "/" && cleanPath !== "/inference") {
    throw new TypeError("local ASR URL must be a loopback origin (optional /inference accepted)");
  }
  url.pathname = "/";
  return url.toString().replace(/\/$/, "");
}

export function shouldFallbackToLocal(error) {
  const code = String(error?.error || error?.code || "").toUpperCase();
  return new Set([
    "AUTH_REQUIRED",
    "RATE_LIMITED",
    "ASR_NETWORK_ERROR",
    "ASR_PROVIDER_ERROR",
    "ASR_INTERNAL_ERROR",
    "ASR_CONFIG_INVALID",
  ]).has(code);
}

export function extractWhisperCppText(payload) {
  if (typeof payload === "string") return normalizeTranscriptText(payload);
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "string") return normalizeTranscriptText(payload.text);
  if (typeof payload.transcription === "string")
    return normalizeTranscriptText(payload.transcription);
  if (Array.isArray(payload.transcription)) {
    return normalizeTranscriptText(
      payload.transcription.map((item) => item?.text || item?.content || "").join(" ")
    );
  }
  if (Array.isArray(payload.segments)) {
    return normalizeTranscriptText(payload.segments.map((item) => item?.text || "").join(" "));
  }
  return "";
}
