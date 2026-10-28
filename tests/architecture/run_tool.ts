import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FIXTURES = join(REPO_ROOT, "tests", "architecture", "fixtures");

export interface ToolRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Room for a tool's whole report: dependency-cruiser's JSON over src/ passed spawnSync's 1 MB
 * default once the graph grew past 400 modules (GROKCHAT-15), and a cut-off report is not JSON.
 */
const MAX_OUTPUT = 64 * 1024 * 1024;

/** Runs a tool's Node entry point from node_modules, without a shell. */
export function runNodeTool(entry: string, args: readonly string[], cwd: string): ToolRun {
  const result = spawnSync(process.execPath, [join(REPO_ROOT, "node_modules", entry), ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
