// `npm run provision-secrets -- --env-file <path> [--rotate | --drop-old-token-keys] [--dry-run]`
// (docs/runbook.md). Sets, over `wrangler secret put`'s stdin and never printed:
//   GROKCHAT_TOKEN_KEYS      a new AES-256 key (src/frameworks/crypto/token_vault.ts), kept in the
//                            gitignored --token-keys-file (mode 600) so it can be rotated later;
//   GROKCHAT_SESSION_SECRET  32 random bytes, base64url;
//   X_CLIENT_ID, X_CLIENT_SECRET  read from --env-file (dotenv lines).
// Each is set only when the Worker does not have it yet. --rotate sets them all again; for the
// token keys it puts a new key in front of the current ones (read from --token-keys-file), so
// stored X tokens still open. --drop-old-token-keys later keeps only the newest key.
import { parseEnv } from "node:util";
import { isMain, options, runCli, UsageError } from "./deploy/cli.mjs";
import { LocalFiles } from "./deploy/local_files.mjs";
import {
  newestTokenKeyOnly,
  newSessionSecret,
  newTokenKey,
  rotatedTokenKeys,
} from "./deploy/secret_values.mjs";
import { spawnRun, WranglerSecrets } from "./deploy/wrangler_secrets.mjs";

export const TOKEN_KEYS = "GROKCHAT_TOKEN_KEYS";
export const SESSION_SECRET = "GROKCHAT_SESSION_SECRET";
export const X_CREDENTIALS = ["X_CLIENT_ID", "X_CLIENT_SECRET"];
const ALL = [TOKEN_KEYS, SESSION_SECRET, ...X_CREDENTIALS];

/**
 * @typedef {{
 *   rotate: boolean,
 *   dropOldTokenKeys: boolean,
 *   replaceTokenKeys: boolean,
 *   envFile: string | undefined,
 *   tokenKeysFile: string,
 * }} Flags
 * @typedef {{
 *   secrets: Pick<WranglerSecrets, "names" | "put">,
 *   files: Pick<LocalFiles, "read" | "writePrivate">,
 *   log: (line: string) => void,
 * }} Deps
 */

/**
 * The X app's credentials still to set, read from the env file. Errors name keys, never values.
 * @param {Flags} flags
 * @param {Set<string>} set
 * @param {Deps["files"]} files
 * @returns {[string, string][]}
 */
export function xCredentials(flags, set, files) {
  const wanted = X_CREDENTIALS.filter((name) => flags.rotate || !set.has(name));
  if (wanted.length === 0) {
    return [];
  }
  if (flags.envFile === undefined) {
    throw new UsageError(`${wanted.join(" and ")} not set: pass --env-file <path> that holds them`);
  }
  const text = files.read(flags.envFile);
  if (text === null) {
    throw new UsageError(`--env-file ${flags.envFile} does not exist`);
  }
  const values = parseEnv(text);
  return wanted.map((name) => {
    const value = values[name]?.trim() ?? "";
    if (value === "") {
      throw new UsageError(`--env-file ${flags.envFile} has no ${name}`);
    }
    return [name, value];
  });
}

/**
 * The new GROKCHAT_TOKEN_KEYS value, or null when it stays as it is.
 * @param {Flags} flags
 * @param {Set<string>} set
 * @param {Deps["files"]} files
 * @returns {string | null}
 */
export function tokenKeysValue(flags, set, files) {
  if (!set.has(TOKEN_KEYS)) {
    return newTokenKey();
  }
  if (!flags.rotate && !flags.dropOldTokenKeys) {
    return null;
  }
  const current = files.read(flags.tokenKeysFile);
  if (current !== null) {
    const keys = current.trim();
    return flags.dropOldTokenKeys ? newestTokenKeyOnly(keys) : rotatedTokenKeys(keys);
  }
  if (!flags.replaceTokenKeys) {
    throw new UsageError(
      `${TOKEN_KEYS} is set but ${flags.tokenKeysFile} is missing: new keys without the current ` +
        "ones would leave every stored X token unreadable. Restore the file, or pass " +
        "--replace-token-keys and reconnect every account afterwards.",
    );
  }
  return newTokenKey();
}

/**
 * @param {Flags} flags
 * @param {Deps} deps
 */
export function provisionSecrets(flags, { secrets, files, log }) {
  if (flags.rotate && flags.dropOldTokenKeys) {
    throw new UsageError("pass --rotate or --drop-old-token-keys, not both");
  }
  const set = secrets.names(flags.rotate || flags.dropOldTokenKeys ? ALL : []);
  const credentials = xCredentials(flags, set, files);
  const keys = tokenKeysValue(flags, set, files);
  if (keys === null) {
    log(`${TOKEN_KEYS} already set; kept.`);
  } else {
    files.writePrivate(flags.tokenKeysFile, `${keys}\n`);
    secrets.put(TOKEN_KEYS, keys);
  }
  if (flags.rotate || !set.has(SESSION_SECRET)) {
    secrets.put(SESSION_SECRET, newSessionSecret());
  } else {
    log(`${SESSION_SECRET} already set; kept.`);
  }
  for (const [name, value] of credentials) {
    secrets.put(name, value);
  }
}

const OPTIONS = /** @type {const} */ ({
  "env-file": { type: "string" },
  "token-keys-file": { type: "string", default: ".token-keys.local" },
  rotate: { type: "boolean", default: false },
  "drop-old-token-keys": { type: "boolean", default: false },
  "replace-token-keys": { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
});

if (isMain(import.meta.url)) {
  await runCli(() => {
    const flags = options(process.argv.slice(2), OPTIONS);
    /** @param {string} line */
    const log = (line) => {
      console.log(line);
    };
    const dryRun = flags["dry-run"];
    const deps = {
      secrets: new WranglerSecrets({ run: spawnRun, log, dryRun }),
      files: new LocalFiles({ log, dryRun }),
      log,
    };
    const parsed = {
      rotate: flags.rotate,
      dropOldTokenKeys: flags["drop-old-token-keys"],
      replaceTokenKeys: flags["replace-token-keys"],
      envFile: flags["env-file"],
      tokenKeysFile: flags["token-keys-file"],
    };
    provisionSecrets(parsed, deps);
    return Promise.resolve();
  });
}
