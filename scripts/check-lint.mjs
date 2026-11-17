import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ESLint } from "eslint";

const eslint = new ESLint();
const root = process.cwd();
const typed = await eslint.calculateConfigForFile("src/index.ts");
for (const rule of ["no-unsafe-type-assertion", "no-floating-promises", "no-misused-promises"]) {
  assert.equal(typed.rules[`@typescript-eslint/${rule}`][0], 2, rule);
}
for (const file of [
  "src/config.mjs", "src/config.d.mts", "eslint.config.mjs",
  "scripts/check-config.mjs", "scripts/check-dispatcher-boundaries.mjs",
  "scripts/check-dispatcher.mjs", "scripts/check-gateway.mjs",
  "scripts/session-roundtrip.mjs", "scripts/check-lint.mjs",
  "infra/local-dev/openclaw/workflows/synthetic-issue.mjs",
  "docs/restart/evidence/lobster-prototype/crew-prototype.mjs",
  ...["js", "cjs", "mjs", "ts", "cts", "mts"].map((ext) => `src/coverage.${ext}`),
]) {
  assert.equal(await eslint.isPathIgnored(file), false, file);
  const config = await eslint.calculateConfigForFile(file);
  assert.equal(config.rules["no-debugger"][0], 2, file);
}

// Real files in the TS project let the CLI exercise the same typed parser as source.
const directory = mkdtempSync(join(root, "src/lint-fixture-"));
try {
  const check = (name, code, rules) => {
    const file = join(directory, name);
    writeFileSync(file, code);
    const result = spawnSync(process.execPath, [
      "node_modules/eslint/bin/eslint.js", "--max-warnings=0", "--format=json", relative(root, file),
    ], { encoding: "utf8", timeout: 60_000 });
    assert.ifError(result.error);
    assert.equal(result.status, rules.length ? 1 : 0, result.stderr || result.stdout);
    const messages = JSON.parse(result.stdout).flatMap((entry) => entry.messages);
    for (const rule of rules) assert.ok(messages.some((message) => message.ruleId === rule), rule);
    assert.ok(messages.every((message) => !message.fatal), result.stdout);
  };
  check("safe.ts", `
    export function read(value: unknown) {
      return typeof value === "string" ? value.toUpperCase() : undefined;
    }
    await Promise.resolve("handled");
    await Promise.all([1].map(async () => await Promise.resolve()));
  `, []);
  check("unsafe.ts", `
    export function read(value: unknown) { return value as string; }
    Promise.resolve("unhandled");
    [1].forEach(async () => { await Promise.resolve(); });
  `, [
    "@typescript-eslint/no-unsafe-type-assertion",
    "@typescript-eslint/no-floating-promises",
    "@typescript-eslint/no-misused-promises",
  ]);
  check("safe.mjs", 'console.log("safe");', []);
  check("unsafe.mjs", "missingGlobal();", ["no-undef"]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Lint configuration and CLI acceptance fixtures passed.");
