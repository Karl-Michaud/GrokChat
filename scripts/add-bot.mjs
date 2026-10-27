// `npm run add-bot -- --id <bot> --accounts <id,id> [--dry-run]` (docs/runbook.md): a new bearer
// token for the bot (32 random bytes), its SHA-256 added to the bot client list (or in place of
// the bot's old entry), and the list set as GROKCHAT_BOT_CLIENTS over `wrangler secret put`'s
// stdin, in the format src/interface_adapters/schemas/bot_clients_schema.ts parses. The list is
// kept in the gitignored --clients-file (ids, token hashes and account ids only); the token itself
// is written only to the gitignored --tokens-file (mode 600), for the owner to copy into the bot.
import { isMain, options, runCli, UsageError } from "./deploy/cli.mjs";
import {
  checkBotClients,
  parseAccounts,
  validBotId,
  withBotClient,
  withTokenLine,
} from "./deploy/bot_clients.mjs";
import { LocalFiles } from "./deploy/local_files.mjs";
import { newBotToken, sha256Hex } from "./deploy/secret_values.mjs";
import { spawnRun, WranglerSecrets } from "./deploy/wrangler_secrets.mjs";

export const NAME = "GROKCHAT_BOT_CLIENTS";

/**
 * @typedef {{
 *   id: string,
 *   accounts: string,
 *   clientsFile: string,
 *   tokensFile: string,
 *   newList: boolean,
 * }} Flags
 * @typedef {{
 *   secrets: Pick<WranglerSecrets, "names" | "put">,
 *   files: Pick<LocalFiles, "read" | "writePrivate">,
 *   log: (line: string) => void,
 * }} Deps
 */

/**
 * The current list from the local file. Without the file, a list already set on the Worker would
 * be overwritten by this bot alone, so that needs --new-list.
 * @param {Flags} flags
 * @param {Deps} deps
 */
function currentClients(flags, { secrets, files }) {
  const text = files.read(flags.clientsFile);
  if (text !== null) {
    try {
      return checkBotClients(JSON.parse(text));
    } catch {
      throw new UsageError(`${flags.clientsFile} is not a bot client list`);
    }
  }
  if (!flags.newList && secrets.names([]).has(NAME)) {
    throw new UsageError(
      `${NAME} is set but ${flags.clientsFile} is missing: a new list would drop every other ` +
        "bot. Restore the file, or pass --new-list to keep only this bot.",
    );
  }
  return [];
}

/**
 * @param {Flags} flags
 * @param {Deps} deps
 */
export async function addBot(flags, deps) {
  if (!validBotId(flags.id)) {
    throw new UsageError("--id is 1 to 128 of A-Z, a-z, 0-9, '_', '.', '-'");
  }
  let accounts;
  try {
    accounts = parseAccounts(flags.accounts);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "bad --accounts");
  }
  const clients = currentClients(flags, deps);
  const token = newBotToken();
  const next = withBotClient(clients, {
    id: flags.id,
    tokenSha256: await sha256Hex(token),
    accounts,
  });
  const tokens = deps.files.read(flags.tokensFile) ?? "";
  deps.files.writePrivate(flags.tokensFile, withTokenLine(tokens, flags.id, token));
  deps.files.writePrivate(flags.clientsFile, `${JSON.stringify(next, null, 2)}\n`);
  deps.secrets.put(NAME, JSON.stringify(next));
  deps.log(
    `Bot ${flags.id} may post for ${accounts.join(", ")}. Its token is the "${flags.id}=" line of ` +
      `${flags.tokensFile}: put it in the bot's MCP authorization, test it with get_policy, then ` +
      "delete the line.",
  );
}

const OPTIONS = /** @type {const} */ ({
  id: { type: "string" },
  accounts: { type: "string" },
  "clients-file": { type: "string", default: ".bot-clients.local.json" },
  "tokens-file": { type: "string", default: ".bot-tokens.local" },
  "new-list": { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
});

if (isMain(import.meta.url)) {
  await runCli(async () => {
    const flags = options(process.argv.slice(2), OPTIONS);
    if (flags.id === undefined || flags.accounts === undefined) {
      throw new UsageError("usage: npm run add-bot -- --id <bot> --accounts <id,id> [--dry-run]");
    }
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
      id: flags.id,
      accounts: flags.accounts,
      clientsFile: flags["clients-file"],
      tokensFile: flags["tokens-file"],
      newList: flags["new-list"],
    };
    await addBot(parsed, deps);
  });
}
