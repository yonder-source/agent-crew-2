import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../src/config.mjs";

const codingExample = JSON.parse(readFileSync("infra/local-dev/openclaw/openclaw.coding.example.json", "utf8"));
const codingSlack = { coding: { agentId: "coding", channelId: "C0123456789", userIds: ["U0123456789"] } };
assert.deepEqual(parseConfig(codingExample.plugins.entries["agent-crew"].config), {
  environment: "local-coding",
  github: { repository: "owner/repo", pollIntervalMs: 60_000 },
  slack: codingSlack,
  coding: { agentId: "coding", repositoryPath: "/workspaces/repositories/owner/repo" },
});
assert.deepEqual(parseConfig({ environment: " test " }), { environment: "test" });
assert.throws(() => parseConfig({ environment: "test", github: { repository: "Owner/Repo" } }),
  /coding configuration is required/);
assert.deepEqual(parseConfig({ environment: "test", github: { repository: "Owner/Repo" },
  coding: { repositoryPath: "/workspaces/repositories/owner/repo" }, slack: codingSlack }), {
  environment: "test", github: { repository: "owner/repo", pollIntervalMs: 60_000 }, slack: codingSlack,
  coding: { agentId: "coding", repositoryPath: "/workspaces/repositories/owner/repo" },
});
assert.throws(() => parseConfig({ environment: "test", github: { repository: "Owner/Repo" },
  coding: { repositoryPath: "relative/repo" }, slack: codingSlack }), /coding configuration is invalid/);
for (const agentId of ["worker", "coding-team"]) {
  assert.equal(parseConfig({ environment: "test", github: { repository: "owner/repo" },
    coding: { agentId, repositoryPath: "/workspaces/repositories/owner/repo" },
    slack: { coding: { ...codingSlack.coding, agentId } } }).coding.agentId, agentId);
}
assert.throws(() => parseConfig({ environment: "test", github: { repository: "owner/repo" },
  coding: { agentId: "../main", repositoryPath: "/workspaces/repositories/owner/repo" }, slack: codingSlack }), /coding configuration is invalid/);
assert.throws(() => parseConfig({ environment: "test", github: { repository: "invalid" } }), /GitHub configuration is invalid/);
assert.throws(() => parseConfig({}), /requires an environment name/);
assert.throws(() => parseConfig({ environment: " " }), /non-empty environment name/);
assert.throws(
  () => parseConfig({ environment: { value: "test-secret" } }),
  (error) => error instanceof Error && !error.message.includes("test-secret"),
);
// Exercise the native manifest schema as well as the parser.
codingExample.plugins.entries["agent-crew"].config.slack = {
  coding: { agentId: "coding", channelId: "C123", userIds: ["U123"] },
  designer: { agentId: "designer", channelId: "G456", userIds: ["U123"] },
};
const directory = mkdtempSync(join(tmpdir(), "agent-crew-config-"));
try {
  const codingExamplePath = join(directory, "openclaw-coding.json");
  writeFileSync(codingExamplePath, JSON.stringify(codingExample));
  const codingConfigValidation = spawnSync("openclaw", ["config", "validate", "--json"], {
    encoding: "utf8",
    env: { ...process.env, OPENCLAW_CONFIG_PATH: codingExamplePath },
    timeout: 30_000,
  });
  assert.ifError(codingConfigValidation.error);
  assert.equal(codingConfigValidation.status, 0,
    codingConfigValidation.stdout + codingConfigValidation.stderr);
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

for (const tokenBudget of [0, -1, 1.2, "100", Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => parseConfig({environment: "test", github: {repository: "owner/repo"},
    coding: {repositoryPath: "/repo", tokenBudget}, slack: codingSlack}), /coding configuration is invalid/);
}
assert.equal(parseConfig({environment: "test", github: {repository: "owner/repo"},
  coding: {repositoryPath: "/repo", tokenBudget: 100}, slack: codingSlack}).coding.tokenBudget, 100);
assert.equal(parseConfig({ environment: "test", github: { repository: "owner/repo" },
  coding: { repositoryPath: "/repo" } }).slack, undefined,
"A legacy connection without coding Slack must still load so the operator can repair it in setup.");
assert.equal(parseConfig({ environment: "test", github: { repository: "owner/repo" },
  coding: { agentId: "coding", repositoryPath: "/repo" },
  slack: { coding: { ...codingSlack.coding, agentId: "other" } } }).slack.coding.agentId, "other",
"A mismatched Slack agent must load so the operator can repair it in setup.");
