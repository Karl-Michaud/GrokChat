import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, REPO_ROOT, runNodeTool } from "./run_tool";

const DEPCRUISE = "dependency-cruiser/bin/dependency-cruiser.mjs";
const CONFIG = join(REPO_ROOT, ".dependency-cruiser.cjs");

interface Violation {
  readonly rule: { readonly name: string };
  readonly from: string;
  readonly to: string;
}

function cruise(cwd: string): readonly Violation[] {
  const run = runNodeTool(DEPCRUISE, ["src", "--config", CONFIG, "--output-type", "json"], cwd);
  const parsed = JSON.parse(run.stdout) as { summary: { violations: Violation[] } };
  return parsed.summary.violations;
}

describe("dependency-cruiser on src/", () => {
  it("finds no violation in the product code", () => {
    expect(cruise(REPO_ROOT)).toStrictEqual([]);
  });
});

describe("dependency-cruiser rules each fire on the layers fixture", () => {
  let violations: readonly Violation[];
  beforeAll(() => {
    violations = cruise(join(FIXTURES, "layers"));
  });
  const fired = (rule: string, from: string): boolean =>
    violations.some((v) => v.rule.name === rule && v.from === from);

  it.each([
    ["entities-import-only-entities", "src/entities/imports_use_case.ts"],
    ["use-cases-point-inward", "src/use_cases/interactor.ts"],
    ["ports-import-only-entities", "src/use_cases/ports/post_reader.ts"],
    ["interface-adapters-point-inward", "src/interface_adapters/presenter.ts"],
    ["nothing-imports-main", "src/frameworks/route.ts"],
    ["vendors-only-in-frameworks", "src/interface_adapters/uses_hono.ts"],
    ["vendors-only-in-frameworks", "src/use_cases/uses_cloudflare.ts"],
    ["zod-only-at-boundaries", "src/use_cases/uses_zod.ts"],
    ["inner-layers-no-npm-packages", "src/interface_adapters/uses_hono.ts"],
    ["twitter-text-only-in-entities", "src/use_cases/uses_twitter_text.ts"],
    ["inner-layers-no-runtime-builtins", "src/entities/uses_node.ts"],
    ["no-grab-bag-modules", "src/use_cases/helpers.ts"],
    ["no-imports-of-grab-bag-modules", "src/main.ts"],
    ["no-circular", "src/frameworks/cycle_a.ts"],
    ["no-unresolvable", "src/frameworks/missing_import.ts"],
    ["no-orphans", "src/frameworks/orphan.ts"],
  ])("%s fires on %s", (rule, from) => {
    expect(fired(rule, from)).toBe(true);
  });

  it.each([
    ["src/interface_adapters/schemas/post_schema.ts", "zod in interface_adapters/schemas"],
    ["src/entities/uses_twitter_text.ts", "twitter-text in entities"],
  ])("allows %s (%s)", (from) => {
    expect(violations.filter((v) => v.from === from)).toStrictEqual([]);
  });

  it("flags the grab-bag folder frameworks/utils/ too", () => {
    expect(
      violations.some(
        (v) =>
          v.rule.name === "no-imports-of-grab-bag-modules" &&
          v.to === "src/frameworks/utils/format.ts",
      ),
    ).toBe(true);
  });
});
