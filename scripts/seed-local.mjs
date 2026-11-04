// `npm run seed:local [-- --dry-run]` (docs/runbook.md, "Local preview"): fills the LOCAL D1 of
// `wrangler dev` with a realistic, deterministic dashboard: three people (GROKCHAT-16: one with a
// token and two accounts, one with an account and no token, one with nothing yet), three accounts, about two months of
// posts with their metrics reads, daily follower snapshots, the audit log and the X costs. It
// never touches the deployed database (`--local` only) and writes no secret anywhere.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAYS = 60;

/** A small seeded generator (mulberry32), so every run draws the same dashboard. */
function generator(seed = 20261027) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** @param {unknown} value */
function sql(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number") {
    return String(Math.round(value));
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** @param {string} table @param {Record<string, unknown>} row */
function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(sql).join(", ")});`;
}

const POLICY = {
  mode: "AUTO",
  dailyCap: 10,
  minGap: 30 * 60_000,
  quietHours: null,
  tz: "UTC",
  linkPolicy: "ALLOW",
  grace: 30 * 60_000,
};

/**
 * @typedef {{ id: string, handle: string, status: string, mode: string, reach: number, followers: number }} SeedAccount
 * @typedef {{ kind: string, xPostId?: string, at?: number, reason?: string }} SeedState
 * @typedef {{ text: string, media: string[], state: SeedState }} SeedPart
 * @typedef {{ id: string, account: SeedAccount, lifecycle: string, publishAt: number, parts: SeedPart[], quality: number, now: number }} SeedPost
 */

/** @type {readonly SeedAccount[]} */
const ACCOUNTS = [
  {
    id: "acc-studio",
    handle: "musechat_studio",
    status: "ACTIVE",
    mode: "AUTO",
    reach: 1.6,
    followers: 4200,
  },
  {
    id: "acc-daily",
    handle: "musechat_daily",
    status: "ACTIVE",
    mode: "REVIEW",
    reach: 0.9,
    followers: 1850,
  },
  {
    id: "acc-labs",
    handle: "musechat_labs",
    status: "PAUSED",
    mode: "AUTO",
    reach: 0.4,
    followers: 610,
  },
];

const TEXTS = [
  "Three chord progressions that make any melody feel cinematic. Save this for your next session.",
  "We asked 500 producers what slows them down. The answer surprised us.",
  "Hot take: your mix is not muddy, your arrangement is crowded.",
  "Five-minute warmup for vocalists, no gear needed. Try it before you record today.",
  "What is the one plugin you would keep if you could only keep one?",
  "Behind the scenes: how we turned a voice memo into a finished track in an afternoon.",
  "A reminder that unfinished songs still count as practice.",
  "New on the blog: writing hooks that people hum the next morning.",
  "Thread: everything we learned shipping 100 beats in 100 days.",
  "The quietest part of a song is often where the emotion lives.",
];

/**
 * @param {() => number} random
 * @param {SeedAccount} account
 * @param {number} index
 * @param {number} at
 * @param {number} now
 * @returns {SeedPost}
 */
function sentPost(random, account, index, at, now) {
  const parts = index % 9 === 4 ? 3 : 1;
  const id = `seed-${account.id}-${String(index)}`;
  /** @type {SeedPart[]} */
  const partStates = Array.from({ length: parts }, (_, k) => ({
    text:
      k === 0
        ? (TEXTS[index % TEXTS.length] ?? "")
        : `${String(k + 1)}/ ${TEXTS[(index + k) % TEXTS.length] ?? ""}`,
    media: [],
    state: {
      kind: "SENT",
      xPostId: `18${String(at).slice(-9)}${String(index).padStart(3, "0")}${String(k)}`,
      at: at + k * 1000,
    },
  }));
  return {
    id,
    account,
    lifecycle: "DONE",
    publishAt: at,
    parts: partStates,
    quality: 0.4 + random() * 1.6,
    now,
  };
}

/**
 * @param {() => number} random
 * @param {number} now
 */
function posts(random, now) {
  /** @type {SeedPost[]} */
  const all = [];
  for (const account of ACCOUNTS) {
    let index = 0;
    for (let day = DAYS; day >= 0; day -= 1) {
      const count = account.status === "PAUSED" && day < 12 ? 0 : Math.floor(random() * 2.4);
      for (let n = 0; n < count; n += 1) {
        const at = now - day * DAY - Math.floor(random() * 20) * HOUR - HOUR;
        if (at < now - HOUR) {
          all.push(sentPost(random, account, index, at, now));
        }
        index += 1;
      }
    }
    all.push(...pending(account, index, now));
  }
  return all;
}

/**
 * A few posts in every other state, so the posts page shows each chip.
 * @param {SeedAccount} account
 * @param {number} index
 * @param {number} now
 * @returns {SeedPost[]}
 */
function pending(account, index, now) {
  /** @param {number} k */
  const text = (k) => TEXTS[(index + k) % TEXTS.length] ?? "";
  /** @param {number} k @param {SeedState} state @returns {SeedPart[]} */
  const part = (k, state = { kind: "PENDING" }) => [{ text: text(k), media: [], state }];
  const extra = { quality: 0, now };
  const base = `seed-${account.id}`;
  return [
    {
      id: `${base}-next`,
      account,
      lifecycle: "SCHEDULED",
      publishAt: now + 3 * HOUR,
      parts: part(1),
      ...extra,
    },
    {
      id: `${base}-later`,
      account,
      lifecycle: "SCHEDULED",
      publishAt: now + 26 * HOUR,
      parts: part(2),
      ...extra,
    },
    {
      id: `${base}-review`,
      account,
      lifecycle: account.mode === "REVIEW" ? "PENDING_REVIEW" : "CANCELLED",
      publishAt: now + 5 * HOUR,
      parts: part(3),
      ...extra,
    },
    {
      id: `${base}-failed`,
      account,
      lifecycle: "DONE",
      publishAt: now - 2 * DAY,
      parts: part(4, { kind: "REJECTED", reason: "duplicate content" }),
      ...extra,
    },
  ];
}

/** @param {number} quality @param {number} reach @param {number} age hours since posting */
function countsAt(quality, reach, age) {
  const impressions = Math.round(1800 * quality * reach * (1 - Math.exp(-age / 14)));
  /** @param {number} rate */
  const share = (rate) => Math.round(impressions * rate * quality);
  return {
    impressions,
    likes: share(0.034),
    reposts: share(0.006),
    replies: share(0.004),
    quotes: share(0.001),
    bookmarks: share(0.008),
    url_link_clicks: age < 30 * 24 ? share(0.009) : null,
    user_profile_clicks: age < 30 * 24 ? share(0.005) : null,
  };
}

const READS = [1, 6, 24, 72, 168, 336];

/** @param {SeedPost} post */
function postStatements(post) {
  const statements = [
    insert("posts", {
      id: post.id,
      account_id: post.account.id,
      lifecycle: post.lifecycle,
      publish_at: post.publishAt,
      resume_at: null,
      due_at: post.lifecycle === "SCHEDULED" ? post.publishAt : null,
      bot_id: "muse-bot",
      idempotency_key: `${post.id}-key`,
      request_hash: "seed",
      created_by: JSON.stringify({
        kind: "bot",
        scope: { botId: "muse-bot", accountIds: [post.account.id] },
      }),
      provenance: JSON.stringify({
        botId: "muse-bot",
        policySnapshot: { ...POLICY, mode: post.account.mode },
      }),
      parts: JSON.stringify(post.parts),
      version: 3,
    }),
  ];
  post.parts.forEach((part, idx) => {
    const sent = part.state.kind === "SENT" ? part.state : null;
    statements.push(
      insert("post_parts", {
        post_id: post.id,
        idx,
        account_id: post.account.id,
        state_kind: part.state.kind,
        attempt_at: sent?.at ?? null,
        x_post_id: sent?.xPostId ?? null,
        sent_at: sent?.at ?? null,
        metrics_next_at: null,
      }),
    );
  });
  return statements;
}

/**
 * The metrics reads of a sent post, as the tick writes them.
 * @param {SeedPost} post
 */
function metricsStatements(post) {
  if (post.lifecycle !== "DONE" || post.parts[0]?.state.kind !== "SENT") {
    return [];
  }
  return post.parts.flatMap((part, k) =>
    READS.filter((hours) => post.publishAt + hours * HOUR < post.now).map((hours) => {
      const at = post.publishAt + hours * HOUR + k;
      const counts = countsAt(post.quality * (k === 0 ? 1 : 0.35), post.account.reach, hours);
      return insert("metrics", {
        x_post_id: part.state.xPostId,
        account_id: post.account.id,
        taken_at: at,
        ...counts,
      });
    }),
  );
}

/** @param {SeedPost} post */
function auditStatements(post) {
  const created = post.publishAt - 2 * HOUR;
  const statements = [
    insert("audit_events", {
      at: created,
      actor: "bot:muse-bot",
      action: "post.create",
      account_id: post.account.id,
      post_id: post.id,
      detail: "",
    }),
  ];
  for (const part of post.parts) {
    if (part.state.kind === "SENT") {
      const at = part.state.at;
      statements.push(
        insert("audit_events", {
          at,
          actor: "system:x",
          action: "x.create",
          account_id: post.account.id,
          post_id: post.id,
          detail: `sent ${part.state.xPostId}`,
        }),
        insert("cost_entries", {
          at,
          account_id: post.account.id,
          operation: "create",
          micros: 15_000,
        }),
      );
    }
  }
  return statements;
}

/** @param {() => number} random @param {number} now */
function followerStatements(random, now) {
  return ACCOUNTS.flatMap((account) => {
    let followers = account.followers;
    return Array.from({ length: DAYS + 1 }, (_, n) => {
      const day = Math.floor((now - (DAYS - n) * DAY) / DAY) * DAY + 3 * HOUR;
      followers += Math.round((random() * 22 - 4) * account.reach);
      const iso = new Date(day).toISOString().slice(0, 10);
      const at = Math.min(day, now - 60_000);
      return [
        insert("follower_snapshots", {
          account_id: account.id,
          day: iso,
          claimed_at: at,
          taken_at: at,
          followers,
          following: 180,
          posts: 300 + n,
          listed: 12,
        }),
        insert("audit_events", {
          at,
          actor: "system:x",
          action: "x.user_read",
          account_id: account.id,
          post_id: null,
          detail: `followers ${String(followers)}`,
        }),
        insert("cost_entries", {
          at,
          account_id: account.id,
          operation: "user_read",
          micros: 10_000,
        }),
      ];
    }).flat();
  });
}

/**
 * The people and who owns which account. Karl's token hash is the SHA-256 of no real token: the
 * dashboard shows "Token set", and only a token generated on the dashboard reaches the accounts.
 */
const PEOPLE = [
  { id: "karl", name: "Karl", token: "0".repeat(64), accounts: ["acc-studio", "acc-daily"] },
  { id: "aaron", name: "Aaron", token: null, accounts: ["acc-labs"] },
  { id: "kabir", name: "Kabir", token: null, accounts: [] },
];

/** @param {string} account */
const ownerOf = (account) => PEOPLE.find((person) => person.accounts.includes(account))?.id;

/** @param {number} now */
function peopleStatements(now) {
  return PEOPLE.map((person, index) =>
    insert("people", {
      id: person.id,
      name: person.name,
      token_sha256: person.token,
      token_created_at: person.token === null ? null : now - 2 * DAY,
      created_at: now - (10 - index) * DAY,
    }),
  );
}

/** @param {number} now */
function accountStatements(now) {
  return [
    ...peopleStatements(now),
    ...ACCOUNTS.map((account, index) =>
      insert("accounts", {
        id: account.id,
        x_user_id: `x-seed-${String(index + 1)}`,
        handle: account.handle,
        status: account.status,
        bio_confirmed: account.status === "PAUSED" ? 0 : 1,
        automated_label_confirmed: account.status === "PAUSED" ? 0 : 1,
        policy: JSON.stringify({
          ...POLICY,
          mode: account.mode,
          quietHours: index === 1 ? { startMinute: 1320, endMinute: 390 } : null,
          tz: index === 1 ? "Europe/Paris" : "UTC",
        }),
        is_app_owner: 0,
        person_id: ownerOf(account.id) ?? null,
      }),
    ),
    insert("audit_events", {
      at: now - 3 * DAY,
      actor: "human:admin",
      action: "account.policy",
      account_id: "acc-daily",
      post_id: null,
      detail: "",
    }),
    insert("audit_events", {
      at: now - 2 * DAY,
      actor: "bot:muse-bot",
      action: "refused.post.create",
      account_id: "acc-labs",
      post_id: null,
      detail: "scope",
    }),
    insert("audit_events", {
      at: now - HOUR,
      actor: "human:admin",
      action: "session.login",
      account_id: null,
      post_id: null,
      detail: "",
    }),
    `INSERT OR REPLACE INTO r2_usage (id, month, stored_bytes, class_a, class_b) VALUES (1, ${sql(new Date(now).toISOString().slice(0, 7))}, 1830000000, 214000, 1730000);`,
  ];
}

const TABLES = [
  "people",
  "posts",
  "post_parts",
  "accounts",
  "metrics",
  "audit_events",
  "cost_entries",
  "follower_snapshots",
  "r2_usage",
];

/** Every statement, oldest data first; the tables are emptied first, so a run replaces the seed. */
export function seedSql(now = Date.now()) {
  const random = generator();
  const all = posts(random, now);
  return [
    ...TABLES.map((table) => `DELETE FROM ${table};`),
    ...accountStatements(now),
    ...all.flatMap(postStatements),
    ...all.flatMap(metricsStatements),
    ...all.flatMap(auditStatements),
    ...followerStatements(random, now),
  ].join("\n");
}

/** @param {readonly string[]} args */
function wrangler(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

function main() {
  const text = seedSql();
  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`${text}\n`);
    return;
  }
  const file = join(mkdtempSync(join(tmpdir(), "grokchat-seed-")), "seed.sql");
  writeFileSync(file, text);
  wrangler(["d1", "migrations", "apply", "grokchat", "--local"]);
  wrangler(["d1", "execute", "grokchat", "--local", "--file", file, "--yes"]);
  console.log(`seed:local: ${String(text.split("\n").length)} statements written to the local D1.`);
}

if (import.meta.url === `file://${process.argv[1] ?? ""}`) {
  main();
}
