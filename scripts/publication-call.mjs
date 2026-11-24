import { spawnSync } from "node:child_process";

const [sessionKey, agentId] = process.argv.slice(2);
if (!/^agent:[a-z][a-z0-9_-]*:agent-crew-[a-f0-9]{32}$/.test(sessionKey ?? "") ||
    !/^[a-z][a-z0-9_-]*$/.test(agentId ?? "")) {
  process.stderr.write("Publication workflow binding is invalid.\n");
  process.exit(1);
}

const executable = process.env.LOBSTER_OPENCLAW_BIN ?? "openclaw";
const result = spawnSync(executable, [
  "gateway", "call", "agent-crew.publication.accept",
  "--params", JSON.stringify({ sessionKey, agentId }),
  "--json",
], { encoding: "utf8", env: process.env, timeout: 100_000, maxBuffer: 1_000_000 });

if (result.error) {
  process.stderr.write("Publication Gateway invocation failed.\n");
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || "Publication Gateway invocation was rejected.\n");
  process.exit(result.status ?? 1);
}

try {
  const parsed = JSON.parse(result.stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
      typeof parsed.status !== "string") {
    throw new Error("invalid publication result");
  }
  process.stdout.write(JSON.stringify(parsed));
} catch {
  process.stderr.write("Publication Gateway returned an invalid result.\n");
  process.exit(1);
}
