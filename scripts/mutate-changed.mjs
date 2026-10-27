// `npm run mutate:changed`: Stryker on the files of its mutate set (the pure layers) that differ
// from origin/staging, committed or not. The full `npm run mutation` stays the gate in
// `npm run check`; this is the fast loop while working (owner, 2026-10-27).
import { execFileSync, spawnSync } from "node:child_process";

const BASE = process.env.MUTATE_BASE ?? "origin/staging";
const MUTATED = /^src\/(entities|use_cases|interface_adapters)\/.*(?<!\.d)\.ts$/;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);

const changed = new Set([
  ...git("diff", "--name-only", "--diff-filter=d", `${BASE}...HEAD`),
  ...git("diff", "--name-only", "--diff-filter=d", "HEAD"),
  ...git("ls-files", "--others", "--exclude-standard"),
]);
const files = [...changed].filter((file) => MUTATED.test(file)).sort();

if (files.length === 0) {
  console.log(`mutate:changed: no file of Stryker's mutate set differs from ${BASE}.`);
  process.exit(0);
}
console.log(
  `mutate:changed: ${String(files.length)} file(s) against ${BASE}:\n  ${files.join("\n  ")}`,
);
const result = spawnSync("npx", ["stryker", "run", "--mutate", files.join(",")], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
