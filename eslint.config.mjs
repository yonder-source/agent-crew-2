import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["**/*.{js,cjs,mjs,ts,cts,mts}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
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
