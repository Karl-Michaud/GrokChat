// The old GROKCHAT_BOT_CLIENTS list, as add-bot kept it in .bot-clients.local.json: JSON
// `[{ id, tokenSha256, accounts }]`, never a token. GROKCHAT-16 moved bot auth to the people in D1;
// import-bots reads this file once to carry the live tokens over without reissuing them.

/** Ids the old list accepted; they become person ids, so `bot:<id>` stays the audit actor. */
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
 * The local list, checked as strictly as the Worker used to check the secret: an extra field (a
 * token pasted in by hand, say) refuses the whole file. The error never quotes the file.
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
  const accounts = json.flatMap((client) => client.accounts);
  if (new Set(accounts).size !== accounts.length) {
    throw new Error("the bot client list gives one account twice: a person owns an account alone");
  }
  return json;
}
