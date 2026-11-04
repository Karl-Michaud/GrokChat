import { describe, expect, it } from "vitest";
import { TOKEN_REFRESH_MILLIS } from "../../../../src/entities/budget/budget";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { REFRESH_MARGIN } from "../../../../src/use_cases/run_services/refreshing_token_provider";
import { ACCOUNT, T0 } from "../../support/builders";
import { makeWorld } from "../../support/world";

describe("RefreshingTokenProvider (A1, A2, U1, U14)", () => {
  it("returns the stored token while more than ten minutes remain", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(REFRESH_MARGIN).toBe(10 * MINUTE);
    world.clock.advance(2 * HOUR - REFRESH_MARGIN);
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "token",
      accessToken: "access-1",
    });
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
  });

  it("refreshes inside the margin, stores the rotated set and clears the marker", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(2 * HOUR - REFRESH_MARGIN + 1);
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "token",
      accessToken: "access-2",
    });
    expect(await world.tokenStore.load(ACCOUNT)).toStrictEqual({
      tokens: {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        accessExpiresAt: world.clock.now() + 2 * HOUR,
      },
      refreshingSince: null,
    });
  });

  it("a refresh that does not fit before the deadline is not started", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(2 * HOUR);
    const now = world.clock.now();
    expect(await world.tokens.accessToken(ACCOUNT, now + TOKEN_REFRESH_MILLIS - 1)).toStrictEqual({
      kind: "refresh_does_not_fit",
    });
    expect((await world.tokens.accessToken(ACCOUNT, now + TOKEN_REFRESH_MILLIS)).kind).toBe(
      "token",
    );
  });

  it("five concurrent callers with an expired token: one refresh, the same rotated token (R3)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => world.tokens.accessToken(ACCOUNT, T0 + DAY)),
    );
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1"]);
    expect(new Set(results.map((result) => JSON.stringify(result)))).toStrictEqual(
      new Set([JSON.stringify({ kind: "token", accessToken: "access-2" })]),
    );
  });

  it("negative control: without the token lock the same callers replay a spent token", async () => {
    const world = makeWorld({ locks: "none" });
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => world.tokens.accessToken(ACCOUNT, T0 + DAY)),
    );
    expect(world.tokenEndpoint.calls.length).toBeGreaterThan(1);
    expect(results.some((result) => result.kind === "needs_reconnect")).toBe(true);
  });

  it("a lost response after X rotated: NEEDS_RECONNECT, the marker stays, no further refresh (R18)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    world.tokenEndpoint.failNext = "lost_response";
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect((await world.tokenStore.load(ACCOUNT))?.refreshingSince).toBe(world.clock.now());
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1"]);
  });

  it("a marker found on entry means a refresh was interrupted: NEEDS_RECONNECT without a call", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.tokenStore.markRefreshing(ACCOUNT, T0);
    world.clock.advance(3 * HOUR);
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
    expect(world.tokenEndpoint.calls).toStrictEqual([]);
  });

  it("a request that never left: unavailable, marker cleared, the old token still good", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    world.tokenEndpoint.failNext = "not_sent";
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "unavailable",
    });
    expect((await world.tokenStore.load(ACCOUNT))?.refreshingSince).toBeNull();
    expect((await world.tokens.accessToken(ACCOUNT, T0 + DAY)).kind).toBe("token");
  });

  it("a failure while a reconnect stored a newer token: retried once with the stored one", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    const fresh = world.tokenEndpoint.issue();
    const refresh = world.tokenEndpoint.refresh.bind(world.tokenEndpoint);
    world.tokenEndpoint.refresh = async (token) => {
      const result = await refresh(token);
      if (token === "refresh-1") {
        await world.tokenStore.commitRotated(ACCOUNT, fresh);
        return { kind: "failed" };
      }
      return result;
    };
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "token",
      accessToken: "access-4",
    });
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1", "refresh-2"]);
  });

  it("tokens deleted during a failed refresh: lost, NEEDS_RECONNECT", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.clock.advance(3 * HOUR);
    world.tokenEndpoint.refresh = () => {
      world.tokenStore.rows.clear();
      return Promise.resolve({ kind: "failed" });
    };
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
  });

  it("no stored tokens: NEEDS_RECONNECT", async () => {
    const world = makeWorld();
    expect(await world.tokens.accessToken(ACCOUNT, T0 + DAY)).toStrictEqual({
      kind: "needs_reconnect",
    });
  });
});
