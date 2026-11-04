import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, REPO_ROOT, runNodeTool } from "./run_tool";

const TSC = "typescript/bin/tsc";
const AMBIENT = join(FIXTURES, "ambient");

describe("the inner layers see no ambient types (plan §6, A5)", () => {
  it("rejects D1Database, Response and fetch in a use case", () => {
    const run = runNodeTool(TSC, ["-p", join(AMBIENT, "tsconfig.json")], REPO_ROOT);
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("error TS2304: Cannot find name 'D1Database'");
    expect(run.stdout).toContain("error TS2304: Cannot find name 'Response'");
    expect(run.stdout).toContain("error TS2304: Cannot find name 'fetch'");
  });

  it("compiles the same fixture once workers-types is in scope (control)", () => {
    const run = runNodeTool(TSC, ["-p", join(AMBIENT, "tsconfig.control.json")], REPO_ROOT);
    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
  });

  it("compiles the real inner layers under the same settings", () => {
    const run = runNodeTool(TSC, ["-p", join(REPO_ROOT, "tsconfig.inner.json")], REPO_ROOT);
    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
  });

  it("shows why the lint rule exists: tsc accepts a triple-slash bypass", () => {
    const run = runNodeTool(TSC, ["-p", join(FIXTURES, "lint", "tsconfig.json")], REPO_ROOT);
    expect(run.stdout).not.toContain("Cannot find name 'D1Database'");
    expect(run.stdout).not.toContain("Cannot find name 'document'");
  });
});
