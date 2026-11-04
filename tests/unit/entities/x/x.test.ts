import { describe, expect, it } from "vitest";
import { refreshOutcome, type RefreshResult } from "../../../../src/entities/x/refresh_outcome";
import type { XFailure } from "../../../../src/entities/x/x_failure";
import { DEFAULT_RETRY, mapXOutcome } from "../../../../src/entities/x/x_outcome";
import { MINUTE } from "../../../../src/entities/time/instant";
import { T0 } from "../../support/builders";

const http = (
  status: number,
  extra: Partial<Extract<XFailure, { kind: "http" }>> = {},
): XFailure => ({
  kind: "http",
  status,
  detail: "why",
  retryAt: null,
  scope: "user",
  ...extra,
});

describe("mapXOutcome", () => {
  it("not sent → retryable in a minute", () => {
    expect(mapXOutcome({ kind: "not_sent" }, T0)).toStrictEqual({
      kind: "retryable",
      retryAt: T0 + MINUTE,
    });
    expect(DEFAULT_RETRY).toBe(MINUTE);
  });

  it("no response and 5xx → unknown (never re-sent)", () => {
    expect(mapXOutcome({ kind: "no_response" }, T0)).toStrictEqual({ kind: "unknown" });
    expect(mapXOutcome(http(500), T0)).toStrictEqual({ kind: "unknown" });
    expect(mapXOutcome(http(503), T0)).toStrictEqual({ kind: "unknown" });
  });

  it("429 → rate-limited for the user or the whole app, at X's retry time or in a minute", () => {
    expect(mapXOutcome(http(429, { scope: "app", retryAt: T0 + 5 }), T0)).toStrictEqual({
      kind: "app_rate_limited",
      retryAt: T0 + 5,
    });
    expect(mapXOutcome(http(429), T0)).toStrictEqual({
      kind: "rate_limited",
      retryAt: T0 + MINUTE,
    });
    expect(mapXOutcome(http(429, { scope: "app" }), T0)).toStrictEqual({
      kind: "app_rate_limited",
      retryAt: T0 + MINUTE,
    });
  });

  it("a detail is kept as X sent it unless it carries a credential", () => {
    expect(mapXOutcome(http(400, { detail: "Stryker was here" }), T0)).toStrictEqual({
      kind: "rejected",
      reason: "x_400: Stryker was here",
    });
  });

  it("401 and an auth 403 → needs reconnect, never rejected", () => {
    expect(mapXOutcome(http(401), T0)).toStrictEqual({ kind: "needs_reconnect" });
    expect(mapXOutcome(http(403), T0)).toStrictEqual({ kind: "needs_reconnect" });
  });

  it("no usable token → needs reconnect (nothing was sent)", () => {
    expect(mapXOutcome({ kind: "no_token" }, T0)).toStrictEqual({ kind: "needs_reconnect" });
  });

  it("a content 403 (duplicate or forbidden content) → rejected with its detail, redacted", () => {
    expect(
      mapXOutcome({ kind: "content_refused", status: 403, detail: "duplicate content" }, T0),
    ).toStrictEqual({ kind: "rejected", reason: "x_403: duplicate content" });
    expect(
      mapXOutcome({ kind: "content_refused", status: 400, detail: "Bearer abc" }, T0),
    ).toStrictEqual({ kind: "rejected", reason: "x_400: Bearer [redacted]" });
  });

  it("any other status → rejected with the status and detail", () => {
    expect(mapXOutcome(http(400, { detail: "bad text" }), T0)).toStrictEqual({
      kind: "rejected",
      reason: "x_400: bad text",
    });
    expect(mapXOutcome(http(499), T0)).toStrictEqual({ kind: "rejected", reason: "x_499: why" });
    expect(mapXOutcome(http(400, { detail: "echo Bearer abc.def" }), T0)).toStrictEqual({
      kind: "rejected",
      reason: "x_400: echo Bearer [redacted]",
    });
  });
});

describe("refreshOutcome (U1, U14)", () => {
  const tokens = { accessToken: "a2", refreshToken: "r2", accessExpiresAt: T0 };
  const failed: RefreshResult = { kind: "failed" };

  it("rotated → the new tokens", () => {
    expect(refreshOutcome({ kind: "rotated", tokens }, "r1", "r1", false)).toStrictEqual({
      kind: "rotated",
      tokens,
    });
  });

  it("not sent → retryable before send", () => {
    expect(refreshOutcome({ kind: "not_sent" }, "r1", "r1", false)).toStrictEqual({
      kind: "retryable_before_send",
    });
  });

  it("failed with the stored token unchanged → lost", () => {
    expect(refreshOutcome(failed, "r1", "r1", false)).toStrictEqual({ kind: "lost" });
  });

  it("failed but the stored token changed → retry once with it, then lost", () => {
    expect(refreshOutcome(failed, "r1", "r9", false)).toStrictEqual({
      kind: "retry_with_stored",
      refreshToken: "r9",
    });
    expect(refreshOutcome(failed, "r1", "r9", true)).toStrictEqual({ kind: "lost" });
  });

  it("failed with nothing stored → lost", () => {
    expect(refreshOutcome(failed, "r1", null, false)).toStrictEqual({ kind: "lost" });
  });
});
