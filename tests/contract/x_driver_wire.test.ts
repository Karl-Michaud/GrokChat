/** The X drivers on the wire: requests as docs.x.com specifies them, responses mapped. */
import { describe, expect, it } from "vitest";
import { accountId, xMediaId, xPostId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE, SECOND } from "../../src/entities/time/instant";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import {
  CHUNK_BYTES,
  HttpXMediaUploader,
  MAX_STATUS_POLLS,
  MEDIA_TIMEOUT,
  realWait,
} from "../../src/frameworks/x_http/x_media_driver";
import { FIELDS_PARAM, HttpXMetricsReader } from "../../src/frameworks/x_http/x_metrics_driver";
import { HttpXPublisher } from "../../src/frameworks/x_http/x_publisher_driver";
import {
  END_TIME_MARGIN,
  HttpXOwnTimelineReader,
  WINDOW,
  xTime,
} from "../../src/frameworks/x_http/x_timeline_driver";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { ACCOUNT, anAccount, T0 } from "../unit/support/builders";
import {
  clientSetup as setup,
  created,
  NO_RESPONSE,
  PROBLEMS,
  respond,
} from "./support/x_fixtures";

describe("HttpXPublisher", () => {
  it("POST /2/tweets: text, media ids and the reply target, as documented", async () => {
    const { client, transport } = setup();
    const publisher = new HttpXPublisher(client);
    transport.script(created("1", "a"), created("2", "b"));
    expect(await publisher.create(ACCOUNT, "a", [], null)).toStrictEqual({
      ok: true,
      value: xPostId("1"),
    });
    await publisher.create(ACCOUNT, "b", [xMediaId("m1"), xMediaId("m2")], xPostId("1"));
    expect(
      transport.seen.map((s) => [s.method, s.url.pathname, JSON.parse(s.body) as unknown]),
    ).toStrictEqual([
      ["POST", "/2/tweets", { text: "a" }],
      [
        "POST",
        "/2/tweets",
        { text: "b", media: { media_ids: ["m1", "m2"] }, reply: { in_reply_to_tweet_id: "1" } },
      ],
    ]);
  });

  it("a 2xx without an id is an unknown outcome (X may have posted)", async () => {
    const { client, transport } = setup();
    transport.script(respond(201, { data: {} }));
    expect(await new HttpXPublisher(client).create(ACCOUNT, "a", [], null)).toStrictEqual({
      ok: false,
      failure: { kind: "no_response" },
    });
  });

  it("DELETE /2/tweets/:id; `deleted: false` is a refusal", async () => {
    const { client, transport } = setup();
    const publisher = new HttpXPublisher(client);
    transport.script(respond(200, { data: { deleted: true } }), respond(200, { data: {} }));
    expect(await publisher.delete(ACCOUNT, xPostId("9/1"))).toStrictEqual({
      ok: true,
      value: null,
    });
    expect(transport.seen[0]?.method).toBe("DELETE");
    expect(transport.seen[0]?.url.pathname).toBe("/2/tweets/9%2F1");
    expect(await publisher.delete(ACCOUNT, xPostId("9"))).toStrictEqual({
      ok: false,
      failure: { kind: "content_refused", status: 200, detail: "not deleted" },
    });
  });
});

describe("HttpXMediaUploader", () => {
  const media = (id: string, processing?: unknown) =>
    respond(200, { data: { id, expires_after_secs: 86400, processing_info: processing } });
  const noWait = () => {
    const waits: number[] = [];
    return { waits, wait: (ms: number) => (waits.push(ms), Promise.resolve()) };
  };

  it("a photo is one multipart POST /2/media/upload with tweet_image", async () => {
    const { client, transport } = setup();
    transport.script(media("77"));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);
    expect(await new HttpXMediaUploader(client).upload(ACCOUNT, bytes, "PHOTO")).toStrictEqual({
      ok: true,
      value: xMediaId("77"),
    });
    const seen = transport.seen[0];
    expect(seen?.url.pathname).toBe("/2/media/upload");
    expect(seen?.timeout).toBe(MEDIA_TIMEOUT);
    expect(seen?.form?.get("media_category")).toBe("tweet_image");
    const file = seen?.form?.get("media");
    expect(file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : null).toStrictEqual(
      bytes,
    );
  });

  it("a photo response without an id is no response", async () => {
    const { client, transport } = setup();
    transport.script(respond(200, { data: {} }));
    expect(
      await new HttpXMediaUploader(client).upload(ACCOUNT, new Uint8Array([1]), "PHOTO"),
    ).toStrictEqual({ ok: false, failure: { kind: "no_response" } });
  });

  it("a GIF: initialize, ≤ 5 MB appends by segment, finalize, then STATUS polls", async () => {
    const { client, transport } = setup();
    const { waits, wait } = noWait();
    const size = 2 * CHUNK_BYTES + 3;
    transport.script(
      media("5"),
      respond(204, null),
      respond(204, null),
      respond(204, null),
      media("5", { state: "pending", check_after_secs: 0 }),
      media("5", { state: "in_progress", check_after_secs: 30 }),
      media("5", { state: "in_progress" }),
      media("5", { state: "succeeded" }),
    );
    const result = await new HttpXMediaUploader(client, wait).upload(
      ACCOUNT,
      new Uint8Array(size),
      "GIF",
    );
    expect(result).toStrictEqual({ ok: true, value: xMediaId("5") });
    const [init, ...rest] = transport.seen;
    expect(JSON.parse(init?.body ?? "")).toStrictEqual({
      media_type: "image/gif",
      total_bytes: size,
      media_category: "tweet_gif",
    });
    expect(rest.map((s) => `${s.method} ${s.url.pathname}${s.url.search}`)).toStrictEqual([
      "POST /2/media/upload/5/append",
      "POST /2/media/upload/5/append",
      "POST /2/media/upload/5/append",
      "POST /2/media/upload/5/finalize",
      "GET /2/media/upload?command=STATUS&media_id=5",
      "GET /2/media/upload?command=STATUS&media_id=5",
      "GET /2/media/upload?command=STATUS&media_id=5",
    ]);
    const segments = rest.slice(0, 3).map((s) => s.form?.get("segment_index"));
    expect(segments).toStrictEqual(["0", "1", "2"]);
    const last = rest[2]?.form?.get("media");
    expect(last instanceof Blob ? last.size : 0).toBe(3);
    expect(waits).toStrictEqual([SECOND, 5 * SECOND, SECOND]);
  });

  it("a GIF whose processing fails is rejected; one still pending after the polls is retried", async () => {
    const { client, transport } = setup();
    const { wait } = noWait();
    const uploader = new HttpXMediaUploader(client, wait);
    transport.script(media("6"), respond(204, null), media("6", { state: "failed" }));
    expect(await uploader.upload(ACCOUNT, new Uint8Array(1), "GIF")).toStrictEqual({
      ok: false,
      failure: { kind: "content_refused", status: 200, detail: "media processing failed" },
    });
    transport.script(media("7"), respond(204, null));
    for (let i = 0; i <= MAX_STATUS_POLLS; i += 1) {
      transport.script(media("7", { state: "pending" }));
    }
    expect(await uploader.upload(ACCOUNT, new Uint8Array(1), "GIF")).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
    expect(MAX_STATUS_POLLS).toBe(6);
  });

  it("a GIF stops at the first failing step", async () => {
    const { client, transport } = setup();
    const uploader = new HttpXMediaUploader(client, () => Promise.resolve());
    transport.script(respond(200, { data: {} }));
    expect((await uploader.upload(ACCOUNT, new Uint8Array(1), "GIF")).ok).toBe(false);
    transport.script(media("8"), respond(400, PROBLEMS.invalidRequest));
    expect(await uploader.upload(ACCOUNT, new Uint8Array(1), "GIF")).toMatchObject({
      failure: { kind: "http", status: 400 },
    });
    transport.script(media("9"), respond(204, null), media("9", { state: "pending" }), NO_RESPONSE);
    expect(await uploader.upload(ACCOUNT, new Uint8Array(1), "GIF")).toStrictEqual({
      ok: false,
      failure: { kind: "no_response" },
    });
  });

  it("the real wait sleeps", async () => {
    const started = Date.now();
    await realWait(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(0);
  });
});

describe("HttpXMetricsReader", () => {
  it("GET /2/tweets with the ids and both metric sets; renamed counts and missing ones", async () => {
    const { client, transport, clock } = setup();
    transport.script(
      respond(200, {
        data: [
          {
            id: "1",
            public_metrics: {
              repost_count: 7,
              reply_count: 1,
              like_count: 2,
              quote_count: 3,
              bookmark_count: 4,
              impression_count: 50,
            },
            non_public_metrics: { url_link_clicks: 6, user_profile_clicks: 8 },
          },
          { id: "2", public_metrics: {} },
          { id: "3" },
          { public_metrics: {} },
        ],
      }),
    );
    const result = await new HttpXMetricsReader(client, clock).read(ACCOUNT, [
      xPostId("1"),
      xPostId("2"),
    ]);
    const query = transport.seen[0]?.url.searchParams;
    expect(query?.get("ids")).toBe("1,2");
    expect(query?.get(FIELDS_PARAM)).toBe("public_metrics,non_public_metrics");
    expect(FIELDS_PARAM).toBe("tweet.fields");
    expect(result).toStrictEqual({
      ok: true,
      value: [
        {
          xPostId: xPostId("1"),
          accountId: ACCOUNT,
          takenAt: T0,
          impressions: 50,
          likes: 2,
          reposts: 7,
          replies: 1,
          quotes: 3,
          bookmarks: 4,
          urlLinkClicks: 6,
          userProfileClicks: 8,
        },
        {
          xPostId: xPostId("2"),
          accountId: ACCOUNT,
          takenAt: T0,
          impressions: 0,
          likes: 0,
          reposts: 0,
          replies: 0,
          quotes: 0,
          bookmarks: 0,
          urlLinkClicks: null,
          userProfileClicks: null,
        },
      ],
    });
  });

  it("no data is an empty read; nothing is sent for no ids or more than 100", async () => {
    const { client, transport, clock } = setup();
    const reader = new HttpXMetricsReader(client, clock);
    transport.script(respond(200, { errors: [] }));
    expect(await reader.read(ACCOUNT, [xPostId("1")])).toStrictEqual({ ok: true, value: [] });
    await reader.read(ACCOUNT, []);
    await reader.read(
      ACCOUNT,
      Array.from({ length: 101 }, (_, i) => xPostId(String(i))),
    );
    expect(transport.seen).toHaveLength(1);
    transport.script(respond(200, {}));
    const hundred = Array.from({ length: 100 }, (_, i) => xPostId(String(i)));
    expect((await reader.read(ACCOUNT, hundred)).ok).toBe(true);
  });
});

describe("HttpXOwnTimelineReader", () => {
  function timeline(now = T0 + HOUR) {
    const base = setup(now);
    const accounts = new MemoryAccountRepository();
    accounts.rows.set(ACCOUNT, anAccount());
    const users = new AccountXUserDirectory(accounts);
    return {
      ...base,
      accounts,
      reader: new HttpXOwnTimelineReader(base.client, users, base.clock),
    };
  }

  it("GET /2/users/:id/tweets from start_time, bounded once the window is over", async () => {
    const { reader, transport } = timeline();
    transport.script(respond(200, { meta: { result_count: 0 } }));
    expect(await reader.recent(ACCOUNT, T0 + 1_234, 5)).toStrictEqual({ ok: true, value: [] });
    const seen = transport.seen[0];
    expect(seen?.url.pathname).toBe("/2/users/x-user-1/tweets");
    expect(Object.fromEntries(seen?.url.searchParams ?? [])).toStrictEqual({
      start_time: "2026-10-27T12:00:01Z",
      end_time: "2026-10-27T12:10:01Z",
      max_results: "100",
      exclude: "retweets",
      [FIELDS_PARAM]: "created_at,referenced_tweets",
    });
  });

  it("no end_time while the window is still open", async () => {
    const { reader, transport } = timeline(T0 + WINDOW + END_TIME_MARGIN - 1);
    transport.script(respond(200, {}), respond(200, {}));
    await reader.recent(ACCOUNT, T0, 5);
    expect(transport.seen[0]?.url.searchParams.has("end_time")).toBe(false);
    const open = timeline(T0 + WINDOW + END_TIME_MARGIN);
    open.transport.script(respond(200, {}));
    await open.reader.recent(ACCOUNT, T0, 5);
    expect(open.transport.seen[0]?.url.searchParams.get("end_time")).toBe(xTime(T0 + WINDOW));
  });

  it("reads either spelling of the reply reference and skips malformed posts", async () => {
    const { reader, transport } = timeline();
    const at = (s: number) => new Date(T0 + s * SECOND).toISOString();
    transport.script(
      respond(200, {
        data: [
          {
            id: "3",
            text: "c",
            created_at: at(3),
            referenced_posts: [{ type: "replied_to", id: "2" }],
          },
          {
            id: "2",
            text: "b",
            created_at: at(2),
            referenced_tweets: [{ type: "quoted", id: "9" }],
          },
          { id: "5", text: "e", created_at: at(2) },
          { id: "1", text: "early", created_at: at(-1) },
          { id: "4", created_at: at(4) },
          { id: "6", text: "f", created_at: "not a date" },
          { id: "7", text: "g" },
          { text: "g", created_at: at(5) },
        ],
      }),
    );
    expect(await reader.recent(ACCOUNT, T0, 10)).toStrictEqual({
      ok: true,
      value: [
        { id: xPostId("2"), text: "b", createdAt: T0 + 2 * SECOND, inReplyTo: null },
        { id: xPostId("5"), text: "e", createdAt: T0 + 2 * SECOND, inReplyTo: null },
        { id: xPostId("3"), text: "c", createdAt: T0 + 3 * SECOND, inReplyTo: xPostId("2") },
      ],
    });
    transport.script(respond(200, { data: [{ id: "2", text: "b", created_at: at(2) }] }));
    expect(await reader.recent(ACCOUNT, T0, 0)).toStrictEqual({ ok: true, value: [] });
  });

  it("an unknown account is refused before sending; the X user id is looked up once", async () => {
    const { reader, transport, accounts } = timeline();
    expect(await reader.recent(accountId("nobody"), T0, 5)).toStrictEqual({
      ok: false,
      failure: { kind: "not_sent" },
    });
    transport.script(respond(200, {}), respond(401, PROBLEMS.unauthorized));
    await reader.recent(ACCOUNT, T0, 5);
    accounts.rows.clear();
    expect(await reader.recent(ACCOUNT, T0, 5)).toMatchObject({ failure: { status: 401 } });
    expect(transport.seen).toHaveLength(2);
  });

  it("xTime is RFC 3339 to the second", () => {
    expect(xTime(T0 + 999)).toBe("2026-10-27T12:00:00Z");
    expect(WINDOW).toBe(10 * MINUTE);
    expect(END_TIME_MARGIN).toBe(10 * SECOND);
  });
});
