import { describe, expect, it } from "vitest";
import { accountId, postId, xPostId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { PostPagesController } from "../../../../src/interface_adapters/dashboard/post_pages_controller";
import {
  postActions,
  postHref,
  postRow,
  STATUS_OPTIONS,
} from "../../../../src/interface_adapters/dashboard/post_views";
import { toPostView, type PostView } from "../../../../src/use_cases/views/post_view";
import { derivedStatus } from "../../../../src/entities/posts/derived_status";
import type { Post } from "../../../../src/entities/posts/post";
import { ACCOUNT, aPost, part, sentState, T0, unknownState } from "../../support/builders";
import { presenting, setupPosts as setup } from "../../support/dashboard";

const NO_STATUS = STATUS_OPTIONS.map((value) => ({ value, selected: false }));
const ACCOUNT_OPTION = { id: "acc-1", handle: "@musechat_one", selected: false };

describe("the backlog page", () => {
  const scheduled = aPost({ publishAt: T0 + HOUR, parts: [part("hello"), part("two")] });
  const review = aPost({
    id: postId("post-2"),
    accountId: accountId("acc-9"),
    lifecycle: "PENDING_REVIEW",
    publishAt: T0 + 2 * HOUR,
  });

  it("lists every post with its account, status and time", async () => {
    const { pages } = await setup([scheduled, review]);
    expect(await pages.backlog({ account: null, status: null })).toStrictEqual({
      kind: "page",
      view: {
        accounts: [ACCOUNT_OPTION],
        statuses: NO_STATUS,
        rows: [
          {
            id: "post-1",
            href: "/dashboard/posts/post-1",
            account: "@musechat_one",
            status: "SCHEDULED",
            publishAt: "2026-10-27 13:00 UTC",
            time: "13:00",
            text: "hello",
            parts: 2,
          },
          {
            id: "post-2",
            href: "/dashboard/posts/post-2",
            account: "acc-9",
            status: "PENDING_REVIEW",
            publishAt: "2026-10-27 14:00 UTC",
            time: "14:00",
            text: "hello world",
            parts: 1,
          },
        ],
      },
    });
  });

  it("filters by status and by account, an empty value meaning any", async () => {
    const { pages } = await setup([scheduled, review]);
    const byStatus = await pages.backlog({ account: "", status: "PENDING_REVIEW" });
    expect(byStatus).toMatchObject({ view: { rows: [{ id: "post-2" }] } });
    expect(byStatus.kind === "page" && byStatus.view.statuses).toStrictEqual(
      STATUS_OPTIONS.map((value) => ({ value, selected: value === "PENDING_REVIEW" })),
    );
    const byAccount = await pages.backlog({ account: "acc-1", status: "" });
    expect(byAccount).toStrictEqual({
      kind: "page",
      view: {
        accounts: [{ ...ACCOUNT_OPTION, selected: true }],
        statuses: NO_STATUS,
        rows: [expect.objectContaining({ id: "post-1" })],
      },
    });
  });

  it("refuses an unknown status, and shows a use case's refusal", async () => {
    const { pages, useCases, world } = await setup();
    expect(await pages.backlog({ account: null, status: "LOST" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Unknown status.",
    });
    const refusing = new PostPagesController(
      { ...useCases, listBacklog: presenting({ ok: false, code: "scope" }) },
      world.clock,
    );
    expect(await refusing.backlog({ account: null, status: null })).toStrictEqual({
      kind: "refused",
      status: 403,
      message: "Outside your scope.",
    });
  });

  it("lists every status a post can show", () => {
    expect(STATUS_OPTIONS).toStrictEqual([
      "DRAFT",
      "PENDING_REVIEW",
      "SCHEDULED",
      "RESUMING",
      "PUBLISHING",
      "PUBLISHED",
      "PARTIALLY_PUBLISHED",
      "UNKNOWN_OUTCOME",
      "NOT_FOUND",
      "FAILED",
      "MISSED",
      "CANCELLED",
      "DELETED",
      "DELETE_INCOMPLETE",
    ]);
  });

  it("a row of a post with no parts has no text", () => {
    const view: PostView = { ...toPostView(aPost()), parts: [] };
    expect(postRow(view, [])).toMatchObject({ text: "", parts: 0, account: "acc-1" });
    expect(postHref("a/b c")).toBe("/dashboard/posts/a%2Fb%20c");
  });
});

describe("the calendar page", () => {
  const at = (id: string, publishAt: number) => aPost({ id: postId(id), publishAt });
  const posts = [
    at("before", Date.UTC(2026, 9, 26, 23, 59)),
    at("first", T0),
    at("midnight", Date.UTC(2026, 9, 28)),
    at("last", Date.UTC(2026, 10, 2, 23, 59)),
    at("after", Date.UTC(2026, 10, 3)),
  ];

  it("shows seven UTC days from today by default", async () => {
    const { pages } = await setup(posts);
    const outcome = await pages.calendar({ start: null });
    if (outcome.kind !== "page") {
      throw new Error("expected a page");
    }
    const view = outcome.view;
    expect([view.start, view.previous, view.next]).toStrictEqual([
      "2026-10-27",
      "2026-10-20",
      "2026-11-03",
    ]);
    expect(
      view.days.map((day) => [day.date, day.weekday, day.posts.map((p) => p.id)]),
    ).toStrictEqual([
      ["2026-10-27", "Tue", ["first"]],
      ["2026-10-28", "Wed", ["midnight"]],
      ["2026-10-29", "Thu", []],
      ["2026-10-30", "Fri", []],
      ["2026-10-31", "Sat", []],
      ["2026-11-01", "Sun", []],
      ["2026-11-02", "Mon", ["last"]],
    ]);
    expect(view.days[0]?.posts[0]).toMatchObject({ time: "12:00", account: "@musechat_one" });
  });

  it("starts where asked; an empty start means today; a bad start is refused", async () => {
    const { pages, world, useCases } = await setup(posts);
    const asked = await pages.calendar({ start: "2026-10-26" });
    expect(asked).toMatchObject({ view: { start: "2026-10-26" } });
    const first = asked.kind === "page" ? asked.view.days[0] : undefined;
    expect([first?.date, first?.posts.map((p) => p.id)]).toStrictEqual(["2026-10-26", ["before"]]);
    world.clock.advance(DAY);
    expect(await pages.calendar({ start: " " })).toMatchObject({ view: { start: "2026-10-28" } });
    expect(await pages.calendar({ start: "26/10/2026" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The start must be a date, YYYY-MM-DD.",
    });
    const refusing = new PostPagesController(
      { ...useCases, getCalendar: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.calendar({ start: null })).toMatchObject({ status: 403 });
  });
});

describe("the post page", () => {
  const published = aPost({
    lifecycle: "DONE",
    resumeAt: T0 + 5 * MINUTE,
    parts: [part("a", sentState("x-1")), part("b", sentState("x-2"))],
    version: 4,
  });

  it("shows the post, its parts and its newest metrics", async () => {
    const { pages, world } = await setup([published]);
    await world.metrics.addSnapshots([
      {
        xPostId: xPostId("x-1"),
        accountId: ACCOUNT,
        takenAt: T0 + HOUR,
        impressions: 10,
        likes: 2,
        reposts: 1,
        replies: 3,
        quotes: 4,
        bookmarks: 5,
        urlLinkClicks: null,
        userProfileClicks: null,
      },
    ]);
    expect(await pages.detail("post-1")).toStrictEqual({
      kind: "page",
      view: {
        id: "post-1",
        account: "@musechat_one",
        status: "PUBLISHED",
        lifecycle: "DONE",
        publishAt: "2026-10-27 12:00 UTC",
        publishAtInput: "2026-10-27T12:00",
        resumeAt: "2026-10-27 12:05 UTC",
        createdBy: "human:owner",
        version: 4,
        parts: [
          { number: 1, text: "a", media: "", state: "SENT", xPostId: "x-1" },
          { number: 2, text: "b", media: "", state: "SENT", xPostId: "x-2" },
        ],
        actions: {
          edit: false,
          approve: false,
          reject: false,
          cancel: false,
          delete: true,
          reschedule: false,
          confirmNotOnX: false,
        },
        metrics: [
          {
            xPostId: "x-1",
            takenAt: "2026-10-27 13:00 UTC",
            impressions: 10,
            likes: 2,
            reposts: 1,
            replies: 3,
            quotes: 4,
            bookmarks: 5,
          },
        ],
      },
    });
  });

  it("joins media ids, and shows no metrics when they are refused", async () => {
    const { pages, useCases, world } = await setup();
    const media = await world.stage(ACCOUNT, "PHOTO", "m-a");
    const other = await world.stage(ACCOUNT, "PHOTO", "m-b");
    await world.writer.add(aPost({ parts: [part("x", undefined, [media.id, other.id])] }));
    const refusing = new PostPagesController(
      { ...useCases, getPostMetrics: presenting({ ok: false, code: "scope" }) },
      world.clock,
    );
    expect(await refusing.detail("post-1")).toMatchObject({
      view: { resumeAt: null, metrics: [], parts: [{ media: "m-a,m-b" }] },
    });
    expect(await pages.detail("nope")).toStrictEqual({
      kind: "refused",
      status: 404,
      message: "Not found.",
    });
  });

  it("offers the buttons the post's state allows", () => {
    const actions = (post: Post) => {
      const offered = postActions(toPostView(post));
      return Object.entries(offered)
        .filter(([, on]) => on)
        .map(([name]) => name);
    };
    const done = (parts: Post["parts"]) => aPost({ lifecycle: "DONE", parts });
    expect(actions(aPost({ lifecycle: "DRAFT" }))).toStrictEqual(["edit", "cancel"]);
    expect(actions(aPost({ lifecycle: "PENDING_REVIEW" }))).toStrictEqual([
      "edit",
      "approve",
      "reject",
      "cancel",
    ]);
    expect(actions(aPost())).toStrictEqual(["edit", "cancel"]);
    expect(actions(aPost({ parts: [part("a", sentState("x")), part("b")] }))).toStrictEqual([]);
    expect(
      actions(aPost({ lifecycle: "RESUMING", parts: [part("a", sentState("x")), part("b")] })),
    ).toStrictEqual(["cancel"]);
    expect(actions(aPost({ lifecycle: "PUBLISHING" }))).toStrictEqual([]);
    expect(actions(aPost({ lifecycle: "CANCELLED" }))).toStrictEqual([]);
    expect(actions(aPost({ lifecycle: "MISSED" }))).toStrictEqual(["reschedule"]);
    const partial = done([part("a", sentState("x")), part("b", { kind: "REJECTED", reason: "r" })]);
    expect(derivedStatus(partial)).toBe("PARTIALLY_PUBLISHED");
    expect(actions(partial)).toStrictEqual(["delete"]);
    const incomplete = done([
      part("a", sentState("x")),
      part("b", { kind: "DELETED", xPostId: xPostId("y") }),
    ]);
    expect(actions(incomplete)).toStrictEqual(["delete"]);
    expect(actions(done([part("a", { kind: "REJECTED", reason: "r" })]))).toStrictEqual([
      "reschedule",
    ]);
    expect(actions(done([part("a", { kind: "NOT_FOUND", attemptAt: T0 })]))).toStrictEqual([
      "reschedule",
      "confirmNotOnX",
    ]);
    expect(actions(done([part("a", unknownState())]))).toStrictEqual([]);
    expect(actions(done([part("a", { kind: "DELETED", xPostId: xPostId("y") })]))).toStrictEqual(
      [],
    );
  });
});
