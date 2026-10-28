import { describe, expect, it } from "vitest";
import { accountId, postId, xPostId } from "../../../../src/entities/identity/ids";
import { derivedStatus } from "../../../../src/entities/posts/derived_status";
import type { Post } from "../../../../src/entities/posts/post";
import { DAY, HOUR, MINUTE } from "../../../../src/entities/time/instant";
import { PAGE_SIZE } from "../../../../src/interface_adapters/dashboard/posts_controller";
import {
  sortColumns,
  STATUS_OPTIONS,
} from "../../../../src/interface_adapters/dashboard/post_list_views";
import {
  impressionsOverTime,
  postActions,
} from "../../../../src/interface_adapters/dashboard/post_views";
import { toPostView } from "../../../../src/use_cases/views/post_view";
import {
  ACCOUNT,
  aPost,
  aSnapshot,
  part,
  sentState,
  T0,
  unknownState,
} from "../../support/builders";
import { presenting, setupPosts as setup } from "../../support/dashboard";

const query = (overrides = {}) => ({
  account: null,
  status: null,
  from: null,
  to: null,
  sort: null,
  dir: null,
  page: null,
  ...overrides,
});

const published = aPost({
  id: postId("pub"),
  lifecycle: "DONE",
  publishAt: T0 - DAY,
  parts: [part("live one", sentState("x-1", T0 - DAY)), part("two", sentState("x-2", T0 - DAY))],
});
const scheduled = aPost({ id: postId("sch"), publishAt: T0 + HOUR, parts: [part("later")] });
const foreign = aPost({
  id: postId("for"),
  accountId: accountId("acc-9"),
  lifecycle: "PENDING_REVIEW",
  publishAt: T0 - 3 * DAY,
});

describe("the posts page (GROKCHAT-15)", () => {
  it("every post, newest first, with its account, status, time and metrics", async () => {
    const { pages, world } = await setup([published, scheduled, foreign]);
    await world.metrics.addSnapshots([
      aSnapshot("x-1", T0 - HOUR, 1_200),
      aSnapshot("x-2", T0 - HOUR, 34),
    ]);
    const outcome = await pages.posts(query());
    if (outcome.kind !== "page") {
      throw new Error(outcome.kind);
    }
    const { view } = outcome;
    expect(view.rows.map((row) => row.href)).toStrictEqual([
      "/dashboard/posts/sch",
      "/dashboard/posts/pub",
      "/dashboard/posts/for",
    ]);
    expect(view.rows[1]).toStrictEqual({
      href: "/dashboard/posts/pub",
      account: { id: "acc-1", handle: "@musechat_one", initials: "MO", tone: 1 },
      status: { label: "Published", tone: "good" },
      text: "live one",
      parts: 2,
      when: "Oct 26, 12:00 UTC",
      relative: "1 d ago",
      metrics: {
        impressions: "1.2K",
        engagements: "208",
        likes: "123",
        reposts: "24",
        replies: "12",
        linkClicks: "0",
      },
      xUrl: "https://x.com/musechat_one/status/x-1",
    });
    expect(view.rows[0]).toMatchObject({
      relative: "in 1 h",
      xUrl: null,
      metrics: { impressions: "—" },
    });
    expect(view.rows[2]).toMatchObject({
      account: { handle: "acc-9", tone: 0 },
      status: { label: "Needs review" },
    });
    expect([
      view.total,
      view.page,
      view.pages,
      view.previous,
      view.next,
      view.filtered,
    ]).toStrictEqual(["3", 1, 1, null, null, false]);
    expect(view.statuses).toHaveLength(STATUS_OPTIONS.length);
    expect(view.columns[0]).toStrictEqual({
      key: "time",
      label: "Publish time",
      href: "/dashboard/posts?sort=time&dir=asc",
      sorted: "desc",
    });
    expect(view.columns[1]).toStrictEqual({
      key: "impressions",
      label: "Impressions",
      href: "/dashboard/posts?sort=impressions&dir=desc",
      sorted: null,
    });
  });

  it("filters by account, status and dates, and keeps them in every link", async () => {
    const { pages } = await setup([published, scheduled, foreign]);
    const rows = async (overrides: object) => {
      const outcome = await pages.posts(query(overrides));
      return outcome.kind === "page" ? outcome.view.rows.map((row) => row.href.slice(17)) : outcome;
    };
    expect(await rows({ account: "acc-9" })).toStrictEqual(["for"]);
    expect(await rows({ status: "SCHEDULED" })).toStrictEqual(["sch"]);
    expect(await rows({ from: "2026-10-26" })).toStrictEqual(["sch", "pub"]);
    expect(await rows({ to: "2026-10-26" })).toStrictEqual(["pub", "for"]);
    expect(await rows({ from: "2026-10-26", to: "2026-10-26" })).toStrictEqual(["pub"]);
    const outcome = await pages.posts(
      query({
        account: "acc-1",
        status: "PUBLISHED",
        from: "2026-10-01",
        sort: "likes",
        dir: "asc",
      }),
    );
    expect(outcome).toMatchObject({
      view: { filtered: true, from: "2026-10-01", to: "", clearHref: "/dashboard/posts" },
    });
    if (outcome.kind === "page") {
      expect(outcome.view.columns.find((column) => column.key === "likes")).toMatchObject({
        sorted: "asc",
        href: "/dashboard/posts?account=acc-1&status=PUBLISHED&from=2026-10-01&sort=likes&dir=desc",
      });
      expect(outcome.view.statuses.find((status) => status.selected)?.value).toBe("PUBLISHED");
      expect(outcome.view.accounts.find((account) => account.selected)?.id).toBe("acc-1");
    }
    expect(await pages.posts(query({ to: "2026-10-26" }))).toMatchObject({
      view: { filtered: true, from: "", to: "2026-10-26" },
    });
    expect(await pages.posts(query({ account: "acc-1" }))).toMatchObject({
      view: { filtered: true },
    });
    expect(await pages.posts(query({ status: "FAILED" }))).toMatchObject({
      view: { filtered: true },
    });
    expect(await pages.posts(query({ sort: "likes" }))).toMatchObject({
      view: { filtered: false, from: "", to: "" },
    });
  });

  it("sorts by any metric, never-read posts last", async () => {
    const { pages, world } = await setup([
      published,
      scheduled,
      aPost({
        id: postId("low"),
        lifecycle: "DONE",
        publishAt: T0 - 2 * DAY,
        parts: [part("l", sentState("x-3"))],
      }),
    ]);
    await world.metrics.addSnapshots([aSnapshot("x-1", T0, 100), aSnapshot("x-3", T0, 500)]);
    const order = async (sort: string, dir: string) => {
      const outcome = await pages.posts(query({ sort, dir }));
      return outcome.kind === "page" ? outcome.view.rows.map((row) => row.href.slice(17)) : [];
    };
    expect(await order("impressions", "desc")).toStrictEqual(["low", "pub", "sch"]);
    expect(await order("impressions", "asc")).toStrictEqual(["pub", "low", "sch"]);
    expect(await order("time", "asc")).toStrictEqual(["low", "pub", "sch"]);
  });

  it("a post without parts lists with no text and no link", async () => {
    const { pages } = await setup([aPost({ id: postId("empty"), parts: [] })]);
    expect(await pages.posts(query())).toMatchObject({
      view: { rows: [{ text: "", parts: 0, xUrl: null }] },
    });
  });

  it("pages of 25, with previous and next links", async () => {
    const many = Array.from({ length: PAGE_SIZE + 3 }, (_, n) =>
      aPost({ id: postId(`p${String(n).padStart(2, "0")}`), publishAt: T0 + n * MINUTE }),
    );
    const { pages } = await setup(many);
    const first = await pages.posts(query());
    expect(first).toMatchObject({
      view: {
        page: 1,
        pages: 2,
        total: "28",
        previous: null,
        next: "/dashboard/posts?sort=time&dir=desc&page=2",
      },
    });
    const second = await pages.posts(query({ page: "2" }));
    expect(second).toMatchObject({
      view: { page: 2, previous: "/dashboard/posts?sort=time&dir=desc&page=1", next: null },
    });
    if (second.kind === "page") {
      expect(second.view.rows).toHaveLength(3);
    }
  });

  it("refuses unknown values and shows the use case's refusal", async () => {
    const { pages, useCases, world } = await setup();
    const refused = (message: string) => ({ kind: "refused", status: 400, message });
    expect(await pages.posts(query({ status: "LOST" }))).toStrictEqual(
      refused("Unknown status or sort."),
    );
    expect(await pages.posts(query({ sort: "views" }))).toStrictEqual(
      refused("Unknown status or sort."),
    );
    expect(await pages.posts(query({ dir: "up" }))).toStrictEqual(
      refused("Unknown status or sort."),
    );
    expect(await pages.posts(query({ from: "soon" }))).toStrictEqual(
      refused("Dates must be YYYY-MM-DD."),
    );
    expect(await pages.posts(query({ to: "2026-02-30" }))).toStrictEqual(
      refused("Dates must be YYYY-MM-DD."),
    );
    expect(await pages.posts(query({ page: "0" }))).toStrictEqual(refused("Unknown page."));
    const { PostsController } =
      await import("../../../../src/interface_adapters/dashboard/posts_controller");
    const refusing = new PostsController(
      { ...useCases, listPosts: presenting({ ok: false, code: "human_only" }) },
      world.clock,
    );
    expect(await refusing.posts(query())).toMatchObject({ kind: "refused", status: 403 });
  });

  it("sort columns flip the sorted one and start others descending", () => {
    const link = (key: string, dir: string) => `${key}:${dir}`;
    expect(
      sortColumns(["time", "likes"], "likes", "desc", link).map((column) => [
        column.href,
        column.sorted,
      ]),
    ).toStrictEqual([
      ["time:desc", null],
      ["likes:asc", "desc"],
    ]);
    expect(sortColumns(["likes"], "likes", "asc", link)[0]?.href).toBe("likes:desc");
  });
});

describe("a post's page", () => {
  it("the text of each part, the X links, the newest metrics, the chart and the history", async () => {
    const { pages, world } = await setup([published]);
    await world.metrics.addSnapshots([
      aSnapshot("x-1", T0 - 20 * HOUR, 100),
      aSnapshot("x-2", T0 - 20 * HOUR, 10),
      aSnapshot("x-1", T0 - 2 * HOUR, 300),
    ]);
    await world.audit.append({
      at: T0 - DAY,
      actor: "bot:bot-1",
      action: "post.create",
      accountId: ACCOUNT,
      postId: postId("pub"),
      detail: "",
    });
    const outcome = await pages.detail("pub");
    if (outcome.kind !== "page") {
      throw new Error(outcome.kind);
    }
    const { view } = outcome;
    expect([
      view.id,
      view.status,
      view.derived,
      view.lifecycle,
      view.publishAt,
      view.publishRelative,
      view.publishAtInput,
      view.resumeAt,
      view.createdBy,
      view.version,
    ]).toStrictEqual([
      "pub",
      { label: "Published", tone: "good" },
      "PUBLISHED",
      "DONE",
      "Oct 26, 12:00 UTC",
      "1 d ago",
      "2026-10-26T12:00",
      null,
      "human:owner",
      1,
    ]);
    expect(view.parts).toStrictEqual([
      {
        number: 1,
        text: "live one",
        media: "",
        state: { label: "On X", tone: "good" },
        xUrl: "https://x.com/musechat_one/status/x-1",
      },
      {
        number: 2,
        text: "two",
        media: "",
        state: { label: "On X", tone: "good" },
        xUrl: "https://x.com/musechat_one/status/x-2",
      },
    ]);
    expect(view.totals.impressions).toBe("310");
    expect(view.reads).toBe(3);
    expect(view.chart.columns.map((column) => [column.label, column.value])).toStrictEqual([
      ["Oct 26, 16:00 UTC", "110"],
      ["Oct 27, 10:00 UTC", "310"],
    ]);
    expect(view.timeline.map((row) => row.action.label)).toStrictEqual(["Created a post"]);
    expect(view.actions.delete).toBe(true);
  });

  it("a post never read has no totals; an unknown post is refused", async () => {
    const { pages, world } = await setup([aPost({ resumeAt: T0 + 5 * MINUTE })]);
    const media = await world.stage(ACCOUNT, "PHOTO", "m-a");
    await world.writer.add(
      aPost({ id: postId("m"), parts: [part("x", undefined, [media.id, media.id])] }),
    );
    expect(await pages.detail("post-1")).toMatchObject({
      view: {
        reads: 0,
        resumeAt: "Oct 27, 12:05 UTC",
        totals: { impressions: "—" },
        parts: [{ xUrl: null }],
      },
    });
    expect(await pages.detail("m")).toMatchObject({ view: { parts: [{ media: "m-a,m-a" }] } });
    expect(await pages.detail("nope")).toStrictEqual({
      kind: "refused",
      status: 404,
      message: "Not found.",
    });
  });

  it("impressions over time sum each part's newest read, one point per read time", () => {
    expect(
      impressionsOverTime([
        aSnapshot("a", 1, 10),
        aSnapshot("b", 1, 5),
        aSnapshot("a", 2, 20),
        aSnapshot("b", 3, 7),
      ]),
    ).toStrictEqual([
      { at: 1, value: 15 },
      { at: 2, value: 25 },
      { at: 3, value: 27 },
    ]);
    expect(impressionsOverTime([])).toStrictEqual([]);
  });

  it("offers the buttons the post's state allows", () => {
    const actions = (post: Post) =>
      Object.entries(postActions(toPostView(post)))
        .filter(([, on]) => on)
        .map(([name]) => name);
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
    expect(
      actions(
        done([part("a", sentState("x")), part("b", { kind: "DELETED", xPostId: xPostId("y") })]),
      ),
    ).toStrictEqual(["delete"]);
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
