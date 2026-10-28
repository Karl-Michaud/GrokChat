/** Every label and tone the dashboard shows, table by table (GROKCHAT-15). */
import { PART_STATE_KINDS } from "../../../../src/entities/posts/part_state";
import { describe, expect, it } from "vitest";
import { ANALYTICS_RANGES } from "../../../../src/entities/analytics/range";
import { POST_SORT_KEYS } from "../../../../src/entities/analytics/post_sort";
import { RANGE_LABELS } from "../../../../src/interface_adapters/dashboard/analytics_views";
import {
  accountStatusChip,
  actionChip,
  partStateChip,
  postStatusChip,
} from "../../../../src/interface_adapters/dashboard/chips";
import {
  SORT_LABELS,
  STATUS_OPTIONS,
} from "../../../../src/interface_adapters/dashboard/post_list_views";
import {
  HOME_PAGE,
  SessionController,
} from "../../../../src/interface_adapters/dashboard/session_controller";
import { dashboardUseCases } from "../../support/dashboard";
import { makeWorld } from "../../support/world";

describe("label tables", () => {
  it("every post status, in the filter's order, with its chip", () => {
    expect(
      STATUS_OPTIONS.map((status) => [
        status,
        postStatusChip(status).label,
        postStatusChip(status).tone,
      ]),
    ).toStrictEqual([
      ["PENDING_REVIEW", "Needs review", "warning"],
      ["SCHEDULED", "Scheduled", "info"],
      ["PUBLISHING", "Publishing", "info"],
      ["RESUMING", "Resuming", "info"],
      ["PUBLISHED", "Published", "good"],
      ["PARTIALLY_PUBLISHED", "Partly published", "serious"],
      ["UNKNOWN_OUTCOME", "Outcome unknown", "serious"],
      ["NOT_FOUND", "Not found on X", "critical"],
      ["FAILED", "Failed", "critical"],
      ["MISSED", "Missed", "serious"],
      ["DRAFT", "Draft", "neutral"],
      ["CANCELLED", "Cancelled", "neutral"],
      ["DELETED", "Deleted", "neutral"],
      ["DELETE_INCOMPLETE", "Delete incomplete", "critical"],
    ]);
  });

  it("every part state, as a chip", () => {
    expect(PART_STATE_KINDS.map(partStateChip)).toStrictEqual([
      { label: "Waiting", tone: "neutral" },
      { label: "Sending", tone: "info" },
      { label: "On X", tone: "good" },
      { label: "Outcome unknown", tone: "serious" },
      { label: "Not found on X", tone: "critical" },
      { label: "Rejected by X", tone: "critical" },
      { label: "Deleted", tone: "neutral" },
    ]);
  });

  it("every account status", () => {
    expect(
      (["ACTIVE", "PAUSED", "NEEDS_RECONNECT", "DISCONNECTED"] as const).map(accountStatusChip),
    ).toStrictEqual([
      { label: "Active", tone: "good" },
      { label: "Paused", tone: "warning" },
      { label: "Reconnect needed", tone: "critical" },
      { label: "Disconnected", tone: "critical" },
    ]);
  });

  it("every action GrokChat records, named and toned by kind", () => {
    const actions = [
      "post.create",
      "post.edit",
      "post.cancel",
      "post.approve",
      "post.reject",
      "post.reschedule",
      "post.delete",
      "x.create",
      "x.delete",
      "x.media_upload",
      "x.read",
      "x.user_read",
      "x.oauth",
      "account.connect",
      "account.connect_begin",
      "account.active",
      "account.paused",
      "account.disclosure",
      "account.policy",
      "media.stage",
      "media.upload",
      "media.bot_upload",
      "media.delete",
      "media.list",
      "media.view",
      "session.login",
    ];
    expect(
      actions.map((action) => {
        const chip = actionChip(action);
        return `${chip.label} (${chip.tone})`;
      }),
    ).toStrictEqual([
      "Created a post (info)",
      "Edited a post (info)",
      "Cancelled a post (info)",
      "Approved a post (info)",
      "Rejected a post (info)",
      "Rescheduled a post (info)",
      "Deleted a post (info)",
      "Published on X (good)",
      "Deleted on X (good)",
      "Uploaded media to X (good)",
      "Read post metrics (neutral)",
      "Read follower count (neutral)",
      "Signed in to X (info)",
      "Connected an account (info)",
      "Started connecting an account (info)",
      "Resumed an account (info)",
      "Paused an account (info)",
      "Updated the disclosure (info)",
      "Updated the posting policy (info)",
      "Staged media (neutral)",
      "Uploaded media (neutral)",
      "Bot uploaded media (neutral)",
      "Deleted media (neutral)",
      "Listed media (neutral)",
      "Viewed media (neutral)",
      "Logged in (neutral)",
    ]);
  });

  it("every range and sort key", () => {
    expect(ANALYTICS_RANGES.map((range) => RANGE_LABELS[range])).toStrictEqual([
      "Last 24 hours",
      "Last 3 days",
      "Last 7 days",
      "Last 14 days",
      "Last 30 days",
      "All time",
    ]);
    expect(POST_SORT_KEYS.map((key) => SORT_LABELS[key])).toStrictEqual([
      "Publish time",
      "Impressions",
      "Engagements",
      "Likes",
      "Reposts",
      "Replies",
      "Link clicks",
    ]);
  });
});

describe("the login form (R12)", () => {
  it("goes to the analytics on the right password as the admin; 401 on a wrong one; 429 when throttled", async () => {
    const world = makeWorld();
    const controller = new SessionController(dashboardUseCases(world));
    const login = (password: string) => controller.login({ password, clientKey: "9.9.9.9" });
    expect(HOME_PAGE).toBe("/dashboard/analytics");
    expect(await login("pw")).toStrictEqual({ kind: "redirect", location: "/dashboard/analytics" });
    expect(world.audit.events.at(-1)?.actor).toBe("human:admin");
    expect(await login("bad")).toStrictEqual({
      kind: "refused",
      status: 401,
      message: "Wrong password.",
    });
    for (let i = 0; i < 4; i += 1) {
      await login("bad");
    }
    expect(world.throttle.failures.get("ip:9.9.9.9")).toHaveLength(5);
    expect(await login("pw")).toStrictEqual({
      kind: "refused",
      status: 429,
      message: "Too many failed logins; wait fifteen minutes.",
    });
  });
});
