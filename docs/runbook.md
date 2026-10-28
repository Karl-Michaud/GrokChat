# GrokChat runbook

How the owner deploys and runs GrokChat in production (plan §3.6, §8). The Worker is
**https://grokchat.grokchat.workers.dev** on the owner's free Cloudflare account. Its D1
database `grokchat` and R2 bucket `grokchat-media` already exist; `wrangler.jsonc` names
both.

Run every command from the root of a clone of the release commit on `main`, after `npm ci`,
with `npx wrangler login` done once on the machine. Each script below takes `--dry-run`. A
dry run prints every command it would run, with each value masked, and runs nothing,
writes nothing and reads no secret.

Rules for secrets:

- Values go to Cloudflare only through `wrangler secret put`'s stdin. The scripts never
  print a secret, put one in a command line, or write one into a tracked file.
- The scripts keep three local files, all gitignored and mode 600. Keep them out of every
  copy, backup and chat.
  - `.token-keys.local` holds the token-vault keys. You need it to rotate them.
  - `.bot-tokens.local` holds each new bot token until you copy it.
  - `.bot-clients.local.json` holds the bot list: ids, token hashes and account ids, no
    tokens.
- Cloudflare never shows a secret's value again. `npx wrangler secret list` shows names
  only.

## 1. First deploy

1. **Secrets.** `--env-file` is the path to the dotenv file that holds the X app's
   `X_CLIENT_ID` and `X_CLIENT_SECRET`. There is no default path.

   ```sh
   npm run provision-secrets -- --env-file <path to the X app's .env> --dry-run   # check first
   npm run provision-secrets -- --env-file <path to the X app's .env>
   ```

   This sets each of the following that the Worker does not have yet:
   - `GROKCHAT_TOKEN_KEYS`: one new AES-256 key, also written to `.token-keys.local`;
   - `GROKCHAT_SESSION_SECRET`: 32 random bytes;
   - `X_CLIENT_ID` and `X_CLIENT_SECRET`: from the env file.

   A secret that is already set is kept, so running it again changes nothing. If the Worker
   does not exist yet, wrangler creates it when it sets the first secret.

2. **Dashboard password.**

   ```sh
   npm run set-admin-password
   ```

   It asks twice, with no echo, refuses a password under 12 characters, and sets
   `GROKCHAT_ADMIN_PASSWORD_HASH`. The hash is PBKDF2-SHA-256 at 100,000 iterations, the
   format `src/frameworks/web/password.ts` verifies. Run it again at any time to change
   the password.

3. **Bot list.** The MCP endpoint refuses every bot until `GROKCHAT_BOT_CLIENTS` is set.
   Section 3 sets it once an account is connected.

4. **Database.**

   ```sh
   npx wrangler d1 migrations apply grokchat --remote
   ```

5. **Deploy.**

   ```sh
   npx wrangler deploy
   ```

   The output must list the three crons: `* * * * *`, `*/10 * * * *` and `*/15 * * * *`.

6. **Check.**
   - `curl https://grokchat.grokchat.workers.dev/health` answers
     `{"service":"grokchat","status":"ok","publishing":0}`.
   - `https://grokchat.grokchat.workers.dev/dashboard/login` shows the login form. A 503
     means a dashboard secret or var is missing or malformed.

Vars live in `wrangler.jsonc`, and changing one needs a deploy:

- `GROKCHAT_PUBLIC_ORIGIN` is `https://grokchat.grokchat.workers.dev`.
- `GROKCHAT_MEDIA_HOSTS` is empty, which refuses every `stage_media_from_url` request with
  `host_not_allowed`. To allow media by URL, list the hosts, comma-separated (for example
  `"pbs.twimg.com,images.example.com"`), and deploy. Workers cannot resolve DNS, so this
  list is the only guard against server-side request forgery (U18). List only hosts you
  trust.

## 2. Connect an X account

1. **X developer portal.** In the X app's settings, add
   `https://grokchat.grokchat.workers.dev/oauth/x/callback` as a callback URL, once. The
   connect fails at X without it.
2. **On X, as the account to connect.**
   - The bio says the account is automated and who runs it, as the dashboard's disclosure
     checkbox asks: "The bio says MuseChat runs it".
   - Turn on X's automated-account label: Settings → Your account → Account information
     → Automation. Name the managing account that runs the bot.
3. **On the dashboard.**
   - Sign in at `/dashboard/login`.
   - Under **Accounts**, press **Connect X account** (no personality is needed: Grok holds
     the bot's voice). Sign in on X as the account and
     authorise the app. You return to Accounts with "connected @handle".
   - The new account is **PAUSED**. Tick both disclosure boxes and **Save disclosure**.
     Publishing stays refused until both are confirmed.
   - Set the policy and save it. Start in **REVIEW** mode, so every bot post waits in the
     backlog for your approval. Switch to AUTO only once the bot's posts have been right
     for a while.
   - **Activate**.
4. Note the **Account id** that the account's section shows. `add-bot` takes it.

To reconnect an account, use **Reconnect on X** in its section. Do this when the section
says publishing is refused until the account is reconnected, or when X revoked access. A reconnect as a different X user is refused.

## 3. Add a bot and configure a Grok bot

1. **Create the bot's token.**

   ```sh
   npm run add-bot -- --id <bot id> --accounts <account id>[,<account id>…]
   ```

   - It generates a token of 32 random bytes.
   - It adds the bot's entry, or replaces it if the bot already has one, in
     `.bot-clients.local.json`: the id, the token's SHA-256 and the account ids.
   - It sets the whole list as `GROKCHAT_BOT_CLIENTS`.
   - It writes the token only to the `<bot id>=` line of `.bot-tokens.local`.
   - Running it again for the same id gives the bot a new token, and the old one stops
     working.
   - If the list was set from another machine and `.bot-clients.local.json` is missing
     here, it refuses. A new list would drop every other bot. Copy the file over, or pass
     `--new-list` to keep only this bot.

2. **Configure the Grok bot.** Add GrokChat to the bot's xAI Responses API request as an
   MCP tool:

   ```json
   {
     "type": "mcp",
     "server_label": "grokchat",
     "server_url": "https://grokchat.grokchat.workers.dev/mcp",
     "authorization": "<the token from .bot-tokens.local>"
   }
   ```

   - `authorization` takes the bare token. xAI sends it as `Bearer <token>`.
   - The model sees the tools as `grokchat___<tool>`.
   - `allowed_tools` can narrow the list.

3. **Test the token** with one request that makes the bot call `get_policy` for its account,
   before anything else. A wrong token fails the **whole** Grok request with "Authentication
   failed" (U9), not only the tool call. A token for an account outside the bot's list is
   refused as `scope`.
4. **Delete the token's line** from `.bot-tokens.local` once the bot works.

To revoke every bot at once, put an empty list. Nothing secret is printed:

```sh
printf '[]' | npx wrangler secret put GROKCHAT_BOT_CLIENTS
```

Then remove the entries from `.bot-clients.local.json` too, so the next `add-bot` does not
put them back.

## 4. Rotate keys

**Token-vault keys.** These encrypt each account's X tokens.

1. Put a new key in front of the current ones:

   ```sh
   npm run provision-secrets -- --rotate --env-file <path to the X app's .env>
   ```

   It reads the current keys from `.token-keys.local`, sets the new key in front of them
   and updates the file. `--rotate` also sets a new session secret, which signs everyone
   out, and puts the X app's credentials again.

2. Each account's tokens are re-sealed under the new key the next time its Durable Object
   loads them, at its next publish, reconcile, metrics read or token refresh.
3. When every account has done one of those (a day of ticks with each account ACTIVE),
   drop the old keys:

   ```sh
   npm run provision-secrets -- --drop-old-token-keys
   ```

   A paused account that loaded nothing in that time must be reconnected after the drop.

If `.token-keys.local` is lost, the current keys cannot be recovered. `--rotate
--replace-token-keys` then sets a single new key, and **every connected account must be
reconnected** (section 2).

**Session secret.** Rotating it signs everyone out of the dashboard:

```sh
npm run provision-secrets -- --rotate --env-file <path>
```

**Admin password:** `npm run set-admin-password`.

**A bot's token:** `npm run add-bot` again with the same `--id` and `--accounts`.

**X app credentials:** after regenerating them in the X developer portal, update the env
file and run `npm run provision-secrets -- --rotate --env-file <path>`.

## 5. Kill switch

- **One account.** Dashboard → **Accounts** → **Pause (kill switch)**. Nothing more is
  published for the account from the next publish tick (at most a minute). Posts that are
  waiting stay in the backlog. **Activate** resumes.
- **One post.** On the post's page, **Cancel** it before it starts, or **Delete on X**
  once it is published. Delete removes every sent part, last part first.
- **Every bot.** Revoke them (section 3).
- **Everything.** Pause every account. Then deploy, or roll back, only when `/health`
  shows `"publishing":0`.

## 6. Read costs and R2 usage

- **Costs.** Dashboard → **Costs**: X API spend per account and operation, from our own
  ledger, which gets an entry for every X call. Compare it with the X developer portal's
  usage page and its spending limit.
- **Media.** Dashboard → **Media**: R2 stored bytes, and this month's Class A and Class B
  operations, against the free tier's 10 GB, 1M and 10M.
  - The quota guard refuses uploads with `media_quota` from 8 GB stored or 800k Class A,
    and stops reads at 8M Class B.
  - Staged media is deleted 7 days after its post publishes, or 2 days after staging if it
    was never used.
- **Audit.** Dashboard → **Audit**: every X call and every refused or completed action.
- **Workers usage.** Cloudflare dashboard → Workers & Pages → `grokchat` → Metrics. For
  errors:

  ```sh
  npx wrangler tail grokchat --format pretty
  ```

  Exceeded-CPU `1102` or `1101` errors are exit criterion E11.

## 7. Deploy a new release

1. Check out the release commit on `main` and run `npm ci`. Run `npm run check` if it was
   not run for that commit.
2. If the release adds migrations, run
   `npx wrangler d1 migrations apply grokchat --remote` first. Migrations must be
   backwards compatible with the running release.
3. **Wait until it is quiet.** A deploy resets every Durable Object, and a send in flight
   then becomes UNKNOWN and goes to reconcile (m7). Check:

   ```sh
   curl -s https://grokchat.grokchat.workers.dev/health
   ```

   Deploy only when it shows `"publishing":0`, and soon after, away from the minute
   boundary when the publish tick starts.

4. `npx wrangler deploy`, then check `/health` and the dashboard.

## 8. Roll back

```sh
npx wrangler deployments list                        # find the version to go back to
npx wrangler rollback <version id> -m "<reason>"     # same quiet-time rule as a deploy
```

- A rollback restores the Worker's code and config only.
- Secrets and D1 stay as they are, so a release whose migrations the older code cannot
  read cannot be rolled back this way. Fix forward instead.
- Like a deploy, a rollback resets every Durable Object: wait for `"publishing":0`.
