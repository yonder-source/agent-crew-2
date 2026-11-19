import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../src/config.mjs";

assert.deepEqual(parseConfig({ environment: " test " }), { environment: "test" });
assert.throws(() => parseConfig({ environment: "test", github: { repository: "Owner/Repo" } }),
  /coding configuration is required/);
assert.deepEqual(parseConfig({ environment: "test", github: { repository: "Owner/Repo" },
  coding: { repositoryPath: "/workspaces/repositories/owner/repo" } }), {
  environment: "test", github: { repository: "owner/repo", pollIntervalMs: 60_000 },
  coding: { agentId: "coding", repositoryPath: "/workspaces/repositories/owner/repo" },
});
assert.throws(() => parseConfig({ environment: "test", github: { repository: "Owner/Repo" },
  coding: { repositoryPath: "relative/repo" } }), /coding configuration is invalid/);
for (const agentId of ["worker", "coding-team"]) {
  assert.equal(parseConfig({ environment: "test", github: { repository: "owner/repo" },
    coding: { agentId, repositoryPath: "/workspaces/repositories/owner/repo" } }).coding.agentId, agentId);
}
assert.throws(() => parseConfig({ environment: "test", github: { repository: "owner/repo" },
  coding: { agentId: "../main", repositoryPath: "/workspaces/repositories/owner/repo" } }), /coding configuration is invalid/);
assert.throws(() => parseConfig({ environment: "test", github: { repository: "invalid" } }), /GitHub configuration is invalid/);
assert.throws(() => parseConfig({}), /requires an environment name/);
assert.throws(() => parseConfig({ environment: " " }), /non-empty environment name/);
assert.throws(
  () => parseConfig({ environment: { value: "test-secret" } }),
  (error) => error instanceof Error && !error.message.includes("test-secret"),
);
const directory = mkdtempSync(join(tmpdir(), "agent-crew-config-"));
try {
  for (const config of [{}, { environment: { value: "test-secret" } }]) {
    const fixture = JSON.parse(readFileSync(new URL("../openclaw.json", import.meta.url), "utf8"));
    fixture.plugins.entries["agent-crew"].config = config;
    const path = join(directory, "openclaw.json");
    writeFileSync(path, JSON.stringify(fixture));
    const result = spawnSync("openclaw", ["config", "validate", "--json"], {
      encoding: "utf8",
      env: { ...process.env, OPENCLAW_CONFIG_PATH: path },
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, "Native config validation must reject invalid plugin settings.");
    const output = result.stdout + result.stderr;
    assert.match(output, /environment/);
    assert.ok(!output.includes("test-secret"), "Native config validation leaked a secret value.");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Configuration validation checks passed.");
