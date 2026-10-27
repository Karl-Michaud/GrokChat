// The GROKCHAT_BOT_CLIENTS list (src/interface_adapters/schemas/bot_clients_schema.ts): JSON
// `[{ id, tokenSha256, accounts }]`, never a token. The scripts keep it in a local file so a new
// bot can be added without reading the secret back (Cloudflare never returns a secret's value).

/** Ids the scripts accept: also safe as a line key in the local token file. */
const BOT_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const HASH = /^[0-9a-f]{64}$/;

/**
 * @typedef {{ id: string, tokenSha256: string, accounts: string[] }} BotClient
 */

/** @param {string} id */
export function validBotId(id) {
  return BOT_ID.test(id);
}

/**
 * The account ids of `--accounts a,b`: at least one, each 1 to 128 characters, no repeats.
 * @param {string} list
 * @returns {string[]}
 */
export function parseAccounts(list) {
  const accounts = list
    .split(",")
    .map((account) => account.trim())
    .filter((account) => account.length > 0);
  if (accounts.length === 0 || accounts.some((account) => account.length > 128)) {
    throw new Error("--accounts takes one or more account ids, comma-separated");
  }
  return [...new Set(accounts)];
}

/**
 * @param {unknown} item
 * @returns {item is BotClient}
 */
function isClient(item) {
  if (typeof item !== "object" || item === null) {
    return false;
  }
  const { id, tokenSha256, accounts, ...rest } = /** @type {Record<string, unknown>} */ (item);
  return (
    Object.keys(rest).length === 0 &&
    typeof id === "string" &&
    validBotId(id) &&
    typeof tokenSha256 === "string" &&
    HASH.test(tokenSha256) &&
    Array.isArray(accounts) &&
    accounts.every((a) => typeof a === "string" && a.length > 0 && a.length <= 128)
  );
}

/**
 * The local list, checked as strictly as the Worker checks the secret: an extra field (a token
 * pasted in by hand, say) refuses the whole file. The error never quotes the file.
 * @param {unknown} json
 * @returns {BotClient[]}
 */
export function checkBotClients(json) {
  if (!Array.isArray(json) || !json.every(isClient)) {
    throw new Error("the bot client list is not [{ id, tokenSha256, accounts }]");
  }
  const ids = new Set(json.map((client) => client.id));
  const hashes = new Set(json.map((client) => client.tokenSha256));
  if (ids.size !== json.length || hashes.size !== json.length) {
    throw new Error("the bot client list names one id or one token hash twice");
  }
  return json;
}

/**
 * The list with `client` added, or in place of the entry with its id (a new token for that bot).
 * @param {readonly BotClient[]} clients
 * @param {BotClient} client
 * @returns {BotClient[]}
 */
export function withBotClient(clients, client) {
  const index = clients.findIndex((existing) => existing.id === client.id);
  if (index === -1) {
    return [...clients, client];
  }
  return clients.map((existing, at) => (at === index ? client : existing));
}

/**
 * The local token file's text with this bot's line added or replaced: one `<id>=<token>` per bot.
 * @param {string} text
 * @param {string} id
 * @param {string} token
 */
export function withTokenLine(text, id, token) {
  const others = text.split("\n").filter((line) => line.length > 0 && !line.startsWith(`${id}=`));
  return [...others, `${id}=${token}`].join("\n") + "\n";
}
