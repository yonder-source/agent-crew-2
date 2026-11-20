import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const processLoaders = ["process", "node:process"];
const restrictedModules = ["child_process", "node:child_process", ...processLoaders, "vm", "node:vm"];
const privateSdk = {
  regex: "^openclaw(?:/|$)(?!plugin-sdk/(?:gateway-runtime|plugin-entry)$)",
  message: "Use the reviewed public Gateway/plugin-entry SDK entry points.",
};
const moduleLoaders = ["module", "node:module"].map((name) => ({
  name, importNames: ["createRequire", "default", "*"], message: "Use static ESM imports for dependency checks.",
}));
const restrictImports = (paths) => ["error", { paths: [...paths, ...moduleLoaders], patterns: [privateSdk] }];
const syntaxRestrictions = [
  {
    selector: "ImportExpression",
    message: "Use static imports so API and dependency boundaries remain reviewable.",
  },
  {
    selector: "CallExpression[callee.name='require'], MemberExpression[property.name='require'], MemberExpression[property.value='require'][computed=true], MemberExpression[property.name='getBuiltinModule'], MemberExpression[property.value='getBuiltinModule'][computed=true]",
    message: "Use static ESM imports; require aliases bypass import restrictions.",
  },
  {
    selector: "Property[key.name='getBuiltinModule'], Property[key.value='getBuiltinModule'][computed=true]",
    message: "Do not extract process loaders; use static ESM imports so dependency boundaries remain reviewable.",
  },
  {
    selector: "Property[key.name='shell'], Property[key.value='shell'], AssignmentExpression[left.property.name='shell'], AssignmentExpression[left.property.value='shell'][left.computed=true]",
    message: "Use a fixed executable and argument array without a shell option.",
  },
];

export default defineConfig([
  { ignores: ["dist/**", "node_modules/**", ".local/**"] },
  {
    files: ["**/*.{js,cjs,mjs,ts,cts,mts}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-imports": restrictImports(restrictedModules),
      "no-restricted-syntax": ["error", ...syntaxRestrictions],
    },
  },
  // These native test helpers need fixed CLI invocations, never exec/shell APIs.
  ...[
    ["scripts/check-lint.mjs", "spawnSync"],
    ["scripts/check-config.mjs", "spawnSync"],
    ["scripts/check-setup-draft.mjs", "spawnSync"],
    ["scripts/check-gateway.mjs", "spawnSync"],
    ["scripts/session-roundtrip.mjs", "spawnSync"],
    ["scripts/check-dispatcher.mjs", "execFile"],
    ["scripts/check-repository-connection.mjs", "spawnSync"],
    ["scripts/check-coding-workflow.mjs", "spawnSync"],
  ].map(([file, allowed]) => ({
    files: [file],
    rules: {
      "no-restricted-imports": restrictImports([
        ...processLoaders, "vm", "node:vm",
        ...["child_process", "node:child_process"].map((name) => ({
          name, allowImportNames: [allowed], message: `Only ${allowed} is approved for this fixture.`,
        })),
      ]),
    },
  })),
  {
    files: ["ui/**/*.js"],
    languageOptions: { globals: globals.browser },
  },
  {
    // The mock boundary harness runs compiled dispatcher code in a VM.
    files: ["scripts/check-dispatcher-boundaries.mjs", "scripts/check-coding-boundaries.mjs"],
    rules: {
      "no-restricted-imports": restrictImports([
        ...processLoaders, "child_process", "node:child_process",
        ...["vm", "node:vm"].map((name) => ({
          name, allowImportNames: ["createContext", "runInContext"],
          message: "Only the compiled dispatcher VM harness operations are approved.",
        })),
      ]),
    },
  },
  {
    files: ["src/**/*.{js,cjs,mjs,ts,cts,mts}", "infra/local-dev/openclaw/workflows/**/*.mjs"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [...restrictedModules, ...moduleLoaders],
        patterns: [privateSdk, {
          regex: "(^|/)(docs|test|tests|scripts)(/|$)",
          message: "Production code must not import tests, scripts or historical evidence.",
        }],
      }],
    },
  },
  {
    // Repository cloning invokes Git with fixed argument arrays and no shell option.
    files: ["src/repository-clone.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          ...processLoaders, "vm", "node:vm", ...moduleLoaders,
          ...["child_process", "node:child_process"].map((name) => ({
            name, allowImportNames: ["execFile"], message: "Only execFile is approved for repository Git operations.",
          })),
        ],
        patterns: [privateSdk, {
          regex: "(^|/)(docs|test|tests|scripts)(/|$)",
          message: "Production code must not import tests, scripts or historical evidence.",
        }],
      }],
    },
  },
  {
    files: ["**/*.{ts,cts,mts}"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The recommended typed preset permits narrowing assertions at input boundaries.
      "@typescript-eslint/no-unsafe-type-assertion": "error",
    },
  },
]);
