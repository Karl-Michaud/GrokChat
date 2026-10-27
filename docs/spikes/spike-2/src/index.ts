import { DurableObject } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  ACCOUNT: DurableObjectNamespace<AccountPublisher>;
  TOKEN: string;
}

type Attempt = { i: number; ok: boolean; ms: number; info?: string; err?: string };
type Summary = { n: number; ok: number; failed: number; firstFailure: number | null; errors: Record<string, number>; attempts?: Attempt[] };

const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

function summarise(attempts: Attempt[], keep = true): Summary {
  const errors: Record<string, number> = {};
  let firstFailure: number | null = null;
  for (const a of attempts) {
    if (!a.ok) {
      errors[a.err ?? "?"] = (errors[a.err ?? "?"] ?? 0) + 1;
      if (firstFailure === null) firstFailure = a.i;
    }
  }
  const ok = attempts.filter((a) => a.ok).length;
  return { n: attempts.length, ok, failed: attempts.length - ok, firstFailure, errors, ...(keep ? { attempts } : {}) };
}

async function attempt(i: number, f: () => Promise<string>): Promise<Attempt> {
  const t = Date.now();
  try {
    const info = await f();
    return { i, ok: true, ms: Date.now() - t, info };
  } catch (e) {
    return { i, ok: false, ms: Date.now() - t, err: errText(e) };
  }
}

async function d1Queries(db: D1Database, n: number): Promise<Summary> {
  const out: Attempt[] = [];
  for (let i = 1; i <= n; i++) out.push(await attempt(i, async () => String((await db.prepare("SELECT ?1 AS i").bind(i).first<{ i: number }>())?.i)));
  return summarise(out);
}

async function externalFetches(n: number, url = "https://example.com/"): Promise<Summary> {
  const out: Attempt[] = [];
  for (let i = 1; i <= n; i++)
    out.push(await attempt(i, async () => {
      const r = await fetch(`${url}?i=${i}`);
      await r.body?.cancel();
      return String(r.status);
    }));
  return summarise(out);
}

const PRIVATE_URLS = [
  "http://127.0.0.1/",
  "http://localhost/",
  "http://10.0.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/",
  "http://[::1]/",
];

async function privateFetches(): Promise<Record<string, string>> {
  const res: Record<string, string> = {};
  for (const u of PRIVATE_URLS) {
    const t = Date.now();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      const body = (await r.text()).slice(0, 120).replace(/\s+/g, " ");
      res[u] = `status ${r.status} server=${r.headers.get("server")} cf-ray=${r.headers.get("cf-ray") ? "yes" : "no"} body="${body}" (${Date.now() - t} ms)`;
    } catch (e) {
      res[u] = `error ${errText(e)} (${Date.now() - t} ms)`;
    }
  }
  return res;
}

export class AccountPublisher extends DurableObject<Env> {
  async ping(): Promise<string> {
    return "pong";
  }
  async work(d1: number, fetches: number): Promise<{ d1: Summary; fetch: Summary }> {
    const d = await d1Queries(this.env.DB, d1);
    const f = await externalFetches(fetches);
    return { d1: { ...d, attempts: undefined }, fetch: { ...f, attempts: undefined } };
  }
  async workFull(d1: number, fetches: number): Promise<{ d1: Summary; fetch: Summary }> {
    return { d1: await d1Queries(this.env.DB, d1), fetch: await externalFetches(fetches) };
  }
  async ssrf(): Promise<Record<string, string>> {
    return privateFetches();
  }
}

async function authorised(req: Request, env: Env): Promise<boolean> {
  if (!env.TOKEN) return false;
  const got = new TextEncoder().encode(req.headers.get("authorization") ?? "");
  const want = new TextEncoder().encode(`Bearer ${env.TOKEN}`);
  if (got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}

const json = (v: unknown) => new Response(JSON.stringify(v, null, 1), { headers: { "content-type": "application/json" } });
const num = (u: URL, k: string, d: number) => Number(u.searchParams.get(k) ?? d);
const stub = (env: Env, name: string) => env.ACCOUNT.get(env.ACCOUNT.idFromName(name));

const TT_TEXT =
  "Launch notes for the spring release are up at https://example.com/releases/spring-2026 and the migration guide lives at https://docs.example.org/guides/migrate?from=v1 so read both before you upgrade. Question? Reply here and we will answer each one today, promise. #release @team";

async function route(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url);
  const p = u.pathname;
  const run = u.searchParams.get("run") ?? "";

  if (p === "/baseline") return json({ ok: true, run });

  if (p === "/u16/worker-do") {
    const n = num(u, "n", 60);
    const batch = num(u, "batch", 1);
    const out: Attempt[] = [];
    for (let i = 1; i <= n; i += batch) {
      const idx = Array.from({ length: Math.min(batch, n - i + 1) }, (_, k) => i + k);
      out.push(...(await Promise.all(idx.map((j) => attempt(j, () => stub(env, `wd-${run}-${j}`).ping())))));
    }
    return json(summarise(out, n <= 100));
  }
  if (p === "/u16/worker-d1") return json(await d1Queries(env.DB, num(u, "n", 60)));
  if (p === "/u16/worker-fetch") return json(await externalFetches(num(u, "n", 60)));
  if (p === "/u16/do-inside") return json(await stub(env, `in-${run}`).workFull(num(u, "d1", 60), num(u, "f", 60)));
  if (p === "/u16/mixed") {
    // DO calls first, then external fetches: if DO calls counted as external subrequests, fetches would fail early.
    const dos = num(u, "dos", 45);
    const doRes: Attempt[] = [];
    for (let i = 1; i <= dos; i++) doRes.push(await attempt(i, () => stub(env, `mx-${run}-${i}`).ping()));
    const d1 = await d1Queries(env.DB, num(u, "d1", 0));
    const f = await externalFetches(num(u, "f", 55));
    return json({ doCalls: summarise(doRes, false), d1: { ...d1, attempts: undefined }, fetch: f });
  }
  if (p === "/u16/fanout") {
    const dos = num(u, "dos", 45);
    const d1 = num(u, "d1", 10);
    const f = num(u, "f", 5);
    const t = Date.now();
    const res = await Promise.all(
      Array.from({ length: dos }, (_, k) => k + 1).map(async (i) => {
        try {
          return { i, ...(await stub(env, `fo-${run}-${i}`).work(d1, f)) };
        } catch (e) {
          return { i, callError: errText(e) };
        }
      }),
    );
    const totals = { doCalls: dos, d1Ok: 0, d1Failed: 0, fetchOk: 0, fetchFailed: 0, callErrors: 0, errors: {} as Record<string, number> };
    for (const r of res) {
      if ("callError" in r) {
        totals.callErrors++;
        totals.errors[r.callError] = (totals.errors[r.callError] ?? 0) + 1;
        continue;
      }
      totals.d1Ok += r.d1.ok; totals.d1Failed += r.d1.failed; totals.fetchOk += r.fetch.ok; totals.fetchFailed += r.fetch.failed;
      for (const [k, v] of Object.entries({ ...r.d1.errors, ...r.fetch.errors })) totals.errors[k] = (totals.errors[k] ?? 0) + v;
    }
    return json({ ms: Date.now() - t, totals, perDo: res });
  }

  if (p === "/u18/worker") return json(await privateFetches());
  if (p === "/u18/do") return json(await stub(env, "ssrf").ssrf());

  if (p === "/u15/unique") {
    await env.DB.exec("DROP TABLE IF EXISTS uq; CREATE TABLE uq(id INTEGER PRIMARY KEY, v TEXT UNIQUE)");
    let batchResult: string;
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO uq(v) VALUES ('a')"),
        env.DB.prepare("INSERT INTO uq(v) VALUES ('b')"),
        env.DB.prepare("INSERT INTO uq(v) VALUES ('a')"),
        env.DB.prepare("INSERT INTO uq(v) VALUES ('c')"),
      ]);
      batchResult = "committed (no error)";
    } catch (e) {
      batchResult = `error ${errText(e)}`;
    }
    const rows = await env.DB.prepare("SELECT count(*) AS n FROM uq").first<{ n: number }>();
    return json({ batchResult, rowsAfter: rows?.n });
  }
  if (p === "/u15/guard") {
    const DB = env.DB;
    await DB.exec("DROP TABLE IF EXISTS posts; CREATE TABLE posts(id INTEGER PRIMARY KEY, version INTEGER NOT NULL, lifecycle TEXT NOT NULL)");
    await DB.exec("DROP TABLE IF EXISTS parts; CREATE TABLE parts(post_id INTEGER, k INTEGER, state TEXT NOT NULL, x_post_id TEXT, PRIMARY KEY(post_id, k))");
    await DB.exec("DROP TABLE IF EXISTS audit; CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, action TEXT)");
    await DB.exec("DROP TABLE IF EXISTS cost; CREATE TABLE cost(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, usd TEXT)");
    await DB.exec("DROP TABLE IF EXISTS version_guard; CREATE TABLE version_guard(ok INTEGER NOT NULL)");
    await DB.exec("INSERT INTO posts VALUES (1, 7, 'PUBLISHING'); INSERT INTO parts VALUES (1, 1, 'SENDING', NULL), (1, 2, 'PENDING', NULL)");
    const commitPart = (v: number, lifecycle: string, k: number, xId: string, last: boolean) =>
      DB.batch([
        DB.prepare("INSERT INTO version_guard(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND version = ?2 AND lifecycle = ?3) THEN 1 ELSE NULL END").bind(1, v, lifecycle),
        DB.prepare("UPDATE parts SET state = 'SENT', x_post_id = ?3 WHERE post_id = ?1 AND k = ?2 AND state = 'SENDING'").bind(1, k, xId),
        DB.prepare("UPDATE posts SET version = version + 1, lifecycle = ?3 WHERE id = ?1 AND version = ?2").bind(1, v, last ? "DONE" : "PUBLISHING"),
        DB.prepare("INSERT INTO audit(post_id, action) VALUES (?1, 'part_sent')").bind(1),
        DB.prepare("INSERT INTO cost(post_id, usd) VALUES (?1, '0.015')").bind(1),
        DB.prepare("DELETE FROM version_guard"),
      ]);
    const snapshot = () =>
      DB.prepare(`SELECT (SELECT version FROM posts) v, (SELECT lifecycle FROM posts) l,
       (SELECT state || ':' || coalesce(x_post_id, '-') FROM parts WHERE k = 1) p1, (SELECT count(*) FROM audit) a,
       (SELECT count(*) FROM cost) c, (SELECT count(*) FROM version_guard) g`).first();
    const step = async (label: string, v: number, l: string) => {
      let result: string;
      try {
        await commitPart(v, l, 1, "x-111", false);
        result = "committed";
      } catch (e) {
        result = `error ${errText(e)}`;
      }
      return { label, result, after: await snapshot() };
    };
    const before = await snapshot();
    const stale = await step("stale version 6", 6, "PUBLISHING");
    const wrongLifecycle = await step("current version 7, wrong lifecycle DONE", 7, "DONE");
    const current = await step("current version 7, lifecycle PUBLISHING", 7, "PUBLISHING");
    return json({ before, stale, wrongLifecycle, current });
  }

  if (p === "/u19/tt") {
    const t0 = Date.now();
    const mod = (await import("twitter-text")) as unknown as { default?: TT } & TT;
    const tt: TT = mod.default ?? mod;
    const parsed = tt.parseTweet(TT_TEXT);
    const urls = tt.extractUrls(TT_TEXT);
    return json({ run, len: [...TT_TEXT].length, weightedLength: parsed.weightedLength, valid: parsed.valid, urls, ms: Date.now() - t0 });
  }
  if (p === "/u19/pbkdf2") {
    const iterations = num(u, "iter", 100000);
    try {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("correct horse battery staple"), "PBKDF2", false, ["deriveBits"]);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
      return json({ run, iterations, ok: true, bytes: bits.byteLength });
    } catch (e) {
      return json({ run, iterations, ok: false, err: errText(e) });
    }
  }
  return new Response("not found", { status: 404 });
}

type TT = { parseTweet(t: string): { weightedLength: number; valid: boolean }; extractUrls(t: string): string[] };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!(await authorised(req, env))) return new Response("unauthorised", { status: 401 });
    try {
      return await route(req, env);
    } catch (e) {
      return new Response(`uncaught ${errText(e)}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
