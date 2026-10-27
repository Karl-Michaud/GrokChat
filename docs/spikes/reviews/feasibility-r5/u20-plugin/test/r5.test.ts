import { env, exports } from "cloudflare:workers";
import { describe, it, expect, beforeAll } from "vitest";
import type { Env } from "../src/index";
const E = env as unknown as Env;
const log = (...a: unknown[]) => console.log("[R5]", ...a);

beforeAll(async () => {
  await E.DB.exec("CREATE TABLE IF NOT EXISTS sent(n INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT)");
});

describe("U20 bindings", () => {
  it("D1 and DO bindings work inside the test", async () => {
    const r = await E.DB.prepare("SELECT 41 + 1 AS v").first<{ v: number }>();
    const p = await E.ACCOUNT.get(E.ACCOUNT.idFromName("x")).ping();
    log("U20 D1 ->", r?.v, "DO ->", p);
    expect(r?.v).toBe(42); expect(p).toBe(1);
  });
});

describe("U15 D1 batch", () => {
  it("rolls back the whole batch when a later statement fails", async () => {
    await E.DB.exec("DROP TABLE IF EXISTS b; CREATE TABLE b(id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
    let err = "";
    try {
      await E.DB.batch([
        E.DB.prepare("INSERT INTO b(id, v) VALUES (1, 'first')"),
        E.DB.prepare("INSERT INTO b(id, v) VALUES (2, 'second')"),
        E.DB.prepare("INSERT INTO b(id, v) VALUES (1, 'duplicate pk')"),
      ]);
    } catch (e) { err = String(e).slice(0, 120); }
    const n = await E.DB.prepare("SELECT count(*) AS c FROM b").first<{ c: number }>();
    log("U15 atomic: error =", err, "| rows after failed batch =", n?.c);
    expect(err).not.toBe(""); expect(n?.c).toBe(0);
  });
  it("runs statements in order and later ones see earlier writes", async () => {
    await E.DB.exec("DROP TABLE IF EXISTS o; CREATE TABLE o(id INTEGER PRIMARY KEY, v TEXT)");
    const res = await E.DB.batch([
      E.DB.prepare("INSERT INTO o(id, v) VALUES (1, 'a')"),
      E.DB.prepare("UPDATE o SET v = v || 'b' WHERE id = 1"),
      E.DB.prepare("UPDATE o SET v = v || 'c' WHERE id = 1 RETURNING v"),
      E.DB.prepare("SELECT v FROM o WHERE id = 1"),
    ]);
    log("U15 order: returning =", JSON.stringify(res[2]?.results), "select =", JSON.stringify(res[3]?.results));
    expect((res[3]?.results[0] as { v: string }).v).toBe("abc");
  });
  it("a version-guarded UPDATE that matches 0 rows does NOT fail the batch", async () => {
    await E.DB.exec("DROP TABLE IF EXISTS g; CREATE TABLE g(id INTEGER PRIMARY KEY, version INTEGER, v TEXT)");
    await E.DB.exec("INSERT INTO g VALUES (1, 5, 'x')");
    const res = await E.DB.batch([
      E.DB.prepare("UPDATE g SET v = 'moved', version = version + 1 WHERE id = 1 AND version = 4"),   // stale version
      E.DB.prepare("INSERT INTO g VALUES (2, 0, 'side effect')"),
    ]);
    const rows = await E.DB.prepare("SELECT count(*) AS c FROM g").first<{ c: number }>();
    log("U15 guard: first stmt changes =", res[0]?.meta.changes, "| batch committed rows =", rows?.c);
    expect(res[0]?.meta.changes).toBe(0); expect(rows?.c).toBe(2);
  });
});

async function race(mode: "naive" | "mutex", slow: "fetch" | "timer", useD1: boolean, name: string) {
  const stub = E.ACCOUNT.get(E.ACCOUNT.idFromName(name));
  await stub.reset();
  if (useD1) await E.DB.exec("DELETE FROM sent");
  const results = await Promise.all(Array.from({ length: 10 }, () => stub.publish(mode, 3, slow, useD1)));
  const sent = useD1 ? (await E.DB.prepare("SELECT count(*) AS c FROM sent").first<{ c: number }>())?.c : await stub.sentCount();
  return { accepted: results.filter(Boolean).length, sent };
}
describe("DO async mutex (cap 3, 10 concurrent calls)", () => {
  for (const slow of ["fetch", "timer"] as const) for (const useD1 of [false, true]) {
    it(`slow=${slow} state=${useD1 ? "D1" : "DO SQLite"}`, async () => {
      const naive = await race("naive", slow, useD1, `n-${slow}-${useD1}`);
      const mutex = await race("mutex", slow, useD1, `m-${slow}-${useD1}`);
      log(`mutex slow=${slow} state=${useD1 ? "D1" : "DO-SQLite"}: naive sent=${naive.sent} | mutex sent=${mutex.sent}`);
      expect(mutex.sent).toBe(3); expect(naive.sent).toBeGreaterThan(3);
    });
  }
});

describe("U16 local (limits may not be enforced locally)", () => {
  it("60 DO calls + 60 D1 queries + 60 fetches in one Worker invocation", async () => {
    const r = await (exports as any).default.fetch("http://x/burst?n=60");
    log("U16 local burst:", await r.text());
  });
});

describe("U18 local fetch to private addresses", () => {
  it("records what local workerd does", async () => {
    const stub = E.ACCOUNT.get(E.ACCOUNT.idFromName("ssrf"));
    for (const u of ["http://127.0.0.1:18799/?fast=1", "http://localhost:18799/?fast=1", "http://[::1]:18799/?fast=1", "http://10.255.255.1/", "http://169.254.169.254/latest/meta-data/"]) {
      log("U18", u, "->", await stub.tryFetch(u));
    }
  }, 30000);
});
