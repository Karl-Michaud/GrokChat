// The scripts' gitignored local files (.bot-clients.local.json, .bot-tokens.local,
// .token-keys.local): written owner-only (mode 600), and never in a dry run.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * @typedef {(line: string) => void} Log
 */

export class LocalFiles {
  /**
   * @param {{ log: Log, dryRun: boolean }} options
   */
  constructor({ log, dryRun }) {
    this.log = log;
    this.dryRun = dryRun;
  }

  /**
   * The file's text, or null when it does not exist.
   * @param {string} path
   * @returns {string | null}
   */
  read(path) {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  /**
   * Writes the file readable by its owner only. Never logs the text.
   * @param {string} path
   * @param {string} text
   */
  writePrivate(path, text) {
    if (this.dryRun) {
      this.log(`would write ${path} (mode 600)`);
      return;
    }
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
