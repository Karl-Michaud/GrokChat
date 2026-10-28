import { describe, expect, it } from "vitest";
import { postId, stagedMediaId, xPostId } from "../../../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../../../src/entities/metrics/metrics_snapshot";
import { DAY, MINUTE } from "../../../../src/entities/time/instant";
import {
  disclosureJson,
  isoTime,
  policyJson,
  postJson,
  snapshotJson,
} from "../../../../src/interface_adapters/mcp/json_views";
import * as views from "../../../../src/interface_adapters/mcp/tool_views";
import { toPostView } from "../../../../src/use_cases/views/post_view";
import {
  ACCOUNT,
  aMedia,
  anAccount,
  aPolicy,
  aPost,
  part,
  sentState,
  T0,
} from "../../support/builders";

const SNAPSHOT: MetricsSnapshot = {
  xPostId: xPostId("x-1"),
  accountId: ACCOUNT,
  takenAt: T0,
  impressions: 100,
  likes: 5,
  reposts: 4,
  replies: 3,
  quotes: 2,
  bookmarks: 1,
  urlLinkClicks: 7,
  userProfileClicks: null,
};

const SNAPSHOT_JSON = {
  x_post_id: "x-1",
  account_id: ACCOUNT,
  taken_at: "2026-10-27T12:00:00.000Z",
  impressions: 100,
  likes: 5,
  reposts: 4,
  replies: 3,
  quotes: 2,
  bookmarks: 1,
  url_link_clicks: 7,
  user_profile_clicks: null,
};

const POST = toPostView(
  aPost({
    parts: [part("one", sentState("x-9")), part("two")],
    lifecycle: "RESUMING",
    resumeAt: T0 + MINUTE,
    version: 4,
  }),
);

const POST_JSON = {
  post_id: "post-1",
  account_id: ACCOUNT,
  status: "RESUMING",
  lifecycle: "RESUMING",
  publish_at: "2026-10-27T12:00:00.000Z",
  resume_at: "2026-10-27T12:01:00.000Z",
  in_reply_to: null,
  parts: [
    { text: "one", state: "SENT", x_post_id: "x-9" },
    { text: "two", state: "PENDING", x_post_id: null },
  ],
  created_by: "human:owner",
  version: 4,
};

describe("json views", () => {
  it("writes instants as ISO 8601 UTC", () => {
    expect(isoTime(T0)).toBe("2026-10-27T12:00:00.000Z");
  });

  it("shows a post with snake_case fields, ISO times and each part's X id", () => {
    expect(postJson(POST)).toStrictEqual(POST_JSON);
  });

  it("shows a post with no resume time as null", () => {
    expect(postJson(toPostView(aPost()))).toMatchObject({ resume_at: null });
  });

  it("shows the X post a reply answers", () => {
    expect(postJson(toPostView(aPost({ replyTo: xPostId("42") })))).toMatchObject({
      in_reply_to: "42",
    });
  });

  it("shows a metrics snapshot", () => {
    expect(snapshotJson(SNAPSHOT)).toStrictEqual(SNAPSHOT_JSON);
  });

  it("shows a policy in minutes and quiet hours as zero-padded local HH:MM", () => {
    const policy = aPolicy({
      minGap: 45 * MINUTE,
      grace: 90 * MINUTE,
      quietHours: { startMinute: 22 * 60 + 5, endMinute: 7 * 60 },
      tz: "Europe/Paris",
      mode: "REVIEW",
      dailyCap: 4,
    });
    expect(policyJson(policy)).toStrictEqual({
      mode: "REVIEW",
      daily_cap: 4,
      min_gap_minutes: 45,
      quiet_hours: { start: "22:05", end: "07:00" },
      time_zone: "Europe/Paris",
      link_policy: "ALLOW",
      grace_minutes: 90,
    });
    expect(policyJson(aPolicy({ quietHours: null }))).toMatchObject({ quiet_hours: null });
  });

  it("shows the disclosure", () => {
    expect(disclosureJson({ bioConfirmed: true, automatedLabelConfirmed: false })).toStrictEqual({
      bio_confirmed: true,
      automated_label_confirmed: false,
    });
  });
});

describe("tool views", () => {
  it("create_post: post id, status, the cost in dollars, and whether it was a duplicate", () => {
    expect(
      views.createPostView({
        ok: true,
        postId: postId("p-1"),
        status: "PUBLISHED",
        estimatedCostMicros: 215_000,
        duplicate: true,
      }),
    ).toStrictEqual({
      ok: true,
      body: { post_id: "p-1", status: "PUBLISHED", estimated_cost_usd: 0.215, duplicate: true },
    });
  });

  it("create_post refusal keeps the code and the part", () => {
    expect(views.createPostView({ ok: false, code: "part_too_long", part: 1 })).toStrictEqual({
      ok: false,
      code: "part_too_long",
      part: 1,
    });
  });

  it("a refusal without a part gets part null", () => {
    expect(views.getPostView({ ok: false, code: "scope" })).toStrictEqual({
      ok: false,
      code: "scope",
      part: null,
    });
  });

  it("stage_media_from_url", () => {
    expect(
      views.stageMediaView({ ok: true, mediaId: stagedMediaId("m-1"), kind: "GIF", size: 9 }),
    ).toStrictEqual({ ok: true, body: { media_id: "m-1", kind: "GIF", size_bytes: 9 } });
  });

  it("a host refusal names the allowed hosts and where an owner's file goes (GROKCHAT-18)", () => {
    const refused = views.stageMediaView({
      ok: false,
      code: "host_not_allowed",
      allowedHosts: ["imgen.x.ai", "cdn.example"],
    });
    expect(refused).toStrictEqual({
      ok: false,
      code: "host_not_allowed",
      message: views.hostRefusalMessage(["imgen.x.ai", "cdn.example"]),
    });
    expect(views.hostRefusalMessage(["imgen.x.ai", "cdn.example"])).toBe(
      "The URL's host is not allowed. Allowed hosts: imgen.x.ai, cdn.example. For a file the owner has, ask them to upload it on the GrokChat dashboard's Media page, then find its media_id with grokchat___list_media.",
    );
    expect(views.hostRefusalMessage([])).toMatch(
      /^No media host is allowed: GROKCHAT_MEDIA_HOSTS is empty, so every URL is refused\. For a file/,
    );
    expect(views.stageMediaView({ ok: false, code: "bad_type" })).toStrictEqual({
      ok: false,
      code: "bad_type",
      part: null,
    });
  });

  it("list_media: each item's id, label, type, size, times, source and use (GROKCHAT-18)", () => {
    const upload = aMedia({
      id: stagedMediaId("m-up"),
      label: "launch banner",
      source: { kind: "dashboard" },
      contentType: "image/webp",
      size: 90_000,
    });
    const fetched = aMedia({
      id: stagedMediaId("m-url"),
      source: { kind: "url", host: "imgen.x.ai" },
    });
    const sent = aMedia({ id: stagedMediaId("m-bot"), source: { kind: "bot_upload" } });
    expect(
      views.listMediaView({
        ok: true,
        accountId: ACCOUNT,
        items: [
          { media: upload, used: false, expiresAt: T0 + 2 * DAY },
          { media: fetched, used: true, expiresAt: null },
          { media: sent, used: false, expiresAt: null },
        ],
      }),
    ).toStrictEqual({
      ok: true,
      body: {
        account_id: ACCOUNT,
        media: [
          {
            media_id: "m-up",
            label: "launch banner",
            content_type: "image/webp",
            bytes: 90_000,
            uploaded_at: "2026-10-27T12:00:00.000Z",
            source: "dashboard",
            used: false,
            expires_at: "2026-10-29T12:00:00.000Z",
          },
          {
            media_id: "m-url",
            label: null,
            content_type: "image/png",
            bytes: 1000,
            uploaded_at: "2026-10-27T12:00:00.000Z",
            source: "imgen.x.ai",
            used: true,
            expires_at: null,
          },
          {
            media_id: "m-bot",
            label: null,
            content_type: "image/png",
            bytes: 1000,
            uploaded_at: "2026-10-27T12:00:00.000Z",
            source: "bot_upload",
            used: false,
            expires_at: null,
          },
        ],
      },
    });
    expect(views.listMediaView({ ok: false, code: "scope" })).toStrictEqual({
      ok: false,
      code: "scope",
      part: null,
    });
  });

  it("edit_post / cancel_post, get_post and list_backlog show posts", () => {
    expect(views.postCommandView({ ok: true, post: POST })).toStrictEqual({
      ok: true,
      body: { post: POST_JSON },
    });
    expect(views.getPostView({ ok: true, post: POST })).toStrictEqual({
      ok: true,
      body: { post: POST_JSON },
    });
    expect(views.listBacklogView({ ok: true, posts: [POST, POST] })).toStrictEqual({
      ok: true,
      body: { posts: [POST_JSON, POST_JSON] },
    });
  });

  it("delete_post", () => {
    expect(
      views.deletePostView({ ok: true, post: POST, deleted: 1, incomplete: true }),
    ).toStrictEqual({ ok: true, body: { post: POST_JSON, deleted: 1, incomplete: true } });
  });

  it("the metrics tools", () => {
    expect(
      views.postMetricsView({ ok: true, postId: postId("p-1"), parts: [SNAPSHOT] }),
    ).toStrictEqual({ ok: true, body: { post_id: "p-1", parts: [SNAPSHOT_JSON] } });
    const totals = {
      impressions: 1,
      likes: 2,
      reposts: 3,
      replies: 4,
      quotes: 5,
      bookmarks: 6,
    };
    expect(
      views.accountMetricsView({
        ok: true,
        accountId: ACCOUNT,
        posts: 1,
        totals,
        series: [SNAPSHOT],
      }),
    ).toStrictEqual({
      ok: true,
      body: { account_id: ACCOUNT, posts: 1, totals, series: [SNAPSHOT_JSON] },
    });
    expect(views.comparePostsView({ ok: true, ranked: [SNAPSHOT] })).toStrictEqual({
      ok: true,
      body: { ranked: [SNAPSHOT_JSON] },
    });
  });

  it("get_policy", () => {
    const policy = aPolicy();
    expect(
      views.policyView({
        ok: true,
        accountId: ACCOUNT,
        handle: "muse",
        status: "PAUSED",
        disclosure: { bioConfirmed: false, automatedLabelConfirmed: true },
        policy,
      }),
    ).toStrictEqual({
      ok: true,
      body: {
        account_id: ACCOUNT,
        handle: "muse",
        status: "PAUSED",
        disclosure: { bio_confirmed: false, automated_label_confirmed: true },
        policy: policyJson(policy),
      },
    });
  });

  it("list_accounts: id, handle, status in a bot's words, mode and disclosure", () => {
    const at = (overrides: Parameters<typeof anAccount>[0]) =>
      views.listAccountsView({ ok: true, accounts: [anAccount(overrides)] });
    expect(at({ status: "ACTIVE" })).toStrictEqual({
      ok: true,
      body: {
        accounts: [
          {
            account_id: ACCOUNT,
            handle: "musechat_one",
            status: "active",
            mode: "auto",
            disclosure_complete: true,
          },
        ],
      },
    });
    const field = (overrides: Parameters<typeof anAccount>[0], name: string) => {
      const outcome = at(overrides);
      const accounts = outcome.ok ? (outcome.body["accounts"] as Record<string, unknown>[]) : [];
      return accounts[0]?.[name];
    };
    expect(field({ status: "PAUSED" }, "status")).toBe("paused");
    expect(field({ status: "NEEDS_RECONNECT" }, "status")).toBe("needs_reconnect");
    expect(field({ status: "DISCONNECTED" }, "status")).toBe("needs_reconnect");
    expect(field({ policy: aPolicy({ mode: "REVIEW" }) }, "mode")).toBe("review");
    const half = { bioConfirmed: true, automatedLabelConfirmed: false };
    expect(field({ disclosure: half }, "disclosure_complete")).toBe(false);
    expect(views.listAccountsView({ ok: true, accounts: [] })).toStrictEqual({
      ok: true,
      body: { accounts: [] },
    });
  });
});
