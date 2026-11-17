import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { ESLint } from "eslint";

const eslint = new ESLint();
const root = process.cwd();
async function verifyCoverage(sourceRoot, lintRoot = root) {
  const expectedFiles = [];
  const directories = [""];
  for (const directory of directories) {
    for (const entry of readdirSync(join(sourceRoot, directory), { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !["dist", ".git", ".openclaw"].includes(file)) directories.push(file);
      } else if (/\.(?:[cm]?[jt]s)$/.test(entry.name) && statSync(join(sourceRoot, file)).isFile()) {
        expectedFiles.push(file);
      }
    }
  }
  const checker = new ESLint({ cwd: lintRoot, overrideConfigFile: join(root, "eslint.config.mjs") });
  const results = await checker.lintFiles(["."]);
  const lintedFiles = results.map((result) => relative(lintRoot, result.filePath)).sort();
  assert.deepEqual(lintedFiles, expectedFiles.sort(), "Lint inputs differ from source checkout (missing, ignored or extra files)");
  assert.equal(results.reduce((count, result) => count + result.errorCount + result.warningCount, 0), 0,
    "Source lint must pass before configuration fixtures");
}
await verifyCoverage(process.env.LINT_SOURCE_ROOT ?? root);

const coverage = mkdtempSync(join(tmpdir(), "lint-coverage-"));
try {
  const source = join(coverage, "source");
  const copied = join(coverage, "copied");
  const files = ["new-root.mjs", "new-tools/task.cjs", ".github/scripts/check.js"];
  for (const directory of [source, copied]) {
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), 'console.log("covered");');
    }
  }
  await verifyCoverage(source, copied);
  for (const file of files) {
    rmSync(join(copied, file));
    await assert.rejects(verifyCoverage(source, copied), /Lint inputs differ/);
    writeFileSync(join(copied, file), 'console.log("covered");');
  }
  writeFileSync(join(copied, "new-root.mjs"), "missingGlobal();");
  await assert.rejects(verifyCoverage(source, copied), /Source lint must pass/);
} finally {
  rmSync(coverage, { recursive: true, force: true });
}
const typed = await eslint.calculateConfigForFile("src/index.ts");
for (const rule of ["no-unsafe-type-assertion", "no-floating-promises", "no-misused-promises"]) {
  assert.equal(typed.rules[`@typescript-eslint/${rule}`][0], 2, rule);
}
for (const file of [
  "src/config.mjs", "src/config.d.mts", "eslint.config.mjs",
  "scripts/check-config.mjs", "scripts/check-dispatcher-boundaries.mjs",
  "scripts/check-dispatcher.mjs", "scripts/check-gateway.mjs",
  "scripts/session-roundtrip.mjs", "scripts/check-lint.mjs",
  "scripts/check-deployment.mjs",
  "infra/local-dev/openclaw/workflows/synthetic-issue.mjs",
  "docs/restart/evidence/lobster-prototype/crew-prototype.mjs",
]) {
  assert.ok(statSync(file).isFile(), `Missing required lint input: ${file}`);
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
    assert.equal(result.status, rules.length ? 1 : 0, `${result.stderr || result.stdout}\nFixture: ${code}`);
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
  const rejectedImports = [
    'import { exec as run } from "node:child_process"; console.log(run);',
    'import * as processTools from "child_process"; console.log(processTools);',
    'import vm from "node:vm"; console.log(vm);',
    'import { getBuiltinModule } from "node:process"; console.log(getBuiltinModule);',
    'import process from "process"; console.log(process);',
    'import { createRequire } from "node:module"; console.log(createRequire);',
    'export { exec } from "node:child_process";',
    'export * from "openclaw/dist/internal.js";',
    'import sdk from "openclaw/plugin-sdk/private"; console.log(sdk);',
    'import "../docs/restart/evidence/lobster-prototype/crew-prototype.mjs";',
    'export * from "../scripts/check-config.mjs";',
  ];
  for (const code of rejectedImports) check("restriction.mjs", code, ["no-restricted-imports"]);
  for (const code of [
    'const { exec: run } = require("child_process"); run("echo unsafe");',
    'await import("node:child_process");',
    'const name = "node:vm"; await import(name);',
    'console.log({ shell: true });',
    'const options = { shell: process.env.SHELL }; console.log(options);',
    'const options = {}; options.shell = true;',
    'const options = {}; options["shell"] = true;',
    'const load = process.getBuiltinModule; console.log(load);',
    'const load = process["getBuiltinModule"]; console.log(load);',
    'process.getBuiltinModule("child_process");',
    'process["getBuiltinModule"]("child_process");',
    'const { getBuiltinModule } = process; getBuiltinModule("child_process");',
    'const { getBuiltinModule: load } = process; load("child_process");',
    'const { getBuiltinModule: load } = process; const { execSync } = load("child_process"); execSync("echo unsafe");',
    'const processApi = process; const { getBuiltinModule: load } = processApi; const { execSync } = load("child_process"); execSync("echo unsafe");',
    'const load = process.getBuiltinModule; const { execSync } = load("child_process"); execSync("echo unsafe");',
  ]) check("restriction.mjs", code, ["no-restricted-syntax"]);
  check("restriction.mjs", 'eval("console.log(1)");', ["no-eval"]);
  check("restriction.mjs", 'setTimeout("console.log(1)", 1);', ["no-implied-eval"]);
  check("restriction.mjs", 'console.log(new Function("return 1"));', ["no-new-func"]);
  check("restriction.mjs", `
    import { createHash } from "node:crypto";
    import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
    export { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
    console.log(createHash, callGatewayFromCli);
  `, []);
  // Lint text at real exception paths to prove the rule is narrowed, not disabled.
  for (const [file, safe, unsafe, expectedRule] of [
    ...[
      ["scripts/check-lint.mjs", "spawnSync"],
      ["scripts/check-config.mjs", "spawnSync"],
      ["scripts/check-gateway.mjs", "spawnSync"],
      ["scripts/session-roundtrip.mjs", "spawnSync"],
      ["scripts/check-dispatcher.mjs", "execFile"],
    ].map(([file, name]) => [file,
      `import { ${name} } from "node:child_process"; console.log(${name});`,
      'import { exec as run } from "node:child_process"; console.log(run);', "no-restricted-imports"]),
    ["scripts/check-config.mjs", 'import { spawnSync } from "node:child_process"; spawnSync("openclaw", [], {});',
      'import { spawnSync } from "node:child_process"; const options = {}; options.shell = true; spawnSync(process.env.COMMAND, [], options);', "no-restricted-syntax"],
    ["scripts/check-config.mjs", 'console.log(process.version);',
      'import { getBuiltinModule } from "node:process"; const { execSync } = getBuiltinModule("node:child_process"); execSync("echo unsafe");', "no-restricted-imports"],
    ["scripts/check-config.mjs", 'console.log(process.version);',
      'const { getBuiltinModule: load } = process; const { execSync } = load("child_process"); execSync("echo unsafe");', "no-restricted-syntax"],
    ["scripts/check-dispatcher-boundaries.mjs", 'import { createContext, runInContext } from "node:vm"; console.log(createContext, runInContext);',
      'import vm from "node:vm"; console.log(vm);', "no-restricted-imports"],
  ]) {
    const accepted = await eslint.lintText(safe, { filePath: file });
    assert.equal(accepted[0].errorCount, 0, JSON.stringify(accepted[0].messages));
    const rejected = await eslint.lintText(unsafe, { filePath: file });
    assert.ok(expectedRule, `Missing expected rule for ${file}: ${unsafe}`);
    assert.ok(rejected[0].messages.some((message) => message.ruleId === expectedRule),
      `${file}: expected ${expectedRule}; got ${JSON.stringify(rejected[0].messages)}`);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Lint configuration and CLI acceptance fixtures passed.");
