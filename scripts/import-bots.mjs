// `npm run import-bots -- [--file .bot-clients.local.json] [--dry-run]` (docs/runbook.md, GROKCHAT-16):
// the one-off move of the old GROKCHAT_BOT_CLIENTS list into the people of the REMOTE D1, so the
// live bot tokens keep working with no reissue. It reads the gitignored list (ids, token hashes
// and account ids; never a token), and runs `wrangler d1 execute grokchat --remote` on the
// statements of deploy/import_sql.mjs. It is idempotent and prints no token or hash; --dry-run
// prints what it would run and runs nothing.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBotClients } from "./deploy/bot_clients.mjs";
import { isMain, options, runCli, UsageError } from "./deploy/cli.mjs";
import { importStatements, personNameOf } from "./deploy/import_sql.mjs";
import { LocalFiles } from "./deploy/local_files.mjs";
import { spawnRun } from "./deploy/wrangler_secrets.mjs";

export const DATABASE = "grokchat";

/**
 * @typedef {{ file: string, dryRun: boolean, now: number }} Flags
 * @typedef {{
 *   files: Pick<LocalFiles, "read">,
 *   run: import("./deploy/wrangler_secrets.mjs").Run,
 *   writeSql: (text: string) => string,
 *   log: (line: string) => void,
 * }} Deps
 */

/**
 * @param {Flags} flags
 * @param {Pick<Deps, "files">} deps
 */
function clientsOf(flags, { files }) {
  const text = files.read(flags.file);
  if (text === null) {
    throw new UsageError(`${flags.file} is missing: copy it from the machine that ran add-bot`);
  }
  try {
    return checkBotClients(JSON.parse(text));
  } catch (error) {
    const why = error instanceof SyntaxError ? "is not JSON" : "is not a bot client list";
    throw new UsageError(`${flags.file} ${why}`);
  }
}

/**
 * @param {Flags} flags
 * @param {Deps} deps
 */
export function importBots(flags, deps) {
  const clients = clientsOf(flags, deps);
  const statements = importStatements(clients, flags.now);
  const people = clients.map((client) => `${personNameOf(client.id)} (${client.id})`).join(", ");
  const accounts = clients.reduce((sum, client) => sum + client.accounts.length, 0);
  const args = ["wrangler", "d1", "execute", DATABASE, "--remote", "--yes", "--file"];
  if (flags.dryRun) {
    deps.log(
      `would run: npx ${args.join(" ")} <${String(statements.length)} statements>  (dry run)`,
    );
    deps.log(`people: ${people || "none"}; account assignments: ${String(accounts)}`);
    return;
  }
  const file = deps.writeSql(`${statements.join("\n")}\n`);
  const result = deps.run("npx", [...args, file]);
  if (result.status !== 0) {
    throw new Error(
      "`wrangler d1 execute` failed (see its output above); nothing is half-done: run it again",
    );
  }
  deps.log(
    `Imported ${people || "nobody"} with ${String(accounts)} account assignment(s), where not ` +
      "already set. Each bot keeps its token. Check the Accounts page, then delete " +
      "GROKCHAT_BOT_CLIENTS (docs/runbook.md).",
  );
}

/** @param {string} text */
function writeSql(text) {
  const file = join(mkdtempSync(join(tmpdir(), "grokchat-import-")), "import.sql");
  writeFileSync(file, text, { mode: 0o600 });
  return file;
}

const OPTIONS = /** @type {const} */ ({
  file: { type: "string", default: ".bot-clients.local.json" },
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
    importBots(
      { file: flags.file, dryRun, now: Date.now() },
      { files: new LocalFiles({ log, dryRun }), run: spawnRun, writeSql, log },
    );
    return Promise.resolve();
  });
}
