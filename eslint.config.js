// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

/** The inner layers, in src/ and in the architecture fixtures that mirror them. */
const INNER_LAYERS = [
  "**/src/entities/**/*.ts",
  "**/src/use_cases/**/*.ts",
  "**/src/interface_adapters/**/*.ts",
];

export default defineConfig(
  {
    ignores: [
      "node_modules/",
      "coverage/",
      "reports/",
      ".stryker-tmp/",
      ".wrangler/",
      "docs/spikes/",
      "docs/archive/",
      // Deliberate violations; tests/architecture lints them on purpose with `ignore: false`.
      "tests/architecture/fixtures/",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.json",
          "./tsconfig.node.json",
          "./tests/architecture/fixtures/*/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Tests group many cases in one describe callback; the 40-line limit is for product code.
    files: ["tests/**/*.ts"],
    ignores: ["tests/architecture/fixtures/**"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // A triple-slash directive would pull ambient types back past `"types": []` (plan §6, A5).
    files: INNER_LAYERS,
    rules: {
      "@typescript-eslint/triple-slash-reference": [
        "error",
        { types: "never", path: "never", lib: "never" },
      ],
    },
  },
  {
    // Entities hold no mutable module state (plan §3: immutable and pure).
    files: ["**/src/entities/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program > VariableDeclaration[kind!='const']",
          message: "Entities hold no mutable module state: use const.",
        },
        {
          selector: "ExportNamedDeclaration > VariableDeclaration[kind!='const']",
          message: "Entities hold no mutable module state: use const.",
        },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        module: "readonly",
        require: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },
);
