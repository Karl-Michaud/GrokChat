import { env } from "cloudflare:workers";
import { it, expect } from "vitest";
const DB = (env as any).DB as D1Database;
const log = (...a: unknown[]) => console.log("[R5]", ...a);

it("U15b: a guard row that fails NOT NULL aborts the whole batch on a stale version", async () => {
  await DB.exec("DROP TABLE IF EXISTS posts; CREATE TABLE posts(id INTEGER PRIMARY KEY, version INTEGER NOT NULL, lifecycle TEXT NOT NULL)");
  await DB.exec("DROP TABLE IF EXISTS parts; CREATE TABLE parts(post_id INTEGER, k INTEGER, state TEXT, PRIMARY KEY(post_id, k))");
  await DB.exec("DROP TABLE IF EXISTS version_guard; CREATE TABLE version_guard(ok INTEGER NOT NULL)");
  await DB.exec("INSERT INTO posts VALUES (1, 5, 'PUBLISHING'); INSERT INTO parts VALUES (1, 1, 'PENDING')");
  const reserve = (expected: number) => [
    // fails the batch with NOT NULL constraint when the post is not at the expected version/lifecycle
    DB.prepare("INSERT INTO version_guard(ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM posts WHERE id = ?1 AND version = ?2 AND lifecycle = 'PUBLISHING') THEN 1 ELSE NULL END").bind(1, expected),
    DB.prepare("UPDATE posts SET version = version + 1 WHERE id = ?1 AND version = ?2").bind(1, expected),
    DB.prepare("UPDATE parts SET state = 'SENDING' WHERE post_id = ?1 AND k = 1 AND state = 'PENDING'").bind(1),
    DB.prepare("DELETE FROM version_guard"),
  ];
  let stale = "";
  try { await DB.batch(reserve(4)); } catch (e) { stale = String(e).slice(0, 90); }
  const afterStale = await DB.prepare("SELECT (SELECT version FROM posts) v, (SELECT state FROM parts) s").first();
  const ok = await DB.batch(reserve(5));
  const afterOk = await DB.prepare("SELECT (SELECT version FROM posts) v, (SELECT state FROM parts) s, (SELECT count(*) FROM version_guard) g").first();
  log("U15b stale version ->", stale, "| state after:", JSON.stringify(afterStale), "| current version ->", JSON.stringify(afterOk), ok.length);
  expect(stale).toContain("NOT NULL"); expect(afterStale).toEqual({ v: 5, s: "PENDING" }); expect(afterOk).toEqual({ v: 6, s: "SENDING", g: 0 });
});

it("U15c: naive guarded batch (no abort) commits the part write even when the post guard misses", async () => {
  await DB.exec("UPDATE posts SET version = 5; UPDATE parts SET state = 'PENDING'");
  const res = await DB.batch([
    DB.prepare("UPDATE posts SET version = version + 1 WHERE id = 1 AND version = 4"),
    DB.prepare("UPDATE parts SET state = 'SENDING' WHERE post_id = 1 AND k = 1"),
  ]);
  const s = await DB.prepare("SELECT (SELECT version FROM posts) v, (SELECT state FROM parts) s").first();
  log("U15c naive: post changes =", res[0]?.meta.changes, "| after:", JSON.stringify(s));
});

it("PBKDF2 in workerd: iteration cap and cost", async () => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("correct horse"), "PBKDF2", false, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  for (const iterations of [100_000, 100_001, 600_000]) {
    const t = performance.now();
    try { await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256); log(`PBKDF2 ${iterations}: ok`); }
    catch (e) { log(`PBKDF2 ${iterations}: ${String(e).slice(0, 120)}`); }
    void t;
  }
});
