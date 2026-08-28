import { timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";

const JSON_HEADERS = Object.freeze({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
});

export class HttpInputError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "HttpInputError";
    this.code = code;
    this.status = status;
  }
}

export function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function createLocalRequestGuard({ host, port, token }) {
  const allowedHosts = new Set([`${host}:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://${host}:${port}`, `http://localhost:${port}`]);
  const expectedToken = Buffer.from(String(token));

  const safeHost = (request) =>
    allowedHosts.has(String(request.headers.get("host") || "").toLowerCase());
  const sameOrigin = (request) => {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.has(origin)) return false;
    return String(request.headers.get("sec-fetch-site") || "").toLowerCase() !== "cross-site";
  };
  const authenticated = (request) => {
    const suppliedToken = Buffer.from(String(request.headers.get("x-auralis-token") || ""));
    return (
      suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken, expectedToken)
    );
  };

  return Object.freeze({
    safeHost,
    sameOrigin,
    authenticated,
    bootstrapAllowed: (request) => safeHost(request) && sameOrigin(request),
    stateChangeAllowed: (request) =>
      safeHost(request) && sameOrigin(request) && authenticated(request),
  });
}

export async function readJsonBody(request, maxBytes = 1_048_576) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpInputError("BODY_TOO_LARGE", 413, `JSON request body exceeds ${maxBytes} bytes`);
  }

  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (contentType && !contentType.startsWith("application/json")) {
    throw new HttpInputError(
      "UNSUPPORTED_MEDIA_TYPE",
      415,
      "Content-Type must be application/json"
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new HttpInputError("BODY_TOO_LARGE", 413, `JSON request body exceeds ${maxBytes} bytes`);
  }
  if (bytes.byteLength === 0) return {};

  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpInputError("INVALID_JSON_OBJECT", 400, "JSON request body must be an object");
    }
    return value;
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    throw new HttpInputError("INVALID_JSON", 400, "Malformed JSON request body");
  }
}

export function resolveStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpInputError("INVALID_PATH_ENCODING", 400, "Malformed URL path encoding");
  }
  if (decoded.includes("\0"))
    throw new HttpInputError("INVALID_PATH", 400, "URL path contains a null byte");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null;
  return candidate;
}
