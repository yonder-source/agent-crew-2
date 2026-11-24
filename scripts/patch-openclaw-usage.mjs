import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// OpenClaw 2026.11.3 silently ignores an attempt without usage. Preserve unknown
// across attempts/compaction instead of exposing a partial total as available.
const target = join(process.argv[2] ?? "/app/dist", "usage-accumulator-Cd3yWsMu.mjs");
const source = await readFile(target, "utf8");
if (createHash("sha256").update(source).digest("hex") !== "5fe718c8a7c3e5c1eafc5348ecd0d6b2b7fc3d5cf398c30d7c02db6c319a0885") {
  throw new Error("OpenClaw usage source changed; review the pinned accounting patch.");
}
const before = '\tif (usage?.usageReport?.state === "unavailable") {\n\t\ttarget.usageReport = usage.usageReport;';
const after = '\tif (!hasBillableUsage(usage) || ["input", "output", "cacheRead", "cacheWrite", "total"].every(key => usage?.[key] === void 0) || (usage?.usageReport?.state !== "available" && !["input", "output", "cacheRead", "cacheWrite", "total"].some(key => usage?.[key] > 0)) || usage?.usageReport?.state === "unavailable") {\n\t\ttarget.usageReport = { state: "unavailable" };';
if (source.split(before).length !== 2) throw new Error("OpenClaw usage patch anchor does not match.");
await writeFile(target, source.replace(before, after).replace('\tif (!hasBillableUsage(usage)) return;\n', ""));
console.log("Applied pinned OpenClaw missing-attempt usage patch.");
