import { DurableObject } from "cloudflare:workers";
export interface Env { DB: D1Database; ACCOUNT: DurableObjectNamespace<AccountPublisher>; SLOW_URL: string }

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
type Tok = { access: string; expiresAt: number };

export class AccountPublisher extends DurableObject<Env> {
  private publishLock = new Mutex();
  private tokenLock = new Mutex();
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS tok(id INTEGER PRIMARY KEY CHECK (id = 1), access TEXT, expires_at INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS marker(id INTEGER PRIMARY KEY CHECK (id = 1), attempt_at INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sent(n INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT)");
  }
  setup(expired: boolean): void {
    this.sql.exec("DELETE FROM tok; DELETE FROM marker; DELETE FROM sent");
    this.sql.exec("INSERT INTO tok VALUES (1, 'old', ?)", expired ? Date.now() - 1000 : Date.now() + 3_600_000);
  }
  state(): { access: string; marker: boolean; sent: number } {
    const t = this.sql.exec("SELECT access FROM tok").one();
    const m = this.sql.exec("SELECT count(*) c FROM marker").one().c as number;
    const s = this.sql.exec("SELECT count(*) c FROM sent").one().c as number;
    return { access: t.access as string, marker: m > 0, sent: s };
  }
  /** load -> (marker check) -> refresh -> persist, under the token lock only */
  async accessToken(refreshMs = 50): Promise<string> {
    return this.tokenLock.run(async () => {
      if ((this.sql.exec("SELECT count(*) c FROM marker").one().c as number) > 0) return "NEEDS_RECONNECT";
      const t = this.sql.exec("SELECT access, expires_at FROM tok").one();
      if ((t.expires_at as number) - Date.now() > 600_000) return t.access as string;
      this.sql.exec("INSERT INTO marker VALUES (1, ?)", Date.now());          // persisted before the call leaves (output gate)
      await (await fetch(`${this.env.SLOW_URL}refresh?ms=${refreshMs}`)).text();  // the X token call (slow)
      const fresh = `new-${crypto.randomUUID().slice(0, 8)}`;
      this.sql.exec("UPDATE tok SET access = ?, expires_at = ?", fresh, Date.now() + 7_200_000);
      this.sql.exec("DELETE FROM marker");
      return fresh;
    });
  }
  /** publish -> token order */
  async publishNow(): Promise<string> {
    return this.publishLock.run(async () => {
      const tok = await this.accessToken();
      if (tok === "NEEDS_RECONNECT") return tok;
      await (await fetch(`${this.env.SLOW_URL}?ms=20`)).text();            // the X create call
      this.sql.exec("INSERT INTO sent(token) VALUES (?)", tok);
      return tok;
    });
  }
  /** negative control: a path that takes token -> publish (reverse order) */
  async reverseOrder(holdMs = 200): Promise<string> {
    return this.tokenLock.run(async () => {
      await new Promise((r) => setTimeout(r, holdMs));
      return this.publishLock.run(async () => "reverse-done");
    });
  }
  async abortNow(): Promise<void> { this.ctx.abort("simulated reset"); }
}
export default { async fetch(): Promise<Response> { return new Response("ok"); } } satisfies ExportedHandler<Env>;
