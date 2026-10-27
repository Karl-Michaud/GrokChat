// What the three deploy scripts share as command-line programs: how they start, read options,
// prompt with no echo, and fail (a message on stderr, never a value, and exit code 1).
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** A refusal the user can fix: printed as is. */
export class UsageError extends Error {}

/**
 * True when the module at `url` is the script node was started with.
 * @param {string} url
 */
export function isMain(url) {
  const script = process.argv[1];
  return script !== undefined && url === pathToFileURL(script).href;
}

/**
 * Runs `main`; any error is reported by its message only and exits 1.
 * @param {() => Promise<void>} main
 */
export async function runCli(main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed";
    process.stderr.write(`error: ${message}\n`);
    process.exitCode = 1;
  }
}

/**
 * Strict options: an unknown flag or a stray argument is a UsageError.
 * @template {import("node:util").ParseArgsOptionsConfig} T
 * @param {readonly string[]} argv
 * @param {T} options
 */
export function options(argv, options) {
  try {
    return parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "bad arguments");
  }
}

/**
 * Asks on the terminal and reads one line with no echo. Refuses when stdin is not a terminal,
 * since the answer could then not be hidden.
 * @param {string} question
 * @returns {Promise<string>}
 */
export function promptHidden(question) {
  if (process.stdin.isTTY !== true) {
    return Promise.reject(new UsageError("run this in a terminal: the password is read unechoed"));
  }
  process.stdout.write(question);
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve, reject) => {
    reader.on("SIGINT", () => {
      reader.close();
      process.stdout.write("\n");
      reject(new UsageError("cancelled"));
    });
    reader.question("", (answer) => {
      reader.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
