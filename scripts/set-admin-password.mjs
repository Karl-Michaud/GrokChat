// `npm run set-admin-password [-- --dry-run]`: asks twice for the dashboard password with no
// echo, refuses one under 12 characters, and sets GROKCHAT_ADMIN_PASSWORD_HASH to its PBKDF2 hash
// (the format src/frameworks/web/password.ts verifies) over `wrangler secret put`'s stdin. Neither
// the password nor the hash is ever printed or written to a file.
import { isMain, options, promptHidden, runCli, UsageError } from "./deploy/cli.mjs";
import { adminPasswordHash, passwordProblem } from "./deploy/secret_values.mjs";
import { spawnRun, WranglerSecrets } from "./deploy/wrangler_secrets.mjs";

export const NAME = "GROKCHAT_ADMIN_PASSWORD_HASH";

/**
 * @param {{
 *   prompt: (question: string) => Promise<string>,
 *   secrets: Pick<WranglerSecrets, "put">,
 *   log: (line: string) => void,
 * }} deps
 */
export async function setAdminPassword({ prompt, secrets, log }) {
  const password = await prompt("New dashboard password: ");
  const again = await prompt("The same password again: ");
  const problem = passwordProblem(password, again);
  if (problem !== null) {
    throw new UsageError(`${problem}; nothing was set`);
  }
  secrets.put(NAME, await adminPasswordHash(password));
  log("Sign in at /dashboard/login with the new password; existing sessions stay valid.");
}

if (isMain(import.meta.url)) {
  await runCli(async () => {
    const flags = options(process.argv.slice(2), { "dry-run": { type: "boolean" } });
    /** @param {string} line */
    const log = (line) => {
      console.log(line);
    };
    const secrets = new WranglerSecrets({ run: spawnRun, log, dryRun: flags["dry-run"] === true });
    await setAdminPassword({ prompt: promptHidden, secrets, log });
  });
}
