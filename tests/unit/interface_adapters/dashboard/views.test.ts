import { describe, expect, it } from "vitest";
import { ZERO } from "../../../../src/entities/analytics/metric_values";
import { accountId, postId, xPostId, xUserId } from "../../../../src/entities/identity/ids";
import { DAY } from "../../../../src/entities/time/instant";
import {
  accountOptions,
  badgeOf,
  bareHandle,
  initialsOf,
} from "../../../../src/interface_adapters/dashboard/account_directory";
import {
  activityRow,
  costLabel,
} from "../../../../src/interface_adapters/dashboard/activity_views";
import {
  accountStatusChip,
  actionChip,
  actionLabel,
  postStatusChip,
} from "../../../../src/interface_adapters/dashboard/chips";
import {
  href,
  liveUrl,
  postHref,
  xPostUrl,
} from "../../../../src/interface_adapters/dashboard/links";
import { mediaMeters } from "../../../../src/interface_adapters/dashboard/media_views";
import { metricCells } from "../../../../src/interface_adapters/dashboard/metric_cells";
import { oneOf, optional, pageNumber } from "../../../../src/interface_adapters/dashboard/query";
import { anAccount, T0 } from "../../support/builders";

const accounts = [
  anAccount({ id: accountId("a-1"), handle: "musechat_daily" }),
  anAccount({ id: accountId("a-2"), xUserId: xUserId("x-2"), handle: "museChat" }),
  ...Array.from({ length: 8 }, (_, n) =>
    anAccount({
      id: accountId(`b-${String(n)}`),
      xUserId: xUserId(`x-b${String(n)}`),
      handle: `h${String(n)}`,
    }),
  ),
];

describe("links (GROKCHAT-15)", () => {
  it("keeps the query values that are set, encoded, in order", () => {
    expect(href("/p")).toBe("/p");
    expect(href("/p", { a: null, b: "" })).toBe("/p");
    expect(href("/p", { a: "1", b: null, c: "x y&z" })).toBe("/p?a=1&c=x%20y%26z");
    expect(postHref("a/b")).toBe("/dashboard/posts/a%2Fb");
  });

  it("links to X by handle, or by id alone; only while the part is there", () => {
    expect(xPostUrl("muse", xPostId("123"))).toBe("https://x.com/muse/status/123");
    expect(xPostUrl(null, xPostId("123"))).toBe("https://x.com/i/web/status/123");
    const part = { text: "", media: [], xPostId: xPostId("9") };
    expect(liveUrl("m", { ...part, state: "SENT" })).toBe("https://x.com/m/status/9");
    expect(liveUrl("m", { ...part, state: "DELETED" })).toBeNull();
    expect(liveUrl("m", { ...part, state: "SENT", xPostId: null })).toBeNull();
  });
});

describe("account badges", () => {
  it.each([
    ["musechat_daily", "MD"],
    ["museChat", "MC"],
    ["muse.labs", "ML"],
    ["muse-2", "MU"],
    ["x", "X"],
    ["42", "42"],
    ["a1b", "AB"],
    ["_muse", "MU"],
    ["1234", "12"],
  ])("initialsOf(%s) = %s", (handle, initials) => {
    expect(initialsOf(handle)).toBe(initials);
  });

  it("a tone per place in the list, cycling past eight; unknown ids are neutral", () => {
    expect(badgeOf(accounts, "a-1")).toStrictEqual({
      id: "a-1",
      handle: "@musechat_daily",
      initials: "MD",
      tone: 1,
    });
    expect(badgeOf(accounts, "a-2").tone).toBe(2);
    expect(badgeOf(accounts, "b-6").tone).toBe(1);
    expect(badgeOf(accounts, "zq-9")).toStrictEqual({
      id: "zq-9",
      handle: "zq-9",
      initials: "ZQ",
      tone: 0,
    });
    expect([bareHandle(accounts, "a-2"), bareHandle(accounts, "nope")]).toStrictEqual([
      "museChat",
      null,
    ]);
    expect(
      accountOptions(accounts.slice(0, 2), "a-2").map((option) => [option.handle, option.selected]),
    ).toStrictEqual([
      ["@musechat_daily", false],
      ["@museChat", true],
    ]);
  });
});

describe("chips", () => {
  it("label every status with a tone", () => {
    expect(postStatusChip("PUBLISHED")).toStrictEqual({ label: "Published", tone: "good" });
    expect(postStatusChip("PENDING_REVIEW")).toStrictEqual({
      label: "Needs review",
      tone: "warning",
    });
    expect(postStatusChip("FAILED")).toStrictEqual({ label: "Failed", tone: "critical" });
    expect(postStatusChip("SCHEDULED").tone).toBe("info");
    expect(accountStatusChip("ACTIVE")).toStrictEqual({ label: "Active", tone: "good" });
    expect(accountStatusChip("PAUSED")).toStrictEqual({ label: "Paused", tone: "warning" });
    expect(accountStatusChip("NEEDS_RECONNECT")).toStrictEqual({
      label: "Reconnect needed",
      tone: "critical",
    });
    expect(accountStatusChip("DISCONNECTED").tone).toBe("critical");
  });

  it("name actions, refusals included, coloured by kind", () => {
    expect(actionLabel("post.create")).toBe("Created a post");
    expect(actionLabel("refused.post.edit")).toBe("Refused: Edited a post");
    expect(actionLabel("refused.refused.x")).toBe("Refused: Refused: x");
    expect(actionLabel("odd.thing")).toBe("odd.thing");
    expect(actionChip("x.create")).toStrictEqual({ label: "Published on X", tone: "good" });
    expect(actionChip("refused.post.create").tone).toBe("critical");
    expect(actionChip("x.read").tone).toBe("neutral");
    expect(actionChip("account.paused")).toStrictEqual({
      label: "Paused an account",
      tone: "info",
    });
    expect(actionChip("post.delete").tone).toBe("info");
    expect(actionChip("odd.thing")).toStrictEqual({ label: "odd.thing", tone: "neutral" });
  });
});

describe("query values", () => {
  const allowed = ["a", "b"] as const;
  it("oneOf: the fallback when absent, null when unknown", () => {
    expect([
      oneOf(null, allowed, "a"),
      oneOf(" ", allowed, "a"),
      oneOf(" b ", allowed, "a"),
      oneOf("c", allowed, "a"),
    ]).toStrictEqual(["a", "a", "b", null]);
  });
  it("optional: null when absent, invalid when unknown", () => {
    expect([
      optional(null, allowed),
      optional("", allowed),
      optional("b", allowed),
      optional("c", allowed),
    ]).toStrictEqual([null, null, "b", "invalid"]);
  });
  it("pageNumber: whole numbers from 1", () => {
    expect([
      pageNumber(null),
      pageNumber(""),
      pageNumber("3"),
      pageNumber("0"),
      pageNumber("1.5"),
      pageNumber("02"),
      pageNumber("x"),
    ]).toStrictEqual([1, 1, 3, null, null, null, null]);
  });
});

describe("cells, meters and activity rows", () => {
  it("metric cells are compact, every one a dash before the first read", () => {
    expect(metricCells(null)).toStrictEqual({
      impressions: "—",
      engagements: "—",
      likes: "—",
      reposts: "—",
      replies: "—",
      linkClicks: "—",
    });
    expect(
      metricCells({
        ...ZERO,
        impressions: 12_345,
        likes: 3,
        reposts: 4,
        replies: 5,
        linkClicks: 6,
        quotes: 1,
      }),
    ).toStrictEqual({
      impressions: "12.3K",
      engagements: "19",
      likes: "3",
      reposts: "4",
      replies: "5",
      linkClicks: "6",
    });
  });

  it("R2 meters: storage in GB, operations compact, against the allowance with the guard", () => {
    const meters = mediaMeters(
      { month: "2026-10", storedBytes: 8_500_000_000, classA: 1_000, classB: 0 },
      { storedBytes: 8e9, classA: 800_000, classB: 8e6 },
      { storedBytes: 1e10, classA: 1e6, classB: 1e7 },
    );
    expect(meters).toStrictEqual([
      { name: "Storage", used: "8.5 GB of 10 GB", guard: "8 GB", percent: 85, tone: "danger" },
      { name: "Writes (Class A)", used: "1K of 1M", guard: "800K", percent: 0.1, tone: "ok" },
      { name: "Reads (Class B)", used: "0 of 10M", guard: "8M", percent: 0, tone: "ok" },
    ]);
    const tiny = mediaMeters(
      { month: "m", storedBytes: 1_234, classA: 0, classB: 0 },
      { storedBytes: 8e9, classA: 1, classB: 1 },
      { storedBytes: 1e10, classA: 1, classB: 1 },
    );
    expect(tiny[0]?.used).toBe("0 GB of 10 GB");
  });

  it("costs: dollars, unpriced, or nothing for no X call", () => {
    expect([
      costLabel(null),
      costLabel({ kind: "unknown" }),
      costLabel({ kind: "usd", micros: 15_000 }),
    ]).toStrictEqual(["", "unpriced", "$0.015"]);
  });

  it("an activity row: who, what, where, when and the cost", () => {
    const entry = {
      at: T0 - DAY,
      actor: "bot:muse",
      action: "post.create",
      accountId: accountId("a-1"),
      postId: postId("p"),
      detail: "d",
      cost: null,
    };
    expect(activityRow(entry, accounts, T0)).toStrictEqual({
      when: "Oct 26, 12:00 UTC",
      relative: "1 d ago",
      actor: { kind: "bot", name: "muse" },
      action: { label: "Created a post", tone: "info" },
      account: badgeOf(accounts, "a-1"),
      postHref: "/dashboard/posts/p",
      detail: "d",
      cost: "",
    });
    const odd = activityRow(
      { ...entry, actor: "robot", accountId: null, postId: null },
      accounts,
      T0,
    );
    expect([odd.actor, odd.account, odd.postHref]).toStrictEqual([
      { kind: null, name: "robot" },
      null,
      null,
    ]);
    expect(activityRow({ ...entry, actor: "system:x" }, accounts, T0).actor).toStrictEqual({
      kind: "system",
      name: "x",
    });
  });
});
