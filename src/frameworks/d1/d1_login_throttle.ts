import type { Instant } from "../../entities/time/instant";
import type { LoginThrottle } from "../../use_cases/ports/login_throttle";
import { LOGIN_FAILURES, LOGIN_WINDOW } from "../memory/memory_auth";

interface CountRow {
  readonly failures: number;
}

/** Failed logins per key in D1, with the stub's limits (five per key in fifteen minutes). */
export class D1LoginThrottle implements LoginThrottle {
  constructor(private readonly db: D1Database) {}

  async allow(key: string, now: Instant): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS failures FROM login_failures WHERE key = ?1 AND at > ?2")
      .bind(key, now - LOGIN_WINDOW)
      .first<CountRow>();
    return (row?.failures ?? 0) < LOGIN_FAILURES;
  }

  /** Also drops the key's failures that have left the window, so the table stays small. */
  async recordFailure(key: string, now: Instant): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("DELETE FROM login_failures WHERE key = ?1 AND at <= ?2")
        .bind(key, now - LOGIN_WINDOW),
      this.db.prepare("INSERT INTO login_failures (key, at) VALUES (?1, ?2)").bind(key, now),
    ]);
  }
}
