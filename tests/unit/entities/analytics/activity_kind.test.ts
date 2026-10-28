import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_KINDS,
  actionMatches,
  activityKindOf,
  actorKindOf,
} from "../../../../src/entities/analytics/activity_kind";

/** Every action name the use cases, the access guard and the X recorder write (grep "action:"). */
const RECORDED = [
  "account.connect_begin",
  "account.connect",
  "account.disclosure",
  "account.policy",
  "account.active",
  "account.paused",
  "media.stage",
  "media.upload",
  "post.create",
  "post.edit",
  "post.cancel",
  "post.approve",
  "post.reject",
  "post.reschedule",
  "post.delete",
  "session.login",
  "x.create",
  "x.delete",
  "x.media_upload",
  "x.read",
  "x.user_read",
  "x.oauth",
  "refused.post.create",
  "refused.analytics.get",
];

describe("activity kinds (GROKCHAT-15)", () => {
  it("every recorded action falls in exactly one kind", () => {
    for (const action of RECORDED) {
      const kinds = ACTIVITY_KINDS.filter((kind) =>
        ACTIVITY_ACTIONS[kind].some((pattern) => actionMatches(action, pattern)),
      );
      expect([action, kinds.length]).toStrictEqual([action, 1]);
    }
  });

  it("maps actions to kinds; an unknown one to none", () => {
    expect(activityKindOf("post.create")).toBe("posts");
    expect(activityKindOf("refused.post.create")).toBe("refusals");
    expect(activityKindOf("x.create")).toBe("publishing");
    expect(activityKindOf("x.user_read")).toBe("reads");
    expect(activityKindOf("x.oauth")).toBe("accounts");
    expect(activityKindOf("media.stage")).toBe("media");
    expect(activityKindOf("session.login")).toBe("sessions");
    expect(activityKindOf("x.readx")).toBeNull();
    expect(activityKindOf("posts.create")).toBeNull();
  });

  it("a pattern ending in a dot is a prefix; any other is exact", () => {
    expect(actionMatches("post.edit", "post.")).toBe(true);
    expect(actionMatches("post", "post.")).toBe(false);
    expect(actionMatches("x.read", "x.read")).toBe(true);
    expect(actionMatches("x.read.more", "x.read")).toBe(false);
  });

  it("reads who did it from the actor label", () => {
    expect(actorKindOf("bot:b1")).toBe("bot");
    expect(actorKindOf("human:admin")).toBe("human");
    expect(actorKindOf("system:x")).toBe("system");
    expect(actorKindOf("robot:x")).toBeNull();
    expect(actorKindOf("bot")).toBeNull();
  });
});
