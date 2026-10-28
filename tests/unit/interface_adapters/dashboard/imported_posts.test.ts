/** Posts made outside GrokChat on the dashboard's posts page (GROKCHAT-19). */
import { describe, expect, it } from "vitest";
import { accountId, xPostId } from "../../../../src/entities/identity/ids";
import { DAY, HOUR } from "../../../../src/entities/time/instant";
import { POSTED_ON_X } from "../../../../src/interface_adapters/dashboard/post_list_views";
import { ACCOUNT, aSnapshot, T0 } from "../../support/builders";
import { setupPosts } from "../../support/dashboard";

const query = {
  account: null,
  status: null,
  from: null,
  to: null,
  sort: null,
  dir: null,
  page: null,
};

const outside = (id: string, at: number, account = ACCOUNT) => ({
  xPostId: xPostId(id),
  accountId: account,
  text: `from the X app ${id}`,
  createdAt: at,
  inReplyTo: null,
  importedAt: T0,
});

describe("the posts page, with posts made outside GrokChat (GROKCHAT-19)", () => {
  it("shows them as posted on X, linking to the post on X, with their metrics", async () => {
    const { pages, world } = await setupPosts();
    await world.imported.add([
      outside("x-9", T0 - DAY),
      outside("x-8", T0 - 2 * DAY, accountId("acc-9")),
    ]);
    await world.metrics.addSnapshots([aSnapshot("x-9", T0 - HOUR, 2_000)]);
    const outcome = await pages.posts(query);
    if (outcome.kind !== "page") {
      throw new Error(outcome.kind);
    }
    expect(outcome.view.rows[0]).toStrictEqual({
      href: "https://x.com/musechat_one/status/x-9",
      account: { id: "acc-1", handle: "@musechat_one", initials: "MO", tone: 1 },
      status: { label: "Posted on X", tone: "neutral" },
      text: "from the X app x-9",
      parts: 1,
      when: "Oct 26, 12:00 UTC",
      relative: "1 d ago",
      metrics: {
        impressions: "2K",
        engagements: "340",
        likes: "200",
        reposts: "40",
        replies: "20",
        linkClicks: "0",
      },
      xUrl: "https://x.com/musechat_one/status/x-9",
    });
    expect(outcome.view.rows[1]).toMatchObject({
      href: "https://x.com/i/web/status/x-8",
      status: POSTED_ON_X,
      metrics: { impressions: "—" },
    });
  });
});
