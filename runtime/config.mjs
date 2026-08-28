import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_PORT = 47832;
const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < MIN_UNPRIVILEGED_PORT || port > MAX_PORT) {
    throw new TypeError(
      `AURALIS_PORT must be an integer between ${MIN_UNPRIVILEGED_PORT} and ${MAX_PORT}`
    );
  }
  return port;
}

function providerUrlForEnvironment(env) {
  const productionUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  if (env.NODE_ENV !== "test" || !env.AURALIS_TEST_PROVIDER_URL) return productionUrl;
  const candidate = new URL(env.AURALIS_TEST_PROVIDER_URL);
  if (
    candidate.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(candidate.hostname)
  ) {
    throw new TypeError("AURALIS_TEST_PROVIDER_URL must be an HTTP loopback URL");
  }
  return candidate.toString();
}

export async function loadRuntimeConfig(root, env = process.env) {
  const version = (await readFile(join(root, 'VERSION'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new TypeError("VERSION must contain a valid semantic version");
  }

  const host = "127.0.0.1";
  const port = parsePort(env.AURALIS_PORT);
  const sourceApp = join(root, "apps", "web", "public");
  const data = join(root, "data");

  return Object.freeze({
    root,
    version,
    host,
    port,
    origin: `http://${host}:${port}`,
    sourceApp,
    app:
      env.AURALIS_USE_WEB_BUILD === "1" || env.AURALIS_USE_VITE_BUILD === "1"
        ? join(root, "dist", "web")
        : sourceApp,
    data,
    audioRoot: join(data, "audio"),
    databasePath: join(data, "auralis-ledger.sqlite"),
    legacyDatabasePath: join(data, "auralis-v0106-ledger.sqlite"),
    legacyNativeProbe: join(root, "native", "auralis-capture-probe.exe"),
    experimentalProductCapture: env.AURALIS_EXPERIMENTAL_V013_CAPTURE === '1',
    providerUrl: providerUrlForEnvironment(env),
  });
}
