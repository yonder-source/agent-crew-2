import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Codex deadlines aborted only the backend signal, bypassing host request
// cancellation and leaving sandbox processes alive after a terminal timeout.
const target = join(process.argv[2] ?? "/app/dist", "run-attempt-8n2nAOHg.mjs");
let source = await readFile(target, "utf8");
if (createHash("sha256").update(source).digest("hex") !== "a5ff9e71e87e03ca8a537766b30f2f133a71b36ab24d38464dad2f23b4e1c527") {
  throw new Error("OpenClaw Codex timeout source changed; review the pinned timeout patch.");
}
const before = "params.onAttemptTimeout?.(error);\n\t\t\trunAbortController.abort(error);";
if (source.split(before).length !== 2) throw new Error("OpenClaw timeout patch anchor does not match.");
source = 'import { n as captureExecRequestCancellation } from "./bash-process-control-D15pjJye.mjs";\n' + source.replace(before, `params.onAttemptTimeout?.(error);
            try {
              const commands = captureExecRequestCancellation({ runId: params.runId });
              commands.cancel();
              void commands.settle().catch(() => log.warn("Timed-out request process cleanup requires inspection", { runId: params.runId }));
            } catch {
              log.warn("Timed-out request process cleanup requires inspection", { runId: params.runId });
            }
            connection.abortExplicitly(error);`);
await writeFile(target, source);
console.log("Applied pinned OpenClaw Codex timeout cancellation patch.");
