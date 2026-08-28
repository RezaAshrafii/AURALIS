import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(ROOT, "apps", "web", "public");
const out = join(ROOT, "dist", "web");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(source, out, { recursive: true });
const version = (await readFile(join(ROOT, "VERSION"), "utf8")).trim();
const metadata = { version, source: "apps/web/public" };
if (process.env.SOURCE_DATE_EPOCH) {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new TypeError("SOURCE_DATE_EPOCH must be a non-negative integer");
  metadata.builtAt = new Date(epoch * 1000).toISOString();
}
await writeFile(join(out, "build.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(`web build staged: ${out}`);
