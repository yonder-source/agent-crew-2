import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// OpenClaw 2026.11.3 conflates a cancelled workspace checkpoint with failed
// process termination. Keep artifact failure visible without losing an already
// confirmed sandbox termination. Real termination failures remain uncertain.
const root = process.argv[2] ?? "/app/dist";
const patches = [
  {
    file: "bash-tools.exec-runtime-DOUptw4_.mjs",
    hash: "1ab6aefd72aa776d598ce98acb31bd7d4307a50edf60a4fefffb1cd9c8878107",
    replacements: [
      ['\t\t\tawait sandboxTermination;\n\t\t\tconst [artifacts]', '\t\t\tconst terminationResult = await sandboxTermination;\n\t\t\tif (opts.sandbox && sandboxTermination && !terminationResult) session.processCleanupConfirmed = true;\n\t\t\tconst [artifacts]'],
      ['if (session.finalizationFailed || session.cleanupUncertain) for (const owner', 'if ((session.finalizationFailed && session.processCleanupConfirmed !== true) || session.cleanupUncertain) for (const owner'],
    ],
  },
  {
    file: "bash-process-control-D15pjJye.mjs",
    hash: "e15557d61df215d6da2508c1d36b9504f9569af721e11f535df41ff0e221fb2e",
    replacements: [
      ['session.cancellationRequested === true && session.exitReason === "manual-cancel" && session.finalizationFailed !== true', 'session.cancellationRequested === true && session.exitReason === "manual-cancel" && (session.finalizationFailed !== true || session.processCleanupConfirmed === true)'],
      ['sessions.some((session) => session.finalizationFailed || session.cleanupUncertain)', 'sessions.some((session) => (session.finalizationFailed && session.processCleanupConfirmed !== true) || session.cleanupUncertain)'],
    ],
  },
];
// Validate every target before writing any patch.
const prepared = [];
for (const patch of patches) {
  const target = join(root, patch.file);
  let source = await readFile(target, "utf8");
  if (createHash("sha256").update(source).digest("hex") !== patch.hash) throw new Error("OpenClaw stop source changed; review the pinned stop patch.");
  for (const [before, after] of patch.replacements) {
    if (source.split(before).length !== 2) throw new Error("OpenClaw stop patch anchor does not match.");
    source = source.replace(before, after);
  }
  prepared.push({ target, source });
}
for (const { target, source } of prepared) await writeFile(target, source);
console.log("Applied pinned OpenClaw process-stop confirmation patch.");
