/** The timeline page read of the import (GROKCHAT-19) on the wire, as docs.x.com specifies it. */
import { describe, expect, it } from "vitest";
import { accountId, xPostId } from "../../src/entities/identity/ids";
import { DAY, SECOND } from "../../src/entities/time/instant";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import { FIELDS_PARAM } from "../../src/frameworks/x_http/x_metrics_driver";
import { HttpXOwnTimelineReader } from "../../src/frameworks/x_http/x_timeline_driver";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { ACCOUNT, anAccount, T0 } from "../unit/support/builders";
import { clientSetup, PROBLEMS, respond } from "./support/x_fixtures";

function timeline() {
  const base = clientSetup(T0 + DAY);
  const accounts = new MemoryAccountRepository();
  accounts.rows.set(ACCOUNT, anAccount());
  const reader = new HttpXOwnTimelineReader(
    base.client,
    new AccountXUserDirectory(accounts),
    base.clock,
  );
  return { ...base, reader };
}

describe("HttpXOwnTimelineReader.page", () => {
  it("GET /2/users/:id/tweets from start_time with no end_time; the token continues", async () => {
    const { reader, transport } = timeline();
    transport.script(
      respond(200, { meta: { result_count: 0, next_token: "abc" } }),
      respond(200, { meta: { result_count: 0 } }),
    );
    expect(await reader.page(ACCOUNT, T0 + 1_234, null)).toStrictEqual({
      ok: true,
      value: { posts: [], next: "abc" },
    });
    expect(await reader.page(ACCOUNT, T0, "abc")).toStrictEqual({
      ok: true,
      value: { posts: [], next: null },
    });
    const [first, second] = transport.seen;
    expect(first?.url.pathname).toBe("/2/users/x-user-1/tweets");
    expect(Object.fromEntries(first?.url.searchParams ?? [])).toStrictEqual({
      start_time: "2026-10-27T12:00:01Z",
      max_results: "100",
      exclude: "retweets",
      [FIELDS_PARAM]: "created_at,referenced_tweets",
    });
    expect(second?.url.searchParams.get("pagination_token")).toBe("abc");
  });

  it("keeps X's newest-first order, reads replies, and skips malformed posts", async () => {
    const { reader, transport } = timeline();
    const at = (s: number) => new Date(T0 + s * SECOND).toISOString();
    transport.script(
      respond(200, {
        data: [
          {
            id: "3",
            text: "c",
            created_at: at(3),
            referenced_tweets: [{ type: "replied_to", id: "1" }],
          },
          { id: "2", text: "b", created_at: at(2) },
          { id: "4", created_at: at(4) },
        ],
      }),
    );
    expect(await reader.page(ACCOUNT, T0, null)).toStrictEqual({
      ok: true,
      value: {
        posts: [
          { id: xPostId("3"), text: "c", createdAt: T0 + 3 * SECOND, inReplyTo: xPostId("1") },
          { id: xPostId("2"), text: "b", createdAt: T0 + 2 * SECOND, inReplyTo: null },
        ],
        next: null,
      },
    });
  });

  it("an unknown account is refused before sending; an X refusal is returned", async () => {
    const { reader, transport } = timeline();
    expect(await reader.page(accountId("nobody"), T0, null)).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
    transport.script(respond(401, PROBLEMS.unauthorized));
    expect(await reader.page(ACCOUNT, T0, null)).toMatchObject({ failure: { status: 401 } });
    expect(transport.seen).toHaveLength(1);
  });
});
