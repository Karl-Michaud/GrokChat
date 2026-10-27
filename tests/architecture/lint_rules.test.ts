import { join } from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, REPO_ROOT } from "./run_tool";

const LINT = join(FIXTURES, "lint");

type Findings = ReadonlyMap<string, readonly string[]>;

/** Lints the lint fixture with the repo's own config and returns the rule ids per file. */
async function lintFixture(): Promise<Findings> {
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    ignore: false,
    overrideConfig: {
      languageOptions: { parserOptions: { project: [join(LINT, "tsconfig.json")] } },
    },
  });
  const results = await eslint.lintFiles([join(LINT, "src")]);
  return new Map(
    results.map((r) => [
      r.filePath.slice(LINT.length + 1),
      r.messages.map((m) => m.ruleId ?? `fatal: ${m.message}`),
    ]),
  );
}

describe("ESLint gates (plan §5, §6)", () => {
  let findings: Findings;
  beforeAll(async () => {
    findings = await lintFixture();
  });

  it.each([
    ["src/use_cases/reference_types.ts"],
    ["src/entities/reference_path.ts"],
    ["src/interface_adapters/reference_lib.ts"],
  ])("bans triple-slash references in the inner layers: %s", (file) => {
    expect(findings.get(file)).toContain("@typescript-eslint/triple-slash-reference");
  });

  it("bans mutable module state in entities (both the exported and the private let)", () => {
    const rules = findings.get("src/entities/mutable_state.ts") ?? [];
    expect(rules.filter((r) => r === "no-restricted-syntax")).toHaveLength(2);
  });

  it("caps functions at 40 lines", () => {
    expect(findings.get("src/frameworks/long_function.ts")).toContain("max-lines-per-function");
  });

  it("parses every fixture with type information (no fatal parse errors)", () => {
    const fatal = [...findings.values()].flat().filter((r) => r.startsWith("fatal"));
    expect(fatal).toStrictEqual([]);
  });
});
