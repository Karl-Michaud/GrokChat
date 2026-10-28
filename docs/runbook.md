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

3. **Bots.** The MCP endpoint lets in only a token that belongs to a person in D1. Section 3
   creates the people and their tokens on the dashboard once an account is connected.

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
   - Open **Posting policy** on its card, set it and save it. Start in **Review first**, so
     every bot post waits on the **Posts** page (status "Needs review") for your approval.
     Switch to auto-publish only once the bot's posts have been right for a while.
   - Turn its switch to **Publishing on**.
4. Set the card's **Owner** to the person whose bot runs the account (section 3). Until it
   has one, the account sits under **Unassigned** and no bot can post to it.

To reconnect an account, use **Reconnect on X** on its card. Do this when the section
says publishing is refused until the account is reconnected, or when X revoked access. A reconnect as a different X user is refused.

## 3. People and their bot tokens

Each person (Karl, Aaron, Kabir, …) runs one Grok "chief of staff" bot for their own accounts.
GrokChat keeps the people in D1 (migration `0004`): a name, the SHA-256 of their one bot
token (never the token), and which accounts are theirs. An account belongs to at most one
person. Bot auth reads all of it on every MCP request, so a change applies to the next call.

1. **Add the person.** On **Accounts**, type the name next to **New person** and press it.
   The person gets a section of their own, with "No token".
2. **Give them their accounts.** On each account's card, set **Owner** to the person. It saves
   on change. Their section now lists the account.
3. **Generate their token.** Press **Generate token** in their section. The answer is a page
   shown once, never again:
   - the token, with **Copy**;
   - the connector settings for Grok: name `grokchat`, server URL
     `https://grokchat.grokchat.workers.dev/mcp`, header `Authorization`, value
     `Bearer <token>`;
   - **Copy setup prompt**: the chief-of-staff prompt with the person's accounts filled in. It
     tells the bot to call `list_accounts` and never contains the token.

   GrokChat keeps only the hash. The page is not cached, is kept out of the browser's
   history snapshots, and the token is in no URL, redirect, log line or audit row. Leave the
   page and the token is gone: rotate to get a new one.
4. **Configure the person's Grok bot** with the connector settings, then paste the setup
   prompt. Its Phase 1 checks the tools (13), lists the accounts, and proves that an account
   id that is not theirs is refused as `scope`. A wrong token fails the **whole** Grok request
   with "Authentication failed" (U9), not only the tool call.

**Adding an account later never changes the token.** Connect it, finish its disclosure, and
set its **Owner** to the person. The bot sees it on its next `list_accounts` call. Setting an
Owner to someone else, or to Unassigned, takes it away from the bot at once.

**Rotate** (in the person's section, then **Rotate now**) when a token may have leaked: the
old one stops working at once, so update the bot's connector straight after. **Delete** asks
for the person's name: their accounts become Unassigned and their token stops working.
**Rename** keeps the token; the audit and Activity name bots by person id (`bot:<id>`), which
never changes.

### 3.1 One-off: carry the old bot list over (GROKCHAT-16)

Before GROKCHAT-16, bot tokens lived in the secret `GROKCHAT_BOT_CLIENTS`, written by the
retired `add-bot` script. `npm run import-bots` moves that list into D1 so the live tokens keep
working with no reissue. It reads `.bot-clients.local.json` (ids, token hashes and account ids,
never a token), makes one person per client with the same id (`karl` → "Karl", so the audit
actor `bot:karl` stays), keeps the hash, and assigns the client's accounts. It only fills what
is missing: a person, a token or an owner already set is kept, so a second run changes nothing.
It prints no token or hash.

1. `npx wrangler d1 migrations apply grokchat --remote` (adds `people` and
   `accounts.person_id`).
2. `npm run import-bots -- --dry-run`, check the people and the count, then
   `npm run import-bots`.
3. Deploy the release (section 7).
4. Run `npm run import-bots` once more: the old release's account saves could clear an
   owner between steps 2 and 3, and the run puts back only what is missing.
5. Check **Accounts**: each person shows "Token set" and their accounts. Have each bot make
   one `list_accounts` call.
6. Delete the old secret, which nothing reads any more:
   `npx wrangler secret delete GROKCHAT_BOT_CLIENTS`. Keep `.bot-clients.local.json` until
   every bot was checked, then delete it.

The import is a one-off: run after an account was unassigned on the dashboard, it would give
that account back to its old client.

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

**A bot's token:** **Rotate token** in the person's section on **Accounts** (section 3).

**X app credentials:** after regenerating them in the X developer portal, update the env
file and run `npm run provision-secrets -- --rotate --env-file <path>`.

## 5. Kill switch

- **One account.** Dashboard → **Accounts** → turn the account's switch off ("Paused").
  Nothing more is published for the account from the next publish tick (at most a
  minute). Posts that are waiting stay scheduled. Turning it back on resumes.
- **One post.** On the post's page, **Cancel** it before it starts, or **Delete on X**
  once it is published. Delete removes every sent part, last part first.
- **Every bot.** Revoke them (section 3).
- **Everything.** Pause every account. Then deploy, or roll back, only when `/health`
  shows `"publishing":0`.

## 6. Read analytics, costs and R2 usage

- **Analytics** (the dashboard's home): impressions, engagements, likes, reposts, replies,
  link clicks, follower growth, posts published and X spend for the last 24 hours, 3, 7,
  14 or 30 days or all time, against the period before; every account or one (the
  sidebar's account switcher). Each chart has **Show as a table**.
  - The numbers are what each post _gained_ in the range: a post's metrics are read on a
    decaying schedule (plan §3.3 #8), and each read counts the change since the one
    before. Link clicks come from X's non-public metrics, which X gives for posts under 30
    days old only.
  - **Followers** are read once a UTC day per connected account by the `*/15` metrics tick
    (one User read, $0.010 a day per account), so follower growth moves in daily steps.
- **Costs.** The **X API spend** card: X API spend in the range, per account, from our own
  ledger, which gets an entry for every X call. Compare it with the X developer portal's
  usage page and its spending limit. Every call and its cost is also on the **Activity**
  page.
- **Media.** The **Media storage (R2)** card: R2 stored bytes, and this month's Class A
  and Class B operations, against the free tier's 10 GB, 1M and 10M.
  - The quota guard refuses uploads with `media_quota` from 8 GB stored or 800k Class A,
    and stops reads at 8M Class B.
  - Staged media is deleted 7 days after its post publishes, or 2 days after staging if it
    was never used.
- **Activity.** Every request: what bots, you and GrokChat itself did (created, edited,
  scheduled, published, cancelled, deleted, refused, metrics reads), on which account, at
  what X cost. Filter by account, by who, and by kind.
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

## 9. Local preview

To see the dashboard on your machine with realistic data, without touching production:

1. Write a `.dev.vars` (gitignored; see `.dev.vars.example`) with throwaway values only:
   a random `GROKCHAT_SESSION_SECRET`, a `GROKCHAT_ADMIN_PASSWORD_HASH` for a local
   password, `GROKCHAT_PUBLIC_ORIGIN=http://localhost:8787`, and dummy X app values.
   Never a production secret.
2. `npm run seed:local` applies the migrations to the **local** D1 and fills it with three
   people (one with a token hash and two accounts, one with an account, one with none), three
   accounts and about two months of posts, metrics, follower snapshots, activity and
   costs (deterministic; a run replaces the previous seed). It never runs against the
   deployed database. `-- --dry-run` prints the SQL.
3. `npx wrangler dev`, then open `http://localhost:8787/dashboard/login`. The theme toggle
   is at the bottom of the sidebar.

Move `.dev.vars` out of the clone before `npm run check`: the workerd test plugin loads it
too, and its values then override the tests' own.
