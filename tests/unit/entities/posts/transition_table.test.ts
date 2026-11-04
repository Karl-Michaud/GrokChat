/**
 * Plan §3.1.1, exhaustively: every lifecycle scenario × every event, and every part state × every
 * part event. Any pair the table does not list must be refused.
 */
import { describe, expect, it } from "vitest";
import { xPostId } from "../../../../src/entities/identity/ids";
import {
  PART_STATE_KINDS,
  PENDING,
  type PartState,
  type PartStateKind,
} from "../../../../src/entities/posts/part_state";
import type { Lifecycle, Post } from "../../../../src/entities/posts/post";
import type { PostEvent, PostEventKind } from "../../../../src/entities/posts/post_event";
import { transition } from "../../../../src/entities/posts/transition";
import { MINUTE, HOUR } from "../../../../src/entities/time/instant";
import { aPost, part, sendingState, sentState, T0, unknownState } from "../../support/builders";

const GRACE = 30 * MINUTE;
const NOW = T0 + MINUTE;
const LATE = T0 + 2 * HOUR;

const REJECTED: PartState = { kind: "REJECTED", reason: "x_400: bad" };
const NOT_FOUND: PartState = { kind: "NOT_FOUND", attemptAt: T0 };
const DELETED: PartState = { kind: "DELETED", xPostId: xPostId("x-1") };

function thread(
  lifecycle: Lifecycle,
  a: PartState,
  b: PartState,
  resumeAt: number | null = null,
): Post {
  return aPost({ lifecycle, parts: [part("one", a), part("two", b)], resumeAt });
}

interface Scenario {
  readonly post: Post;
  /** The part the part-addressed events name. */
  readonly focus: number;
  /** Accepted events and the lifecycle each leads to; every other event is refused. */
  readonly accepts: Partial<Record<EventName, Lifecycle>>;
}

type EventName = PostEventKind | "submitReview";

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  draft: {
    post: thread("DRAFT", PENDING, PENDING),
    focus: 0,
    accepts: {
      submit: "SCHEDULED",
      submitReview: "PENDING_REVIEW",
      edit: "DRAFT",
      cancel: "CANCELLED",
    },
  },
  review: {
    post: thread("PENDING_REVIEW", PENDING, PENDING),
    focus: 0,
    accepts: {
      edit: "PENDING_REVIEW",
      cancel: "CANCELLED",
      approve: "SCHEDULED",
      reject: "CANCELLED",
    },
  },
  scheduled: {
    post: thread("SCHEDULED", PENDING, PENDING),
    focus: 0,
    accepts: { edit: "SCHEDULED", cancel: "CANCELLED", start: "PUBLISHING", miss: "MISSED" },
  },
  resuming: {
    post: thread("RESUMING", sentState("x-1"), PENDING, T0),
    focus: 1,
    accepts: { cancel: "DONE", start: "PUBLISHING" },
  },
  publishingFirst: {
    post: thread("PUBLISHING", PENDING, PENDING),
    focus: 0,
    accepts: {
      reserve: "PUBLISHING",
      defer: "SCHEDULED",
      rejected: "DONE",
      yield: "SCHEDULED",
      recover: "SCHEDULED",
    },
  },
  publishingFirstSending: {
    post: thread("PUBLISHING", sendingState(), PENDING),
    focus: 0,
    accepts: {
      sent: "PUBLISHING",
      unknown: "DONE",
      rejected: "DONE",
      retry: "SCHEDULED",
      recover: "DONE",
    },
  },
  publishingSecond: {
    post: thread("PUBLISHING", sentState("x-1"), PENDING),
    focus: 1,
    accepts: {
      reserve: "PUBLISHING",
      defer: "RESUMING",
      rejected: "DONE",
      yield: "RESUMING",
      recover: "RESUMING",
    },
  },
  publishingSecondSending: {
    post: thread("PUBLISHING", sentState("x-1"), sendingState()),
    focus: 1,
    accepts: {
      sent: "DONE",
      unknown: "DONE",
      rejected: "DONE",
      retry: "RESUMING",
      recover: "DONE",
    },
  },
  donePublished: {
    post: thread("DONE", sentState("x-1"), sentState("x-2")),
    focus: 1,
    accepts: { deleted: "DONE" },
  },
  donePartial: {
    post: thread("DONE", sentState("x-1"), REJECTED),
    focus: 0,
    accepts: { deleted: "DONE" },
  },
  doneFailed: {
    post: thread("DONE", REJECTED, PENDING),
    focus: 0,
    accepts: { reschedule: "SCHEDULED" },
  },
  doneUnknownFirst: {
    post: thread("DONE", unknownState(0), PENDING),
    focus: 0,
    accepts: { reconcileFound: "RESUMING", reconcileNotFound: "DONE" },
  },
  doneUnknownChecked: {
    post: thread("DONE", unknownState(1), PENDING),
    focus: 0,
    accepts: { reconcileFound: "RESUMING", reconcileNotFound: "DONE" },
  },
  doneUnknownLast: {
    post: thread("DONE", sentState("x-1"), unknownState(0)),
    focus: 1,
    accepts: { reconcileFound: "DONE", reconcileNotFound: "DONE" },
  },
  doneNotFoundFirst: {
    post: thread("DONE", NOT_FOUND, PENDING),
    focus: 0,
    accepts: { resend: "SCHEDULED" },
  },
  doneNotFoundSecond: {
    post: thread("DONE", sentState("x-1"), NOT_FOUND),
    focus: 1,
    accepts: { resend: "RESUMING" },
  },
  doneDeleted: { post: thread("DONE", DELETED, DELETED), focus: 1, accepts: {} },
  doneDeleteIncomplete: {
    post: thread("DONE", sentState("x-1"), DELETED),
    focus: 0,
    accepts: { deleted: "DONE" },
  },
  cancelled: { post: thread("CANCELLED", PENDING, PENDING), focus: 0, accepts: {} },
  missed: {
    post: thread("MISSED", PENDING, PENDING),
    focus: 0,
    accepts: { reschedule: "SCHEDULED" },
  },
};

function eventFor(name: EventName, focus: number): PostEvent {
  const x = xPostId("x-new");
  const events: Readonly<Record<EventName, PostEvent>> = {
    submit: { kind: "submit", mode: "AUTO" },
    submitReview: { kind: "submit", mode: "REVIEW" },
    edit: { kind: "edit", parts: [part("edited")], publishAt: T0 },
    cancel: { kind: "cancel" },
    approve: { kind: "approve", now: NOW },
    reject: { kind: "reject" },
    start: { kind: "start", now: NOW, grace: GRACE },
    miss: { kind: "miss", now: LATE, grace: GRACE },
    reserve: { kind: "reserve", part: focus, now: NOW },
    defer: { kind: "defer", part: focus, resumeAt: LATE },
    sent: { kind: "sent", part: focus, xPostId: x, now: NOW },
    unknown: { kind: "unknown", part: focus },
    rejected: { kind: "rejected", part: focus, reason: "x_400: no" },
    retry: { kind: "retry", part: focus, resumeAt: LATE },
    yield: { kind: "yield", now: NOW },
    recover: { kind: "recover", now: NOW },
    reconcileFound: { kind: "reconcileFound", part: focus, xPostId: x, now: NOW },
    reconcileNotFound: { kind: "reconcileNotFound", part: focus },
    resend: { kind: "resend", part: focus, now: NOW },
    reschedule: { kind: "reschedule", publishAt: LATE },
    deleted: { kind: "deleted", part: focus },
  };
  return events[name];
}

const EVENT_NAMES: readonly EventName[] = [
  "submit",
  "submitReview",
  "edit",
  "cancel",
  "approve",
  "reject",
  "start",
  "miss",
  "reserve",
  "defer",
  "sent",
  "unknown",
  "rejected",
  "retry",
  "yield",
  "recover",
  "reconcileFound",
  "reconcileNotFound",
  "resend",
  "reschedule",
  "deleted",
];

describe("transition table: every lifecycle scenario × every event", () => {
  const cases = Object.entries(SCENARIOS).flatMap(([name, scenario]) =>
    EVENT_NAMES.map((event) => ({ name, scenario, event })),
  );

  it.each(cases)("$name × $event", ({ scenario, event }) => {
    const result = transition(scenario.post, eventFor(event, scenario.focus));
    const expected = scenario.accepts[event];
    if (expected === undefined) {
      expect(result).toStrictEqual({ ok: false, reason: "invalid_transition" });
    } else {
      expect(result.ok).toBe(true);
      expect(result.ok && result.post.lifecycle).toBe(expected);
      expect(result.ok && result.post.version).toBe(scenario.post.version + 1);
    }
  });

  it("covers every lifecycle", () => {
    const covered = new Set(Object.values(SCENARIOS).map((scenario) => scenario.post.lifecycle));
    expect([...covered].sort()).toStrictEqual([
      "CANCELLED",
      "DONE",
      "DRAFT",
      "MISSED",
      "PENDING_REVIEW",
      "PUBLISHING",
      "RESUMING",
      "SCHEDULED",
    ]);
  });
});

/** The lifecycle each part event needs, and the part states it accepts. */
const PART_EVENTS: readonly {
  readonly name: EventName;
  readonly lifecycle: Lifecycle;
  readonly accepts: readonly PartStateKind[];
}[] = [
  { name: "reserve", lifecycle: "PUBLISHING", accepts: ["PENDING"] },
  { name: "defer", lifecycle: "PUBLISHING", accepts: ["PENDING"] },
  { name: "sent", lifecycle: "PUBLISHING", accepts: ["SENDING"] },
  { name: "unknown", lifecycle: "PUBLISHING", accepts: ["SENDING"] },
  { name: "rejected", lifecycle: "PUBLISHING", accepts: ["PENDING", "SENDING"] },
  { name: "retry", lifecycle: "PUBLISHING", accepts: ["SENDING"] },
  { name: "reconcileFound", lifecycle: "DONE", accepts: ["UNKNOWN"] },
  { name: "reconcileNotFound", lifecycle: "DONE", accepts: ["UNKNOWN"] },
  { name: "resend", lifecycle: "DONE", accepts: ["NOT_FOUND"] },
  { name: "deleted", lifecycle: "DONE", accepts: ["SENT"] },
];

const SAMPLE_STATES: Readonly<Record<PartStateKind, PartState>> = {
  PENDING,
  SENDING: sendingState(),
  SENT: sentState("x-1"),
  UNKNOWN: unknownState(),
  NOT_FOUND,
  REJECTED,
  DELETED,
};

describe("transition table: every part state × every part event", () => {
  const cases = PART_EVENTS.flatMap((partEvent) =>
    PART_STATE_KINDS.map((state) => ({ ...partEvent, state })),
  );

  it.each(cases)("$name on a $state part ($lifecycle)", ({ name, lifecycle, accepts, state }) => {
    const post = aPost({ lifecycle, parts: [part("only", SAMPLE_STATES[state])] });
    const result = transition(post, eventFor(name, 0));
    expect(result.ok).toBe(accepts.includes(state));
  });

  it.each(PART_EVENTS)(
    "$name names a part that does not exist → refused",
    ({ name, lifecycle, accepts }) => {
      const state = accepts[0] ?? "PENDING";
      const post = aPost({ lifecycle, parts: [part("only", SAMPLE_STATES[state])] });
      expect(transition(post, eventFor(name, 1)).ok).toBe(false);
      expect(transition(post, eventFor(name, -1)).ok).toBe(false);
    },
  );

  it.each(["reserve", "defer", "rejected"] as const)(
    "%s names a later part than the current one → refused",
    (name) => {
      const post = thread("PUBLISHING", PENDING, PENDING);
      expect(transition(post, eventFor(name, 1)).ok).toBe(false);
    },
  );

  it.each(["sent", "unknown", "retry"] as const)(
    "%s on a SENDING part that is not current → refused",
    (name) => {
      const post = thread("PUBLISHING", PENDING, sendingState());
      expect(transition(post, eventFor(name, 1)).ok).toBe(false);
    },
  );

  it.each(["reconcileFound", "reconcileNotFound"] as const)(
    "%s needs a DONE post even when a part is UNKNOWN",
    (name) => {
      const post = aPost({ lifecycle: "PUBLISHING", parts: [part("only", unknownState())] });
      expect(transition(post, eventFor(name, 0)).ok).toBe(false);
    },
  );

  it("resend needs a DONE post even when a part is NOT_FOUND", () => {
    const post = aPost({ lifecycle: "PUBLISHING", parts: [part("only", NOT_FOUND)] });
    expect(transition(post, eventFor("resend", 0)).ok).toBe(false);
  });

  it.each(["reserve", "defer", "rejected", "sent", "unknown", "retry"] as const)(
    "%s on a PUBLISHING post with every part SENT (part -1) → refused",
    (name) => {
      const post = aPost({ lifecycle: "PUBLISHING", parts: [part("only", sentState("x-1"))] });
      expect(transition(post, eventFor(name, -1)).ok).toBe(false);
    },
  );

  it("edit refuses replacement parts unless every one is PENDING", () => {
    const post = aPost({ lifecycle: "DRAFT" });
    const mixed = [part("a"), part("b", sentState("x-1"))];
    expect(transition(post, { kind: "edit", parts: mixed, publishAt: T0 }).ok).toBe(false);
  });

  it.each(["PUBLISHING", "DONE", "DRAFT"] as const)(
    "start refuses a %s post even with resumeAt passed",
    (lifecycle) => {
      const post = aPost({
        lifecycle,
        resumeAt: T0 - MINUTE,
        parts: [part("a", sentState("x")), part("b")],
      });
      expect(transition(post, eventFor("start", 0)).ok).toBe(false);
    },
  );

  it("deleting a part while a later part is still SENT is refused (last first)", () => {
    const post = thread("DONE", sentState("x-1"), sentState("x-2"));
    expect(transition(post, eventFor("deleted", 0)).ok).toBe(false);
  });

  it("deleting while an outcome is unknown is refused", () => {
    const post = thread("DONE", sentState("x-1"), unknownState());
    expect(transition(post, eventFor("deleted", 0)).ok).toBe(false);
  });
});
