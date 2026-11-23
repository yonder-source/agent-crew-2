import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// OpenClaw 2026.11.3: sidecar model publication can supersede agent admission.
// Reuse its bounded startup retry instead of retaining a false database refusal.
const target = join(process.argv[2] ?? "/app/dist", "gateway-prewarm.js");
const source = await readFile(target, "utf8");
const expected = "ddeec104374d9a81ab9cb1874945e74008bde65eddfad90f216c9c1540b3ea31";
if (createHash("sha256").update(source).digest("hex") !== expected) {
  throw new Error("OpenClaw startup source changed; review the pinned startup patch.");
}
const start = "\t\t\tawait withPluginRuntimeRegistryScope(params.getPluginRegistry(), () => refreshPreparedModelRuntimeSnapshots(cfg, {";
const end = "\n\t\t\tpreparedInput = listConfiguredOwnerInputs(cfg, void 0, true)";
if (source.split(start).length !== 2 || source.split(end).length !== 2) {
  throw new Error("OpenClaw startup patch anchors do not match.");
}
const from = source.indexOf(start);
const to = source.indexOf(end, from);
const patched = 'import { r as PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.errors-DCd9wajc.mjs";\n'
  + source.slice(0, from)
  + "\t\t\ttry {\n"
  + source.slice(from, to).split("\n").map((line) => `\t${line}`).join("\n")
  + "\n\t\t\t} catch (error) {\n"
  + '\t\t\t\tif (error instanceof PreparedModelRuntimePublicationSupersededError) throw new AgentDatabaseStartupSupersededError(agentId, "models");\n'
  + "\t\t\t\tthrow error;\n\t\t\t}"
  + source.slice(to);
await writeFile(target, patched);
console.log("Applied pinned OpenClaw startup publication retry patch.");
