/** Contracts for the audit log, the cost ledger, metrics, OAuth state, the login throttle and tokens. */
import { expect, it } from "vitest";
import { accountId, postId, xPostId } from "../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../src/entities/metrics/metrics_snapshot";
import { HOUR, MINUTE } from "../../src/entities/time/instant";
import type { AuditLog } from "../../src/use_cases/ports/audit_log";
import type { CostLedger } from "../../src/use_cases/ports/cost_ledger";
import type { LoginThrottle } from "../../src/use_cases/ports/login_throttle";
import type { MetricsRepository } from "../../src/use_cases/ports/metrics_repository";
import type { OAuthStateStore } from "../../src/use_cases/ports/oauth_state_store";
import type { TokenStore } from "../../src/use_cases/ports/token_store";
import { ACCOUNT, OTHER_ACCOUNT, T0 } from "../unit/support/builders";

const event = (at: number, account = ACCOUNT, post: string | null = null) => ({
  at,
  actor: "human:owner",
  action: "a",
  accountId: account,
  postId: post === null ? null : postId(post),
  detail: "",
});

export function auditLogContract(make: () => AuditLog): void {
  it("lists newest first, filtered by account, post and window, up to a limit", async () => {
    const log = make();
    await log.append(event(T0));
    await log.append(event(T0 + 1, OTHER_ACCOUNT, "p"));
    await log.append(event(T0 + 2, ACCOUNT, "p"));
    expect((await log.list({})).map((e) => e.at)).toStrictEqual([T0 + 2, T0 + 1, T0]);
    expect((await log.list({ accountId: ACCOUNT })).map((e) => e.at)).toStrictEqual([T0 + 2, T0]);
    expect((await log.list({ postId: postId("p") })).map((e) => e.at)).toStrictEqual([
      T0 + 2,
      T0 + 1,
    ]);
    expect(
      (await log.list({ window: { from: T0 + 1, to: T0 + 2 } })).map((e) => e.at),
    ).toStrictEqual([T0 + 1]);
    expect((await log.list({ limit: 1 })).map((e) => e.at)).toStrictEqual([T0 + 2]);
  });
}

export function costLedgerContract(make: () => CostLedger): void {
  it("totals over a window, for one account or all", async () => {
    const ledger = make();
    const entry = (at: number, account = ACCOUNT, micros: number | null = 10) =>
      ({
        at,
        accountId: account,
        operation: "read",
        estimate:
          micros === null ? ({ kind: "unknown" } as const) : ({ kind: "usd", micros } as const),
      }) as const;
    await ledger.append(entry(T0));
    await ledger.append(entry(T0 + 1, OTHER_ACCOUNT, 5));
    await ledger.append(entry(T0 + 2, ACCOUNT, null));
    await ledger.append(entry(T0 + HOUR));
    const window = { from: T0, to: T0 + HOUR };
    expect(await ledger.totals(window, null)).toStrictEqual({
      micros: 15,
      calls: 3,
      unknownPriced: 1,
    });
    expect(await ledger.totals(window, ACCOUNT)).toStrictEqual({
      micros: 10,
      calls: 2,
      unknownPriced: 1,
    });
  });
}

const snapshot = (id: string, takenAt: number, account = ACCOUNT): MetricsSnapshot => ({
  xPostId: xPostId(id),
  accountId: account,
  takenAt,
  impressions: 1,
  likes: 2,
  reposts: 3,
  replies: 4,
  quotes: 5,
  bookmarks: 6,
  urlLinkClicks: null,
  userProfileClicks: 7,
});

export function metricsRepositoryContract(make: () => MetricsRepository): void {
  it("series by account and window, oldest first; latest per post", async () => {
    const repo = make();
    await repo.addSnapshots([
      snapshot("a", T0 + 2),
      snapshot("a", T0),
      snapshot("b", T0 + 1),
      snapshot("c", T0, OTHER_ACCOUNT),
    ]);
    const series = await repo.series(ACCOUNT, { from: T0, to: T0 + 2 });
    expect(series).toStrictEqual([snapshot("a", T0), snapshot("b", T0 + 1)]);
    expect(await repo.latest([xPostId("a"), xPostId("c")])).toStrictEqual([
      snapshot("a", T0 + 2),
      snapshot("c", T0, OTHER_ACCOUNT),
    ]);
    expect(await repo.latest([])).toStrictEqual([]);
  });
}

export function oauthStateContract(make: () => OAuthStateStore): void {
  it("a state is taken once, by its own session, before it expires", async () => {
    const store = make();
    await store.put({ state: "s1", verifier: "v1", sessionId: "me", expiresAt: T0 + MINUTE });
    expect(await store.take("s1", "other", T0)).toBeNull();
    expect(await store.take("s1", "me", T0)).toBeNull();
    await store.put({ state: "s2", verifier: "v2", sessionId: "me", expiresAt: T0 + MINUTE });
    expect(await store.take("s2", "me", T0)).toBe("v2");
    expect(await store.take("s2", "me", T0)).toBeNull();
    await store.put({ state: "s3", verifier: "v3", sessionId: "me", expiresAt: T0 + MINUTE });
    expect(await store.take("s3", "me", T0 + MINUTE)).toBeNull();
    expect(await store.take("unknown", "me", T0)).toBeNull();
  });
}

export function loginThrottleContract(make: () => LoginThrottle): void {
  it("five failures in fifteen minutes block the key, and only that key", async () => {
    const throttle = make();
    for (let i = 0; i < 4; i += 1) {
      await throttle.recordFailure("ip-1", T0 + i);
    }
    expect(await throttle.allow("ip-1", T0 + 5)).toBe(true);
    await throttle.recordFailure("ip-1", T0 + 5);
    expect(await throttle.allow("ip-1", T0 + 6)).toBe(false);
    expect(await throttle.allow("ip-2", T0 + 6)).toBe(true);
    expect(await throttle.allow("ip-1", T0 + 15 * MINUTE + 5)).toBe(true);
  });
}

export function tokenStoreContract(make: () => TokenStore): void {
  it("commit stores and clears the marker; mark and clear change only the marker", async () => {
    const store = make();
    const account = accountId("acc-t");
    expect(await store.load(account)).toBeNull();
    await store.markRefreshing(account, T0);
    await store.clearMarker(account);
    expect(await store.load(account)).toBeNull();
    const tokens = { accessToken: "a", refreshToken: "r", accessExpiresAt: T0 + HOUR };
    await store.commitRotated(account, tokens);
    await store.markRefreshing(account, T0 + 1);
    expect(await store.load(account)).toStrictEqual({ tokens, refreshingSince: T0 + 1 });
    await store.clearMarker(account);
    expect(await store.load(account)).toStrictEqual({ tokens, refreshingSince: null });
    await store.markRefreshing(account, T0 + 2);
    await store.commitRotated(account, { ...tokens, refreshToken: "r2" });
    expect(await store.load(account)).toStrictEqual({
      tokens: { ...tokens, refreshToken: "r2" },
      refreshingSince: null,
    });
  });
}
