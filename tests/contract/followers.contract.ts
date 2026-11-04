/** The follower snapshot's once-a-day store (GROKCHAT-15), for the stub and the D1 driver. */
import { expect, it } from "vitest";
import { accountId, xUserId } from "../../src/entities/identity/ids";
import type { FollowerSnapshot } from "../../src/entities/metrics/follower_snapshot";
import type { AccountRepository } from "../../src/use_cases/ports/account_repository";
import type { FollowerDays, FollowerSchedule } from "../../src/use_cases/ports/follower_days";
import { ACCOUNT, anAccount, OTHER_ACCOUNT, T0 } from "../unit/support/builders";

export interface FollowerStoreHarness {
  readonly store: FollowerDays & FollowerSchedule;
  readonly accounts: AccountRepository;
}

const DAY_1 = "2026-10-27";
const DAY_2 = "2026-10-28";

const counts = (account = ACCOUNT, day = DAY_1, followers = 10): FollowerSnapshot => ({
  accountId: account,
  day,
  takenAt: T0,
  followers,
  following: 1,
  posts: 2,
  listed: 0,
});

export function followerStoreContract(make: () => FollowerStoreHarness): void {
  it("claims an account's day once; another day or account is its own claim", async () => {
    const { store } = make();
    expect(await store.claim(ACCOUNT, DAY_1, T0)).toBe(true);
    expect(await store.claim(ACCOUNT, DAY_1, T0 + 1)).toBe(false);
    expect(await store.claim(ACCOUNT, DAY_2, T0)).toBe(true);
    expect(await store.claim(OTHER_ACCOUNT, DAY_1, T0)).toBe(true);
  });

  it("a released claim can be claimed again; a recorded one is never released", async () => {
    const { store } = make();
    await store.claim(ACCOUNT, DAY_1, T0);
    await store.release(ACCOUNT, DAY_1);
    expect(await store.claim(ACCOUNT, DAY_1, T0)).toBe(true);
    await store.record(counts());
    await store.release(ACCOUNT, DAY_1);
    expect(await store.claim(ACCOUNT, DAY_1, T0)).toBe(false);
  });

  it("lists the connected accounts whose day is not claimed, by id", async () => {
    const { store, accounts } = make();
    const account = (
      id: string,
      status: "ACTIVE" | "PAUSED" | "NEEDS_RECONNECT" | "DISCONNECTED",
    ) => accounts.save(anAccount({ id: accountId(id), xUserId: xUserId(`x-${id}`), status }));
    await account("b-active", "ACTIVE");
    await account("a-paused", "PAUSED");
    await account("c-lost", "NEEDS_RECONNECT");
    await account("d-gone", "DISCONNECTED");
    expect(await store.accountsDue(DAY_1)).toStrictEqual([
      accountId("a-paused"),
      accountId("b-active"),
    ]);
    await store.claim(accountId("a-paused"), DAY_1, T0);
    expect(await store.accountsDue(DAY_1)).toStrictEqual([accountId("b-active")]);
    expect(await store.accountsDue(DAY_2)).toHaveLength(2);
  });
}
