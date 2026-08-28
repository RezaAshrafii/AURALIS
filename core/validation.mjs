import { generateId } from "./domain-models.mjs";

export class ValidationError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const ENTITY_STATES = {
  workspace: ["ACTIVE", "ARCHIVED"],
  project: ["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"],
  person: ["ACTIVE", "ARCHIVED"],
  conversation: ["DRAFT", "STARTING", "LIVE", "PROCESSING", "READY", "FAILED", "ARCHIVED"],
  task: ["SUGGESTED", "TODO", "IN_PROGRESS", "DONE", "CANCELLED"],
  sourceDocument: ["ACTIVE", "SUPERSEDED", "DELETED"],
  memoryItem: ["CANDIDATE", "CONFIRMED", "REJECTED", "ARCHIVED", "SUPERSEDED", "DELETED"],
  memorySettings: [0, 1],
};

export const TASK_TRANSITIONS = {
  SUGGESTED: ["TODO", "CANCELLED"],
  TODO: ["IN_PROGRESS", "DONE", "CANCELLED"],
  IN_PROGRESS: ["TODO", "DONE", "CANCELLED"],
  DONE: ["TODO", "CANCELLED"],
  CANCELLED: [], // terminal - requires explicit restore
};

export const MEMORY_ITEM_TRANSITIONS = {
  CANDIDATE: ["CONFIRMED", "REJECTED", "ARCHIVED"],
  CONFIRMED: ["SUPERSEDED", "ARCHIVED"],
  REJECTED: ["ARCHIVED"],
  ARCHIVED: ["CONFIRMED", "REJECTED"],
  SUPERSEDED: [],
  DELETED: [],
};

export function assertWorkspaceExists(db, workspaceId) {
  const ws = db.query("SELECT id FROM workspaces WHERE id = ?").get(workspaceId);
  if (!ws) throw new ValidationError("WORKSPACE_NOT_FOUND", "Workspace not found", 404);
  return ws;
}

export function assertSameWorkspace(db, workspaceId, table, idColumn, entityId) {
  const row = db.query(`SELECT workspace_id FROM ${table} WHERE ${idColumn} = ?`).get(entityId);
  if (!row)
    throw new ValidationError(`${table.toUpperCase()}_NOT_FOUND`, `${table} not found`, 404);
  if (row.workspace_id !== workspaceId) {
    throw new ValidationError(
      "CROSS_WORKSPACE_REFERENCE",
      `${table} belongs to a different workspace`,
      422
    );
  }
  return row;
}

export function assertEntityExists(db, table, idColumn, entityId) {
  const row = db.query(`SELECT 1 FROM ${table} WHERE ${idColumn} = ?`).get(entityId);
  if (!row)
    throw new ValidationError(`${table.toUpperCase()}_NOT_FOUND`, `${table} not found`, 404);
  return row;
}

export function assertValidEnum(value, allowedValues, fieldName) {
  if (!allowedValues.includes(value)) {
    throw new ValidationError(
      "INVALID_ENUM",
      `Invalid ${fieldName}: ${value}. Allowed: ${allowedValues.join(", ")}`,
      400
    );
  }
}

export function assertRevision(currentRevision, expectedRevision, entityName = "Entity") {
  if (expectedRevision !== null && currentRevision !== expectedRevision) {
    const err = new ValidationError(
      "CONCURRENCY_CONFLICT",
      `${entityName} was modified by another request`,
      409
    );
    err.status = 409;
    throw err;
  }
}

export function parsePagination(params, { maxLimit = 100, defaultLimit = 50 } = {}) {
  const limit = Number(params.limit);
  const cursor = Number(params.cursor);
  const offset = Number(params.offset);

  const safeLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.max(Math.floor(limit), 1), maxLimit)
      : defaultLimit;

  const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? Math.floor(cursor) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;

  return { limit: safeLimit, cursor: safeCursor, offset: safeOffset };
}

export function assertPositiveInteger(value, fieldName) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 1 || !Number.isInteger(num)) {
    throw new ValidationError("INVALID_NUMBER", `${fieldName} must be a positive integer`, 400);
  }
  return num;
}

export function assertDateTime(value, fieldName) {
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new ValidationError(
      "INVALID_DATETIME",
      `${fieldName} must be a valid ISO 8601 datetime`,
      400
    );
  }
  return date.toISOString();
}

export function resolveConversationId(db, sessionId) {
  const conv = db.query("SELECT id FROM conversations WHERE capture_session_id = ?").get(sessionId);
  if (conv) return conv.id;
  // Fallback for conversations created without capture session
  return `conv-${sessionId}`;
}

export function resolveSessionId(db, conversationId) {
  const conv = db
    .query("SELECT capture_session_id FROM conversations WHERE id = ?")
    .get(conversationId);
  if (conv?.capture_session_id) return conv.capture_session_id;
  // Fallback for conversations created without capture session
  return conversationId.replace(/^conv-/, "");
}

export function getProfileTimezone(db, profileId = "default-profile") {
  const profile = db.query("SELECT timezone FROM local_profiles WHERE id = ?").get(profileId);
  return profile?.timezone || "Asia/Tehran";
}

export function computeDeadlineInTimezone(text, timezone) {
  // This is a simplified version - the actual logic is in domain-models.mjs
  // This helper ensures timezone-aware deadline computation
  return { timezone };
}

export function sanitizeForAudit(obj) {
  if (!obj) return null;
  const sanitized = { ...obj };
  // Remove raw content fields that contain user data
  const redactedKeys = [
    "content",
    "content_text",
    "content_json",
    "exact_quote",
    "quote",
    "text_raw",
    "text_normalized",
  ];
  for (const key of redactedKeys) {
    if (sanitized[key] !== undefined) delete sanitized[key];
  }
  // Sanitize evidence array
  if (Array.isArray(sanitized.evidence)) {
    sanitized.evidence = sanitized.evidence.map((e) => {
      const { exact_quote, quote, ...rest } = e;
      return {
        ...rest,
        exact_quote_hash: e.exact_quote ? sha(e.exact_quote) : null,
      };
    });
  }
  // Sanitize revisions array
  if (Array.isArray(sanitized.revisions)) {
    sanitized.revisions = sanitized.revisions.map((r) => {
      const { content, contentJson, evidence, ...rest } = r;
      return {
        ...rest,
        content_hash: content ? sha(content) : null,
        content_json_hash: contentJson ? sha(contentJson) : null,
        evidence_count: Array.isArray(evidence) ? evidence.length : 0,
      };
    });
  }
  return sanitized;
}

// Import sha from crypto
import { createHash } from "node:crypto";

function sha(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
