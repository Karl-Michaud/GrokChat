// The SQL import-bots runs (GROKCHAT-16): one person per old bot client, keeping the client's id
// and token hash, and its accounts assigned to it. Every statement only fills what is missing, so
// running it twice changes nothing: a person that exists keeps its name and token (a rotation on
// the dashboard is never reverted), a token is set only where none is, and an account is assigned
// only when it has no person. A token hash already held by another person is never written twice.
// It is a one-off: a run after an account was unassigned on the dashboard would assign it again.

/** @typedef {import("./bot_clients.mjs").BotClient} BotClient */

/** @param {string} value */
function quoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The person's name: the client id with its first letter capitalised (karl → Karl). It can be
 * renamed on the dashboard afterwards; the id, and so the audit actor, stays.
 * @param {string} id
 */
export function personNameOf(id) {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
}

/**
 * @param {BotClient} client
 * @param {number} now
 * @returns {string[]}
 */
function clientStatements(client, now) {
  const id = quoted(client.id);
  const hash = quoted(client.tokenSha256);
  const free = `NOT EXISTS (SELECT 1 FROM people WHERE token_sha256 = ${hash})`;
  return [
    `INSERT INTO people (id, name, token_sha256, token_created_at, created_at) ` +
      `SELECT ${id}, ${quoted(personNameOf(client.id))}, ${hash}, ${String(now)}, ${String(now)} ` +
      `WHERE ${free} ON CONFLICT DO NOTHING;`,
    `UPDATE people SET token_sha256 = ${hash}, token_created_at = ${String(now)} ` +
      `WHERE id = ${id} AND token_sha256 IS NULL AND ${free};`,
    ...client.accounts.map(
      (account) =>
        `UPDATE accounts SET person_id = ${id} WHERE id = ${quoted(account)} AND person_id IS NULL ` +
        `AND EXISTS (SELECT 1 FROM people WHERE id = ${id});`,
    ),
  ];
}

/**
 * Every statement, client by client.
 * @param {readonly BotClient[]} clients
 * @param {number} now
 * @returns {string[]}
 */
export function importStatements(clients, now) {
  return clients.flatMap((client) => clientStatements(client, now));
}
