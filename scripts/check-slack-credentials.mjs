import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SLACK_SECRET_PATHS, slackCredentialStatus } from "../dist/slack-credentials.js";

const canary = "secret-canary-never-return";
const fixtures = new Map([
  [SLACK_SECRET_PATHS.botToken, `xoxb-${canary}\n`],
  [SLACK_SECRET_PATHS.appToken, `xapp-${canary}\n`],
]);
const read = async (path) => {
  const value = fixtures.get(path);
  if (value instanceof Error) throw value;
  if (value === undefined) throw Object.assign(new Error(canary), { code: "ENOENT" });
  return value;
};
assert.deepEqual(await slackCredentialStatus(read), { botToken: "available", appToken: "available" });
fixtures.set(SLACK_SECRET_PATHS.botToken, `xapp-${canary}`);
fixtures.set(SLACK_SECRET_PATHS.appToken, "  \n");
assert.deepEqual(await slackCredentialStatus(read), { botToken: "invalid", appToken: "invalid" });
fixtures.delete(SLACK_SECRET_PATHS.botToken);
fixtures.set(SLACK_SECRET_PATHS.appToken, Object.assign(new Error(canary), { code: "EACCES" }));
const failures = await slackCredentialStatus(read);
assert.deepEqual(failures, { botToken: "missing", appToken: "unavailable" });
assert.ok(!JSON.stringify(failures).includes(canary));
fixtures.set(SLACK_SECRET_PATHS.botToken, `xoxb-${canary}`);
fixtures.set(SLACK_SECRET_PATHS.appToken, `xapp-${canary}`);
assert.deepEqual(await slackCredentialStatus(read), { botToken: "available", appToken: "available" },
  "A later check must recover after the mounted credentials become readable");
if (process.argv[2]) {
  const model = JSON.parse(readFileSync(process.argv[2] === "--stdin" ? 0 : process.argv[2], "utf8"));
  for (const [source, path, filename] of [
    ["slack_bot_token", SLACK_SECRET_PATHS.botToken, "slack-bot-token"],
    ["slack_app_token", SLACK_SECRET_PATHS.appToken, "slack-app-token"],
  ]) {
    const secret = model.services.gateway.secrets.find((entry) => entry.source === source);
    assert.equal(`/run/secrets/${secret?.target}`, path);
    assert.ok(model.secrets[source].file.endsWith(`/.local/secrets/${filename}`));
    for (const [name, service] of Object.entries(model.services)) {
      if (name !== "gateway") assert.ok(!service.secrets?.some((entry) => entry.source === source),
        "Slack credentials must be mounted only on the Gateway");
    }
  }
}
console.log("Slack credential readiness and redaction fixtures passed.");
