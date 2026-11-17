import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Native validators establish schema validity; these assertions pin local intent.
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const compose = read(process.argv[2]);
const config = read("openclaw.json");
const pkg = read("package.json");
const dockerfile = readFileSync("Dockerfile", "utf8");
function requireSetting(condition, message) {
  assert.ok(condition, message);
}
function validate(model, settings, metadata = pkg) {
  const gateway = model.services.gateway;
  assert.ok(gateway.ports?.length, "Gateway must publish its local port");
  for (const service of Object.values(model.services)) {
    assert.ok(!service.privileged, "Local services must not be privileged");
    assert.notEqual(service.network_mode, "host", "Host networking bypasses loopback publication");
    for (const port of service.ports ?? []) {
      assert.equal(port.host_ip, "127.0.0.1", "Published ports must bind IPv4 loopback");
    }
  }
  assert.ok(gateway.ports.some((port) => port.target === 18789 && String(port.published) === "18789"),
    "Gateway must publish the expected port");
  assert.ok(gateway.volumes.some((volume) => volume.type === "volume"
    && volume.source === "openclaw-data" && volume.target === "/home/node/.openclaw"),
  "Gateway state must use its named volume");
  const source = model.services.checks.volumes.find((volume) => volume.target === "/lint-source");
  assert.ok(source?.read_only && source.type === "bind", "Lint source must be a read-only bind mount");
  assert.equal(gateway.environment.OPENCLAW_CONFIG_PATH, "/app/extensions/agent-crew/openclaw.json");
  assert.equal(settings.gateway.mode, "local");
  assert.equal(settings.gateway.auth.mode, "token", "Gateway must require token authentication");
  requireSetting(settings.gateway.auth.token === "${OPENCLAW_GATEWAY_TOKEN}",
    "Gateway token must reference OPENCLAW_GATEWAY_TOKEN");
  assert.deepEqual(settings.plugins.allow, ["agent-crew", "lobster"], "Plugin allowlist changed");
  assert.deepEqual(settings.plugins.load.paths, [
    "/app/extensions/agent-crew", "/opt/agent-crew-lobster/node_modules/@openclaw/lobster",
  ], "Plugin paths changed");
  assert.deepEqual(Object.keys(settings.plugins.entries).sort(), ["agent-crew", "lobster"]);
  for (const plugin of Object.values(settings.plugins.entries)) assert.equal(plugin.enabled, true);
  assert.deepEqual(settings.tools, { alsoAllow: ["lobster"] }, "Intended tool settings changed");
  const version = metadata.peerDependencies.openclaw;
  assert.equal(metadata.openclaw.compat.pluginApi, version, "Plugin API version mismatch");
  assert.equal(metadata.openclaw.build.openclawVersion, version, "Plugin build version mismatch");
  assert.ok(dockerfile.includes(`FROM ghcr.io/openclaw/openclaw:${version}@sha256:`), "Base SDK version mismatch");
  assert.ok(dockerfile.includes(`@openclaw/lobster@${version}`), "Lobster version mismatch");
  assert.ok(dockerfile.includes(`npm pack openclaw@${version} `), "SDK declaration version mismatch");
  assert.equal(gateway.image, `agent-crew-openclaw:${version}`);
  assert.equal(model.services.checks.image, `agent-crew-openclaw-checks:${version}`);
}
validate(compose, config);
for (const [mutate, expected] of [
  [(model) => { delete model.services.gateway.ports[0].host_ip; }, /loopback/],
  [(model) => { model.services.gateway.ports[0].host_ip = "0.0.0.0"; }, /loopback/],
  [(model) => { model.services.checks.ports = [{ host_ip: "::", target: 9999 }]; }, /loopback/],
  [(model) => { model.services.gateway.network_mode = "host"; }, /Host networking/],
  [(model) => { model.services.gateway.privileged = true; }, /privileged/],
  [(model) => { model.services.gateway.volumes = []; }, /named volume/],
  [(model) => { model.services.checks.volumes[0].read_only = false; }, /read-only/],
  [(model) => { model.services.gateway.image = "agent-crew-openclaw:latest"; }, /image|equal/i],
]) {
  const model = structuredClone(compose);
  mutate(model);
  assert.throws(() => validate(model, config), expected);
}
for (const [mutate, expected] of [
  [(settings) => { settings.gateway.auth.mode = "none"; }, /authentication/],
  [(settings) => { settings.plugins.allow.push("unreviewed"); }, /allowlist/],
  [(settings) => { settings.plugins.load.paths.push("/tmp/unreviewed"); }, /paths/],
  [(settings) => { settings.plugins.entries.lobster.enabled = false; }, /equal/i],
  [(settings) => { settings.tools.alsoAllow.push("exec"); }, /tool settings/],
]) {
  const settings = structuredClone(config);
  mutate(settings);
  assert.throws(() => validate(compose, settings), expected);
}
for (const mutate of [
  (metadata) => { metadata.openclaw.compat.pluginApi = "invalid"; },
  (metadata) => { metadata.openclaw.build.openclawVersion = "invalid"; },
  (metadata) => { metadata.peerDependencies.openclaw = "invalid"; },
]) {
  const metadata = structuredClone(pkg);
  mutate(metadata);
  assert.throws(() => validate(compose, config, metadata), /version mismatch/);
}
const tokenCanary = "synthetic-secret-canary";
const tokenSettings = structuredClone(config);
tokenSettings.gateway.auth.token = tokenCanary;
assert.throws(() => validate(compose, tokenSettings), (error) => {
  assert.match(error.message, /Gateway token must reference OPENCLAW_GATEWAY_TOKEN/);
  assert.ok(!error.message.includes(tokenCanary), "Token canary leaked into validation output");
  return true;
});
console.log("Resolved local deployment settings and mutation fixtures passed.");
