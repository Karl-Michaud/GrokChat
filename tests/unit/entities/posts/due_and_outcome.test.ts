import { describe, expect, it } from "vitest";
import { compareDue, dueAt, isDue } from "../../../../src/entities/posts/due";
import { eventForOutcome } from "../../../../src/entities/posts/outcome_event";
import { LIFECYCLES } from "../../../../src/entities/posts/post";
import { MINUTE } from "../../../../src/entities/time/instant";
import { aPost, T0 } from "../../support/builders";

describe("dueAt and isDue", () => {
  it("SCHEDULED at max(publishAt, resumeAt), RESUMING at resumeAt, everything else never", () => {
    expect(dueAt(aPost({ lifecycle: "SCHEDULED", publishAt: T0, resumeAt: null }))).toBe(T0);
    expect(dueAt(aPost({ lifecycle: "SCHEDULED", publishAt: T0, resumeAt: T0 + 9 }))).toBe(T0 + 9);
    expect(dueAt(aPost({ lifecycle: "SCHEDULED", publishAt: T0, resumeAt: T0 - 9 }))).toBe(T0);
    expect(dueAt(aPost({ lifecycle: "RESUMING", publishAt: T0, resumeAt: T0 + 9 }))).toBe(T0 + 9);
    expect(dueAt(aPost({ lifecycle: "RESUMING", resumeAt: null }))).toBeNull();
    for (const lifecycle of LIFECYCLES.filter((l) => l !== "SCHEDULED" && l !== "RESUMING")) {
      expect(dueAt(aPost({ lifecycle, resumeAt: T0 }))).toBeNull();
    }
  });

  it("isDue at and after the due time", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0 });
    expect([isDue(post, T0 - 1), isDue(post, T0), isDue(post, T0 + 1)]).toStrictEqual([
      false,
      true,
      true,
    ]);
    expect(isDue(aPost({ lifecycle: "DONE" }), T0 + 100)).toBe(false);
  });
});

describe("compareDue", () => {
  it("oldest due first by publishAt or resumeAt; never-due posts last; equal is 0", () => {
    const scheduled = aPost({ lifecycle: "SCHEDULED", publishAt: T0 + 5 });
    const resuming = aPost({ lifecycle: "RESUMING", publishAt: T0, resumeAt: T0 + 9 });
    const done = aPost({ lifecycle: "DONE", publishAt: T0 - 9 });
    expect(compareDue(scheduled, resuming)).toBe(-1);
    expect(compareDue(resuming, scheduled)).toBe(1);
    expect(compareDue(scheduled, scheduled)).toBe(0);
    expect(compareDue(done, scheduled)).toBe(1);
    expect(compareDue(scheduled, done)).toBe(-1);
    expect(compareDue(done, done)).toBe(0);
  });
});

describe("eventForOutcome", () => {
  const retryAt = T0 + 5;
  it.each([
    [{ kind: "retryable", retryAt }, true, { kind: "retry", part: 1, resumeAt: retryAt }],
    [{ kind: "retryable", retryAt }, false, { kind: "defer", part: 1, resumeAt: retryAt }],
    [
      { kind: "rate_limited", scope: "app", retryAt },
      true,
      { kind: "retry", part: 1, resumeAt: retryAt },
    ],
    [
      { kind: "rate_limited", scope: "user", retryAt },
      false,
      { kind: "defer", part: 1, resumeAt: retryAt },
    ],
    [{ kind: "unknown" }, true, { kind: "unknown", part: 1 }],
    [{ kind: "unknown" }, false, { kind: "defer", part: 1, resumeAt: T0 + MINUTE }],
    [{ kind: "rejected", reason: "no" }, true, { kind: "rejected", part: 1, reason: "no" }],
    [{ kind: "rejected", reason: "no" }, false, { kind: "rejected", part: 1, reason: "no" }],
    [{ kind: "needs_reconnect" }, true, { kind: "retry", part: 1, resumeAt: T0 + MINUTE }],
    [{ kind: "needs_reconnect" }, false, { kind: "defer", part: 1, resumeAt: T0 + MINUTE }],
  ] as const)("%j (sending: %s) → %j", (outcome, sending, expected) => {
    expect(eventForOutcome(1, outcome, T0, sending)).toStrictEqual(expected);
  });
});
