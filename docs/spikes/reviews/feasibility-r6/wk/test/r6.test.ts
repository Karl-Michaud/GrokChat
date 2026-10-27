import { env } from "cloudflare:workers";
import { abortAllDurableObjects } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import type { Env } from "../src/index";
const E = env as unknown as Env;
const log = (...a: unknown[]) => console.log("[R6]", ...a);
const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
const refreshCount = async () => Number(await (await fetch("http://127.0.0.1:18798/count")).text());
const resetCount = async () => { await fetch("http://127.0.0.1:18798/reset"); };

describe("(a) commitPart guarded batch", () => {
  const DB = E.DB;
  async function schema() {
    await DB.exec("DROP TABLE IF EXISTS posts; CREATE TABLE posts(id INTEGER PRIMARY KEY, version INTEGER NOT NULL, lifecycle TEXT NOT NULL)");
    await DB.exec("DROP TABLE IF EXISTS parts; CREATE TABLE parts(post_id INTEGER, k INTEGER, state TEXT NOT NULL, x_post_id TEXT, PRIMARY KEY(post_id, k))");
    await DB.exec("DROP TABLE IF EXISTS audit; CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, action TEXT)");
    await DB.exec("DROP TABLE IF EXISTS cost; CREATE TABLE cost(id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, usd TEXT)");
    await DB.exec("DROP TABLE IF EXISTS version_guard; CREATE TABLE version_guard(ok INTEGER NOT NULL)");
    await DB.exec("INSERT INTO posts VALUES (1, 7, 'PUBLISHING'); INSERT INTO parts VALUES (1, 1, 'SENDING', NULL), (1, 2, 'PENDING', NULL)");
  }
  const commitPart = (v: number, lifecycle: string, k: number, xId: string, last: boolean) => DB.batch([
    DB.prepare("INSERT INTO version_guard(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND version = ?2 AND lifecycle = ?3) THEN 1 ELSE NULL END").bind(1, v, lifecycle),
    DB.prepare("UPDATE parts SET state = 'SENT', x_post_id = ?3 WHERE post_id = ?1 AND k = ?2 AND state = 'SENDING'").bind(1, k, xId),
    DB.prepare("UPDATE posts SET version = version + 1, lifecycle = ?3 WHERE id = ?1 AND version = ?2").bind(1, v, last ? "DONE" : "PUBLISHING"),
    DB.prepare("INSERT INTO audit(post_id, action) VALUES (?1, 'part_sent')").bind(1),
    DB.prepare("INSERT INTO cost(post_id, usd) VALUES (?1, '0.015')").bind(1),
    DB.prepare("DELETE FROM version_guard"),
  ]);
  const snapshot = () => DB.prepare(`SELECT (SELECT version FROM posts) v, (SELECT lifecycle FROM posts) l,
     (SELECT state || ':' || coalesce(x_post_id, '-') FROM parts WHERE k = 1) p1, (SELECT count(*) FROM audit) a,
     (SELECT count(*) FROM cost) c, (SELECT count(*) FROM version_guard) g`).first();
  it("stale version / wrong lifecycle change nothing; the current version commits everything", async () => {
    await schema();
    const out: Record<string, unknown> = {};
    for (const [label, v, l] of [["stale version", 6, "PUBLISHING"], ["wrong lifecycle", 7, "SCHEDULED"]] as const) {
      try { await commitPart(v, l, 1, "x1", false); out[label] = "COMMITTED"; } catch (e) { out[label] = String(e).match(/NOT NULL constraint failed[^:]*/)?.[0] ?? String(e).slice(0, 80); }
      out[label + " -> state"] = await snapshot();
    }
    const res = await commitPart(7, "PUBLISHING", 1, "x1", false);
    out["current -> state"] = await snapshot();
    out["current -> meta.changes"] = res.map((r) => r.meta.changes);
    log("(a)", JSON.stringify(out, null, 1));
    expect(out["stale version -> state"]).toEqual({ v: 7, l: "PUBLISHING", p1: "SENDING:-", a: 0, c: 0, g: 0 });
    expect(out["wrong lifecycle -> state"]).toEqual({ v: 7, l: "PUBLISHING", p1: "SENDING:-", a: 0, c: 0, g: 0 });
    expect(out["current -> state"]).toEqual({ v: 8, l: "PUBLISHING", p1: "SENT:x1", a: 1, c: 1, g: 0 });
  });
  it("two concurrent commitParts with the same expected version: exactly one commits", async () => {
    await schema();
    const r = await Promise.allSettled([commitPart(7, "PUBLISHING", 1, "xA", false), commitPart(7, "PUBLISHING", 1, "xB", false)]);
    const s = await snapshot();
    log("(a) concurrent:", r.map((x) => x.status), JSON.stringify(s));
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
    expect(s).toMatchObject({ v: 8, a: 1, c: 1, g: 0 });
  });
});

describe("(b) two ordered mutexes: publish -> token", () => {
  it("expired token during concurrent publishes + concurrent token users: no deadlock, one refresh", async () => {
    const stub = E.ACCOUNT.get(E.ACCOUNT.idFromName("b1"));
    await stub.setup(true); await resetCount();
    const calls = [
      ...Array.from({ length: 5 }, () => stub.publishNow()),
      ...Array.from({ length: 5 }, () => stub.accessToken()),   // e.g. metrics/reconcile taking only the token lock
    ];
    const r = await withTimeout(Promise.all(calls), 10000);
    const st = await stub.state();
    const refreshes = await refreshCount();
    log("(b) result:", r === "TIMEOUT" ? r : `${new Set(r).size} distinct token(s): ${[...new Set(r)].join(",")}`, "| refreshes:", refreshes, "| state:", JSON.stringify(st));
    expect(r).not.toBe("TIMEOUT"); expect(refreshes).toBe(1); expect(st.sent).toBe(5); expect(new Set(r as string[]).size).toBe(1);
  });
  it("ordered: a token-only path concurrent with publish never deadlocks (deterministic interleaving)", async () => {
    const stub = E.ACCOUNT.get(E.ACCOUNT.idFromName("b3"));
    await stub.setup(true); await resetCount();
    const tokFirst = stub.accessToken(200);                    // holds token (refreshing)
    await new Promise((r) => setTimeout(r, 50));
    const pub = stub.publishNow();                             // holds publish, waits for token
    const r = await withTimeout(Promise.all([tokFirst, pub]), 3000);
    log("(b) token-first then publish:", r, "| refreshes:", await refreshCount());
    expect(r).not.toBe("TIMEOUT");
  });
  it("negative control: one path in the reverse order (token -> publish) deadlocks", async () => {
    const stub = E.ACCOUNT.get(E.ACCOUNT.idFromName("b2"));
    await stub.setup(true); await resetCount();
    const rev = stub.reverseOrder(200);                       // holds token, then wants publish
    await new Promise((r) => setTimeout(r, 50));
    const pub = stub.publishNow();                             // holds publish, then wants token
    const r = await withTimeout(Promise.all([pub, rev]), 3000);
    log("(b) reverse-order control:", r);
    expect(r).toBe("TIMEOUT");
    await abortAllDurableObjects();  // free the wedged object
  });
});

describe("(c) REFRESHING marker survives a reset", () => {
  it("abort during the token call; the next call sees the marker", async () => {
    const id = E.ACCOUNT.idFromName("c1");
    let stub = E.ACCOUNT.get(id);
    await stub.setup(true); await resetCount();
    const pending = stub.accessToken(3000).then((v) => `resolved ${v}`, (e) => `rejected: ${String(e).slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 300));          // the refresh fetch is in flight
    await abortAllDurableObjects();                         // object reset (in-memory locks and state gone)
    const first = await pending;
    stub = E.ACCOUNT.get(id);                               // new stub after the reset
    const st = await stub.state();
    const next = await stub.accessToken();
    log("(c) in-flight call ->", first, "| after reset state:", JSON.stringify(st), "| next accessToken ->", next, "| refreshes sent:", await refreshCount());
    expect(st.marker).toBe(true); expect(st.access).toBe("old"); expect(next).toBe("NEEDS_RECONNECT");
  });
  it("same with ctx.abort() from inside the object", async () => {
    const id = E.ACCOUNT.idFromName("c2");
    let stub = E.ACCOUNT.get(id);
    await stub.setup(true);
    const pending = stub.accessToken(3000).then((v) => `resolved ${v}`, (e) => `rejected: ${String(e).slice(0, 80)}`);
    await new Promise((r) => setTimeout(r, 300));
    const ab = await stub.abortNow().then(() => "abortNow returned", (e) => `abortNow: ${String(e).slice(0, 60)}`);
    const first = await pending;
    stub = E.ACCOUNT.get(id);
    const st = await stub.state();
    log("(c2) ctx.abort ->", ab, "| in-flight ->", first, "| state:", JSON.stringify(st), "| next ->", await stub.accessToken());
    expect(st.marker).toBe(true);
  });
});
