import { appendFile, access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

// Disposable fixture only: count real executions and let the test interrupt one.
const root = "/home/node/.openclaw/agent-crew-synthetic";
await appendFile(`${root}.starts`, "start\n");
for (;;) {
  try { await access(`${root}.hold`); }
  catch (error) { if (error.code === "ENOENT") break; throw error; }
  await setTimeout(100);
}
process.stdout.write(JSON.stringify({ synthetic: true, status: "completed" }));
