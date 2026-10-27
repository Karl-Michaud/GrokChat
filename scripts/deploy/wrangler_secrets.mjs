// `wrangler secret put` and `wrangler secret list`, with every value sent over stdin and never
// printed. In a dry run nothing is run: each command is printed with its value masked.
import { spawnSync } from "node:child_process";

/**
 * @typedef {{ status: number | null, stdout: string }} RunResult
 * @typedef {(command: string, args: readonly string[], input?: string) => RunResult} Run
 * @typedef {(line: string) => void} Log
 */

/**
 * Runs a command with `input` on stdin (or the terminal's stdin when none), stdout captured and
 * stderr passed through. wrangler prints no secret value on either stream.
 * @type {Run}
 */
export function spawnRun(command, args, input) {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
    stdio: [input === undefined ? "inherit" : "pipe", "pipe", "inherit"],
  });
  return { status: result.status, stdout: result.stdout };
}

/** @param {string} value */
export function masked(value) {
  return `<${String(value.length)} characters, masked>`;
}

export class WranglerSecrets {
  /**
   * @param {{ run: Run, log: Log, dryRun: boolean }} options
   */
  constructor({ run, log, dryRun }) {
    this.run = run;
    this.log = log;
    this.dryRun = dryRun;
  }

  /**
   * The names of the Worker's secrets. A dry run lists nothing and returns `assumed`.
   * @param {readonly string[]} assumed
   * @returns {Set<string>}
   */
  names(assumed) {
    const args = ["wrangler", "secret", "list", "--format", "json"];
    if (this.dryRun) {
      const said = assumed.length === 0 ? "none" : assumed.join(", ");
      this.log(`would run: npx ${args.join(" ")}  (dry run: assumed set: ${said})`);
      return new Set(assumed);
    }
    const result = this.run("npx", args);
    if (result.status !== 0) {
      throw new Error("`wrangler secret list` failed (see its output above)");
    }
    return new Set(secretNames(result.stdout));
  }

  /**
   * @param {string} name
   * @param {string} value
   */
  put(name, value) {
    const args = ["wrangler", "secret", "put", name];
    if (this.dryRun) {
      this.log(`would run: npx ${args.join(" ")}  (stdin: ${masked(value)})`);
      return;
    }
    const result = this.run("npx", args, value);
    if (result.status !== 0) {
      throw new Error(`\`wrangler secret put ${name}\` failed (see its output above)`);
    }
    this.log(`${name} set.`);
  }
}

/**
 * The `name` of every entry of `wrangler secret list --format json`.
 * @param {string} stdout
 * @returns {string[]}
 */
export function secretNames(stdout) {
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error("`wrangler secret list` did not print JSON");
  }
  if (!Array.isArray(json)) {
    throw new Error("`wrangler secret list` did not print a list");
  }
  return json.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof entry.name === "string"
      ? [entry.name]
      : [],
  );
}
