/** A failed create, reply or not (GROKCHAT-17, incident 2026-10-28). */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { XFailure } from "../../../../src/entities/x/x_failure";
import {
  createFailureDetail,
  mapCreateOutcome,
  mapXOutcome,
  REPLY_REFUSED,
  type XOutcome,
} from "../../../../src/entities/x/x_outcome";
import { T0 } from "../../support/builders";

/** X's wording for a reply to an author who never engaged with the account (2026-10-28). */
const REAL_DETAIL =
  "Forbidden: You are not permitted to perform this action. Reply to this conversation is not allowed";

const http = (status: number, detail = "why"): XFailure => ({
  kind: "http",
  status,
  detail,
  retryAt: null,
  scope: "user",
});

const failures: fc.Arbitrary<XFailure> = fc.oneof(
  fc.constant<XFailure>({ kind: "not_sent" }),
  fc.constant<XFailure>({ kind: "no_response" }),
  fc.constant<XFailure>({ kind: "no_token" }),
  fc.record({
    kind: fc.constant("http" as const),
    status: fc.integer({ min: 400, max: 599 }),
    detail: fc.string({ maxLength: 40 }),
    retryAt: fc.constantFrom(null, T0 + 5),
    scope: fc.constantFrom("user" as const, "app" as const),
  }),
  fc.record({
    kind: fc.constant("content_refused" as const),
    status: fc.integer({ min: 400, max: 499 }),
    detail: fc.string({ maxLength: 40 }),
  }),
);

describe("mapCreateOutcome", () => {
  it("a 403 on a reply is a refused reply, never a reconnect: auth-looking or content", () => {
    const rejected = { kind: "rejected", reason: REPLY_REFUSED };
    expect(mapCreateOutcome(http(403), T0, true)).toStrictEqual(rejected);
    expect(mapCreateOutcome(http(403, REAL_DETAIL), T0, true)).toStrictEqual(rejected);
    expect(
      mapCreateOutcome({ kind: "content_refused", status: 403, detail: "duplicate" }, T0, true),
    ).toStrictEqual(rejected);
    expect(REPLY_REFUSED).toBe("reply_refused");
  });

  it("a 403 on an original post keeps today's mapping: reconnect, or rejected for content", () => {
    expect(mapCreateOutcome(http(403), T0, false)).toStrictEqual({ kind: "needs_reconnect" });
    expect(
      mapCreateOutcome({ kind: "content_refused", status: 403, detail: "duplicate" }, T0, false),
    ).toStrictEqual({ kind: "rejected", reason: "x_403: duplicate" });
  });

  it("a 401 on a reply is still a reconnect; other statuses on a reply map as any create", () => {
    expect(mapCreateOutcome(http(401), T0, true)).toStrictEqual({ kind: "needs_reconnect" });
    expect(mapCreateOutcome(http(400), T0, true)).toStrictEqual({
      kind: "rejected",
      reason: "x_400: why",
    });
    expect(
      mapCreateOutcome({ kind: "content_refused", status: 400, detail: "media" }, T0, true),
    ).toStrictEqual({ kind: "rejected", reason: "x_400: media" });
  });

  it("property: a reply never maps to needs_reconnect on a 403, and a non-reply is mapXOutcome", () => {
    fc.assert(
      fc.property(failures, fc.boolean(), (failure, reply) => {
        const outcome = mapCreateOutcome(failure, T0, reply);
        if (!reply) {
          expect(outcome).toStrictEqual(mapXOutcome(failure, T0));
          return;
        }
        const forbidden = "status" in failure && failure.status === 403;
        expect(outcome).toStrictEqual(
          forbidden ? { kind: "rejected", reason: REPLY_REFUSED } : mapXOutcome(failure, T0),
        );
      }),
    );
  });
});

describe("createFailureDetail", () => {
  it("names a refused reply and carries X's status and wording", () => {
    const failure = http(403, REAL_DETAIL);
    expect(createFailureDetail(mapCreateOutcome(failure, T0, true), failure)).toBe(
      `reply_refused: x_403: ${REAL_DETAIL}`,
    );
  });

  it("every outcome kind carries X's detail when X answered", () => {
    const cases: readonly [XOutcome, XFailure, string][] = [
      [
        { kind: "needs_reconnect" },
        http(401, "Unauthorized"),
        "needs_reconnect: x_401: Unauthorized",
      ],
      [{ kind: "rejected", reason: "x_400: bad" }, http(400, "bad"), "rejected: x_400: bad"],
      [
        { kind: "rejected", reason: "x_403: dup" },
        { kind: "content_refused", status: 403, detail: "dup" },
        "rejected: x_403: dup",
      ],
      [
        { kind: "rate_limited", retryAt: T0 },
        http(429, "Too Many"),
        "rate_limited: x_429: Too Many",
      ],
      [{ kind: "unknown" }, http(503, "down"), "unknown: x_503: down"],
    ];
    for (const [outcome, failure, detail] of cases) {
      expect(createFailureDetail(outcome, failure)).toBe(detail);
    }
  });

  it("without an answer from X it is the outcome's kind alone", () => {
    expect(createFailureDetail({ kind: "unknown" }, { kind: "no_response" })).toBe("unknown");
    expect(createFailureDetail({ kind: "retryable", retryAt: T0 }, { kind: "not_sent" })).toBe(
      "retryable",
    );
    expect(createFailureDetail({ kind: "needs_reconnect" }, { kind: "no_token" })).toBe(
      "needs_reconnect",
    );
  });

  it("a rejection for another reason is not called a refused reply", () => {
    expect(
      createFailureDetail({ kind: "rejected", reason: "reply_refusedX" }, { kind: "not_sent" }),
    ).toBe("rejected");
  });

  it("redacts credentials that slip into a detail", () => {
    expect(createFailureDetail({ kind: "needs_reconnect" }, http(401, "Bearer abc123"))).toBe(
      "needs_reconnect: x_401: Bearer [redacted]",
    );
  });
});
