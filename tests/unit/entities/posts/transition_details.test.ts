/** What each accepted transition writes, field by field (plan §3.1.1). */
import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import { PENDING, type PartState } from "../../../../src/entities/posts/part_state";
import type { Lifecycle, Post } from "../../../../src/entities/posts/post";
import type { PostEvent } from "../../../../src/entities/posts/post_event";
import { transition } from "../../../../src/entities/posts/transition";
import { HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { aPost, part, sendingState, sentState, T0, unknownState } from "../../support/builders";

const GRACE = 30 * MINUTE;
const NOT_FOUND: PartState = { kind: "NOT_FOUND", attemptAt: T0 - MINUTE };

function thread(lifecycle: Lifecycle, a: PartState, b: PartState, extra: Partial<Post> = {}): Post {
  return aPost({ lifecycle, parts: [part("one", a), part("two", b)], ...extra });
}

function apply(post: Post, event: PostEvent): Post {
  const result = transition(post, event);
  if (!result.ok) {
    throw new Error(`refused: ${event.kind}`);
  }
  return result.post;
}

const bumped = (post: Post, changes: Partial<Post>): Post => ({
  ...post,
  ...changes,
  version: post.version + 1,
});

describe("authoring", () => {
  it("submit AUTO → SCHEDULED, REVIEW → PENDING_REVIEW, keeping publishAt", () => {
    const draft = aPost({ lifecycle: "DRAFT" });
    expect(apply(draft, { kind: "submit", mode: "AUTO" })).toStrictEqual(
      bumped(draft, { lifecycle: "SCHEDULED" }),
    );
    expect(apply(draft, { kind: "submit", mode: "REVIEW" })).toStrictEqual(
      bumped(draft, { lifecycle: "PENDING_REVIEW" }),
    );
  });

  it("edit replaces the parts and publishAt, and keeps the lifecycle", () => {
    const post = aPost({ lifecycle: "SCHEDULED" });
    const parts = [part("new one"), part("new two")];
    expect(apply(post, { kind: "edit", parts, publishAt: T0 + HOUR })).toStrictEqual(
      bumped(post, { parts, publishAt: T0 + HOUR }),
    );
  });

  it("edit refuses no parts and parts that are not PENDING", () => {
    const post = aPost({ lifecycle: "DRAFT" });
    expect(transition(post, { kind: "edit", parts: [], publishAt: T0 }).ok).toBe(false);
    const sent = [part("x", sentState("x-1"))];
    expect(transition(post, { kind: "edit", parts: sent, publishAt: T0 }).ok).toBe(false);
  });

  it.each(["DRAFT", "PENDING_REVIEW", "SCHEDULED"] as const)(
    "edit and cancel refuse a %s post whose parts are not all PENDING",
    (lifecycle) => {
      const post = thread(lifecycle, PENDING, sendingState());
      expect(transition(post, { kind: "edit", parts: [part("a")], publishAt: T0 }).ok).toBe(false);
      expect(transition(post, { kind: "cancel" }).ok).toBe(false);
    },
  );

  it("cancel: waiting posts → CANCELLED; RESUMING → DONE with resumeAt cleared", () => {
    const scheduled = aPost({ lifecycle: "SCHEDULED" });
    expect(apply(scheduled, { kind: "cancel" })).toStrictEqual(
      bumped(scheduled, { lifecycle: "CANCELLED" }),
    );
    const resuming = thread("RESUMING", sentState("x-1"), PENDING, { resumeAt: T0 });
    expect(apply(resuming, { kind: "cancel" })).toStrictEqual(
      bumped(resuming, { lifecycle: "DONE", resumeAt: null }),
    );
  });

  it("approve moves a past publishAt to now (grace restarts) and keeps a future one", () => {
    const past = aPost({ lifecycle: "PENDING_REVIEW", publishAt: T0 });
    expect(apply(past, { kind: "approve", now: T0 + HOUR })).toStrictEqual(
      bumped(past, { lifecycle: "SCHEDULED", publishAt: T0 + HOUR }),
    );
    const future = aPost({ lifecycle: "PENDING_REVIEW", publishAt: T0 + 2 * HOUR });
    expect(apply(future, { kind: "approve", now: T0 + HOUR })).toStrictEqual(
      bumped(future, { lifecycle: "SCHEDULED" }),
    );
  });

  it("reject → CANCELLED", () => {
    const post = aPost({ lifecycle: "PENDING_REVIEW" });
    expect(apply(post, { kind: "reject" })).toStrictEqual(bumped(post, { lifecycle: "CANCELLED" }));
  });

  it("reschedule a FAILED post: SCHEDULED, every part PENDING, new publishAt", () => {
    const failed = thread("DONE", { kind: "REJECTED", reason: "no" }, PENDING, { resumeAt: T0 });
    expect(apply(failed, { kind: "reschedule", publishAt: T0 + HOUR })).toStrictEqual(
      bumped(failed, {
        lifecycle: "SCHEDULED",
        publishAt: T0 + HOUR,
        resumeAt: null,
        parts: [part("one"), part("two")],
      }),
    );
  });

  it("reschedule a MISSED post", () => {
    const post = aPost({ lifecycle: "MISSED" });
    expect(apply(post, { kind: "reschedule", publishAt: T0 + HOUR })).toStrictEqual(
      bumped(post, { lifecycle: "SCHEDULED", publishAt: T0 + HOUR }),
    );
  });

  it("resend a NOT_FOUND first part: SCHEDULED at now", () => {
    const post = thread("DONE", NOT_FOUND, PENDING);
    expect(apply(post, { kind: "resend", part: 0, now: T0 + HOUR })).toStrictEqual(
      bumped(post, {
        lifecycle: "SCHEDULED",
        publishAt: T0 + HOUR,
        parts: [part("one"), part("two")],
      }),
    );
  });

  it("resend a NOT_FOUND later part: RESUMING at now", () => {
    const post = thread("DONE", sentState("x-1"), NOT_FOUND);
    expect(apply(post, { kind: "resend", part: 1, now: T0 + HOUR })).toStrictEqual(
      bumped(post, {
        lifecycle: "RESUMING",
        resumeAt: T0 + HOUR,
        parts: [part("one", sentState("x-1")), part("two")],
      }),
    );
  });
});

describe("starting and missing", () => {
  it("start a SCHEDULED post at or after publishAt, inside the grace", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0 });
    expect(apply(post, { kind: "start", now: T0, grace: GRACE })).toStrictEqual(
      bumped(post, { lifecycle: "PUBLISHING" }),
    );
    expect(transition(post, { kind: "start", now: T0 - 1, grace: GRACE }).ok).toBe(false);
    expect(transition(post, { kind: "start", now: T0 + GRACE, grace: GRACE }).ok).toBe(true);
    expect(transition(post, { kind: "start", now: T0 + GRACE + 1, grace: GRACE }).ok).toBe(false);
  });

  it("start a deferred SCHEDULED post only from its not-before time, clearing it", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0, resumeAt: T0 + HOUR });
    expect(transition(post, { kind: "start", now: T0 + HOUR - 1, grace: GRACE }).ok).toBe(false);
    expect(apply(post, { kind: "start", now: T0 + HOUR, grace: GRACE })).toStrictEqual(
      bumped(post, { lifecycle: "PUBLISHING", resumeAt: null }),
    );
    expect(transition(post, { kind: "start", now: T0 + HOUR + GRACE, grace: GRACE }).ok).toBe(true);
    const late = { kind: "start", now: T0 + HOUR + GRACE + 1, grace: GRACE } as const;
    expect(transition(post, late).ok).toBe(false);
  });

  it("start a RESUMING post at or after resumeAt, clearing resumeAt", () => {
    const post = thread("RESUMING", sentState("x-1"), PENDING, { resumeAt: T0 + HOUR });
    expect(apply(post, { kind: "start", now: T0 + HOUR, grace: GRACE })).toStrictEqual(
      bumped(post, { lifecycle: "PUBLISHING", resumeAt: null }),
    );
    expect(transition(post, { kind: "start", now: T0 + HOUR - 1, grace: GRACE }).ok).toBe(false);
    const noResume = thread("RESUMING", sentState("x-1"), PENDING, { resumeAt: null });
    expect(transition(noResume, { kind: "start", now: T0 + HOUR, grace: GRACE }).ok).toBe(false);
  });

  it("miss only after the grace, measured from publishAt", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0 });
    expect(transition(post, { kind: "miss", now: T0 + GRACE, grace: GRACE }).ok).toBe(false);
    expect(apply(post, { kind: "miss", now: T0 + GRACE + 1, grace: GRACE })).toStrictEqual(
      bumped(post, { lifecycle: "MISSED" }),
    );
  });

  it("a deferred post is missed only after the grace from its not-before time", () => {
    const post = aPost({ lifecycle: "SCHEDULED", publishAt: T0, resumeAt: T0 + HOUR });
    const at = (now: number) => transition(post, { kind: "miss", now, grace: GRACE }).ok;
    expect([at(T0 + GRACE + 1), at(T0 + HOUR + GRACE), at(T0 + HOUR + GRACE + 1)]).toStrictEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("publishing a part", () => {
  const first = thread("PUBLISHING", PENDING, PENDING);
  const second = thread("PUBLISHING", sentState("x-1"), PENDING);

  it("reserve writes SENDING with the attempt time", () => {
    expect(apply(first, { kind: "reserve", part: 0, now: T0 + 5 })).toStrictEqual(
      bumped(first, { parts: [part("one", sendingState(T0 + 5)), part("two")] }),
    );
  });

  it("defer: first part → SCHEDULED not before resumeAt; later part → RESUMING at resumeAt", () => {
    expect(apply(first, { kind: "defer", part: 0, resumeAt: T0 + HOUR })).toStrictEqual(
      bumped(first, { lifecycle: "SCHEDULED", resumeAt: T0 + HOUR }),
    );
    expect(apply(second, { kind: "defer", part: 1, resumeAt: T0 + HOUR })).toStrictEqual(
      bumped(second, { lifecycle: "RESUMING", resumeAt: T0 + HOUR }),
    );
  });

  it("sent: the part is SENT; the post stays PUBLISHING until the last part", () => {
    const sending = thread("PUBLISHING", sendingState(), PENDING);
    expect(
      apply(sending, { kind: "sent", part: 0, xPostId: xPostId("x-9"), now: T0 + 7 }),
    ).toStrictEqual(
      bumped(sending, { parts: [part("one", sentState("x-9", T0 + 7)), part("two")] }),
    );
    const last = thread("PUBLISHING", sentState("x-1"), sendingState());
    expect(
      apply(last, { kind: "sent", part: 1, xPostId: xPostId("x-2"), now: T0 + 7 }),
    ).toStrictEqual(
      bumped(last, {
        lifecycle: "DONE",
        parts: [part("one", sentState("x-1")), part("two", sentState("x-2", T0 + 7))],
      }),
    );
  });

  it("unknown: the part keeps its attempt time, checks 0, and the post is DONE", () => {
    const sending = thread("PUBLISHING", sendingState(T0 + 3), PENDING);
    expect(apply(sending, { kind: "unknown", part: 0 })).toStrictEqual(
      bumped(sending, {
        lifecycle: "DONE",
        parts: [part("one", unknownState(0, T0 + 3)), part("two")],
      }),
    );
  });

  it("rejected: the part records the reason and the post is DONE", () => {
    expect(apply(first, { kind: "rejected", part: 0, reason: "x_400: dup" })).toStrictEqual(
      bumped(first, {
        lifecycle: "DONE",
        parts: [part("one", { kind: "REJECTED", reason: "x_400: dup" }), part("two")],
      }),
    );
  });

  it("retry: the part is PENDING again; first → SCHEDULED, later → RESUMING", () => {
    const sendingFirst = thread("PUBLISHING", sendingState(), PENDING);
    expect(apply(sendingFirst, { kind: "retry", part: 0, resumeAt: T0 + HOUR })).toStrictEqual(
      bumped(sendingFirst, {
        lifecycle: "SCHEDULED",
        resumeAt: T0 + HOUR,
        parts: [part("one"), part("two")],
      }),
    );
    const sendingSecond = thread("PUBLISHING", sentState("x-1"), sendingState());
    expect(apply(sendingSecond, { kind: "retry", part: 1, resumeAt: T0 + HOUR })).toStrictEqual(
      bumped(sendingSecond, {
        lifecycle: "RESUMING",
        resumeAt: T0 + HOUR,
        parts: [part("one", sentState("x-1")), part("two")],
      }),
    );
  });
});

describe("yield and recovery", () => {
  it("yield: nothing sent → SCHEDULED; some sent → RESUMING at now", () => {
    const first = thread("PUBLISHING", PENDING, PENDING);
    expect(apply(first, { kind: "yield", now: T0 + 9 })).toStrictEqual(
      bumped(first, { lifecycle: "SCHEDULED", resumeAt: T0 + 9 }),
    );
    const second = thread("PUBLISHING", sentState("x-1"), PENDING);
    expect(apply(second, { kind: "yield", now: T0 + 9 })).toStrictEqual(
      bumped(second, { lifecycle: "RESUMING", resumeAt: T0 + 9 }),
    );
  });

  it("recover a SENDING part → UNKNOWN (never re-sent) and DONE", () => {
    const post = thread("PUBLISHING", sentState("x-1"), sendingState(T0 + 4));
    expect(apply(post, { kind: "recover", now: T0 + 9 })).toStrictEqual(
      bumped(post, {
        lifecycle: "DONE",
        parts: [part("one", sentState("x-1")), part("two", unknownState(0, T0 + 4))],
      }),
    );
  });

  it("recover with nothing SENDING re-queues like a yield", () => {
    const first = thread("PUBLISHING", PENDING, PENDING);
    expect(apply(first, { kind: "recover", now: T0 + 9 })).toStrictEqual(
      bumped(first, { lifecycle: "SCHEDULED", resumeAt: T0 + 9 }),
    );
    const second = thread("PUBLISHING", sentState("x-1"), PENDING);
    expect(apply(second, { kind: "recover", now: T0 + 9 })).toStrictEqual(
      bumped(second, { lifecycle: "RESUMING", resumeAt: T0 + 9 }),
    );
  });
});

describe("reconcile and delete", () => {
  it("found: SENT at now; a later part resumes at now", () => {
    const post = thread("DONE", unknownState(1), PENDING);
    expect(
      apply(post, { kind: "reconcileFound", part: 0, xPostId: xPostId("x-7"), now: T0 + 9 }),
    ).toStrictEqual(
      bumped(post, {
        lifecycle: "RESUMING",
        resumeAt: T0 + 9,
        parts: [part("one", sentState("x-7", T0 + 9)), part("two")],
      }),
    );
  });

  it("found on the last part: DONE (PUBLISHED)", () => {
    const post = thread("DONE", sentState("x-1"), unknownState());
    expect(
      apply(post, { kind: "reconcileFound", part: 1, xPostId: xPostId("x-2"), now: T0 + 9 }),
    ).toStrictEqual(
      bumped(post, {
        parts: [part("one", sentState("x-1")), part("two", sentState("x-2", T0 + 9))],
      }),
    );
  });

  it("not found once → checks 1; twice → NOT_FOUND with the attempt time", () => {
    const post = thread("DONE", unknownState(0, T0 + 2), PENDING);
    const once = apply(post, { kind: "reconcileNotFound", part: 0 });
    expect(once).toStrictEqual(
      bumped(post, { parts: [part("one", unknownState(1, T0 + 2)), part("two")] }),
    );
    expect(apply(once, { kind: "reconcileNotFound", part: 0 })).toStrictEqual(
      bumped(once, { parts: [part("one", { kind: "NOT_FOUND", attemptAt: T0 + 2 }), part("two")] }),
    );
  });

  it("deleted keeps the X id on the part", () => {
    const post = thread("DONE", sentState("x-1"), sentState("x-2"));
    expect(apply(post, { kind: "deleted", part: 1 })).toStrictEqual(
      bumped(post, {
        parts: [
          part("one", sentState("x-1")),
          part("two", { kind: "DELETED", xPostId: xPostId("x-2") }),
        ],
      }),
    );
  });
});
