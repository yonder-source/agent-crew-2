import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const inspect = spawnSync("openclaw", ["plugins", "inspect", "agent-crew", "--runtime", "--json"], { encoding: "utf8" });
assert.equal(inspect.status, 0, inspect.stderr || "Agent Crew plugin is not loaded.");
assert.match(inspect.stdout, /agent_crew_status/);

const tool = spawnSync("openclaw", ["gateway", "call", "tools.invoke", "--params", JSON.stringify({ name: "agent_crew_status", args: {} }), "--json"], { encoding: "utf8" });
assert.equal(tool.status, 0, tool.stderr || "Status capability invocation failed.");
const response = JSON.parse(tool.stdout);
assert.equal(response.ok, true, JSON.stringify(response));
assert.equal(response.output?.details?.status, "ready");
assert.equal(response.output?.details?.environment, "disposable");
console.log("Gateway status capability check passed.");
