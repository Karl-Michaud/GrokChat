import { DurableObject } from "cloudflare:workers";

export interface Env { DB: D1Database; ACCOUNT: DurableObjectNamespace<AccountPublisher>; SLOW_URL: string }

/** Promise-chain mutex: each run waits for the previous one, errors don't break the chain. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

export class AccountPublisher extends DurableObject<Env> {
  private mutex = new Mutex();
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS sent(n INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT)");
  }
  reset(): void { this.sql.exec("DELETE FROM sent"); }
  sentCount(): number { return this.sql.exec("SELECT count(*) AS c FROM sent").one().c as number; }

  /** check cap -> slow outbound "X call" -> record. Naive: no serialisation. */
  private async publishStep(cap: number, slow: "fetch" | "timer", useD1: boolean): Promise<boolean> {
    const count = useD1
      ? ((await this.env.DB.prepare("SELECT count(*) AS c FROM sent").first<{ c: number }>())?.c ?? 0)
      : this.sentCount();
    if (count >= cap) return false;
    if (slow === "fetch") await (await fetch(this.env.SLOW_URL)).text();
    else await new Promise((r) => setTimeout(r, 20));
    if (useD1) await this.env.DB.prepare("INSERT INTO sent(at) VALUES (?)").bind(new Date().toISOString()).run();
    else this.sql.exec("INSERT INTO sent(at) VALUES (?)", new Date().toISOString());
    return true;
  }
  async publish(mode: "naive" | "mutex", cap: number, slow: "fetch" | "timer", useD1: boolean): Promise<boolean> {
    return mode === "mutex" ? this.mutex.run(() => this.publishStep(cap, slow, useD1)) : this.publishStep(cap, slow, useD1);
  }
  async ping(): Promise<number> { return 1; }
  async d1Burst(n: number): Promise<number> {
    let ok = 0;
    for (let i = 0; i < n; i++) { await this.env.DB.prepare("SELECT ?1 AS v").bind(i).first(); ok++; }
    return ok;
  }
  async tryFetch(url: string): Promise<string> {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return `status ${r.status}`; }
    catch (e) { return `error ${(e as Error).name}: ${(e as Error).message}`.slice(0, 160); }
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname === "/burst") {   // U16 probe: n DO calls + n D1 queries in ONE Worker invocation
      const n = Number(u.searchParams.get("n") ?? "60");
      const out: Record<string, string> = {};
      let doOk = 0, d1Ok = 0;
      try { for (let i = 0; i < n; i++) { await env.ACCOUNT.get(env.ACCOUNT.idFromName(`a${i}`)).ping(); doOk++; } } catch (e) { out.doErr = String(e); }
      try { for (let i = 0; i < n; i++) { await env.DB.prepare("SELECT ?1 AS v").bind(i).first(); d1Ok++; } } catch (e) { out.d1Err = String(e); }
      let subOk = 0;
      try { for (let i = 0; i < n; i++) { await (await fetch(env.SLOW_URL + "?fast=1")).text(); subOk++; } } catch (e) { out.subErr = String(e); }
      let doD1 = 0;
      try { doD1 = await env.ACCOUNT.get(env.ACCOUNT.idFromName("burst")).d1Burst(n); } catch (e) { out.doD1Err = String(e); }
      return Response.json({ n, doOk, d1Ok, subOk, doD1, ...out });
    }
    return new Response("ok");
  },
} satisfies ExportedHandler<Env>;
