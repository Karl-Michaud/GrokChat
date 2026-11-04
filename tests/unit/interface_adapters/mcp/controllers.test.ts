import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { botActor } from "../../support/builders";
import {
  CancelPostController,
  CreatePostController,
  CreateThreadController,
  DeletePostController,
  EditPostController,
  StageMediaFromUrlController,
  UploadMediaController,
} from "../../../../src/interface_adapters/mcp/authoring_controllers";
import type { CreatePostInputData } from "../../../../src/use_cases/create_post/input_data";
import {
  ComparePostsController,
  GetAccountMetricsController,
  GetPolicyController,
  GetPostController,
  GetPostMetricsController,
  ListAccountsController,
  LIST_MEDIA_DEFAULT_LIMIT,
  ListBacklogController,
  ListMediaController,
} from "../../../../src/interface_adapters/mcp/reading_controllers";
import {
  instantArg,
  optionalWindow,
  windowArg,
} from "../../../../src/interface_adapters/mcp/time_args";

const ACTOR = botActor();

/** A use case that records the input data it was given. */
class Spy<Input> {
  readonly inputs: Input[] = [];

  execute(input: Input): Promise<void> {
    this.inputs.push(input);
    return Promise.resolve();
  }
}

const NOON = "2026-10-27T14:00:00+02:00";
const NOON_MS = Date.UTC(2026, 9, 27, 12);
const LATE = Date.UTC(2026, 9, 28, 12);

describe("time arguments", () => {
  it("parse an ISO time with an offset as the instant it names; absent is null", () => {
    expect(instantArg(NOON)).toBe(NOON_MS);
    expect(instantArg("2026-10-27T12:00:00Z")).toBe(NOON_MS);
    expect(instantArg(undefined)).toBeNull();
  });

  it("round-trip any instant through ISO 8601 (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4_102_444_800_000 }), (ms) => {
        expect(instantArg(new Date(ms).toISOString())).toBe(ms);
      }),
    );
  });

  it("make an optional window: none, open at either end, or closed", () => {
    expect(optionalWindow(undefined, undefined)).toBeNull();
    expect(optionalWindow(NOON, undefined)).toStrictEqual({
      from: NOON_MS,
      to: Number.MAX_SAFE_INTEGER,
    });
    expect(optionalWindow(undefined, NOON)).toStrictEqual({ from: 0, to: NOON_MS });
    expect(optionalWindow(NOON, "2026-10-28T12:00:00Z")).toStrictEqual({
      from: NOON_MS,
      to: LATE,
    });
  });

  it("make a required window", () => {
    expect(windowArg(NOON, "2026-10-28T12:00:00Z")).toStrictEqual({ from: NOON_MS, to: LATE });
  });
});

describe("authoring controllers build each use case's input from the arguments", () => {
  it("create_post: one part, media ids, publish time and key", async () => {
    const spy = new Spy();
    await new CreatePostController(spy).handle(ACTOR, {
      account_id: "acc-1",
      text: "hi",
      media_ids: ["m-1", "m-2"],
      publish_at: NOON,
      idempotency_key: "k",
    });
    expect(spy.inputs).toStrictEqual([
      {
        actor: ACTOR,
        accountId: "acc-1",
        parts: [{ text: "hi", media: ["m-1", "m-2"] }],
        publishAt: NOON_MS,
        replyTo: null,
        idempotencyKey: "k",
      },
    ]);
  });

  it("create_post without media or time: no media, publish now", async () => {
    const spy = new Spy();
    await new CreatePostController(spy).handle(ACTOR, {
      account_id: "acc-1",
      text: "hi",
      idempotency_key: "k",
    });
    expect(spy.inputs[0]).toMatchObject({ parts: [{ text: "hi", media: [] }], publishAt: null });
  });

  it("create_post and create_thread pass in_reply_to through as the reply target", async () => {
    const spy = new Spy<CreatePostInputData>();
    await new CreatePostController(spy).handle(ACTOR, {
      account_id: "acc-1",
      text: "hi",
      in_reply_to: "https://x.com/a/status/1",
      idempotency_key: "k",
    });
    await new CreateThreadController(spy).handle(ACTOR, {
      account_id: "acc-1",
      parts: [{ text: "a" }],
      in_reply_to: "2",
      idempotency_key: "k2",
    });
    expect(spy.inputs.map((input) => input.replyTo)).toStrictEqual([
      "https://x.com/a/status/1",
      "2",
    ]);
  });

  it("create_thread: every part in order", async () => {
    const spy = new Spy();
    await new CreateThreadController(spy).handle(ACTOR, {
      account_id: "acc-1",
      parts: [{ text: "a", media_ids: ["m"] }, { text: "b" }],
      idempotency_key: "k2",
    });
    expect(spy.inputs).toStrictEqual([
      {
        actor: ACTOR,
        accountId: "acc-1",
        parts: [
          { text: "a", media: ["m"] },
          { text: "b", media: [] },
        ],
        publishAt: null,
        replyTo: null,
        idempotencyKey: "k2",
      },
    ]);
  });

  it("stage_media_from_url", async () => {
    const spy = new Spy();
    await new StageMediaFromUrlController(spy).handle(ACTOR, {
      account_id: "acc-1",
      url: "https://x/a.png",
    });
    expect(spy.inputs).toStrictEqual([
      { actor: ACTOR, accountId: "acc-1", url: "https://x/a.png" },
    ]);
  });

  it("upload_media: hashes lowercased; a single part is part 0 of 1 with no upload id (GROKCHAT-20)", async () => {
    const spy = new Spy();
    const controller = new UploadMediaController(spy);
    const hash = "AB".repeat(32);
    await controller.handle(ACTOR, {
      account_id: "acc-1",
      sha256: hash,
      data_base64: "AAEC",
      part_sha256: "CD".repeat(32),
    });
    await controller.handle(ACTOR, {
      account_id: "acc-1",
      label: "mascot",
      sha256: hash,
      data_base64: "AAEC",
      part_sha256: "cd".repeat(32),
      upload_id: "u-1",
      part_index: 2,
      part_count: 3,
    });
    const common = {
      actor: ACTOR,
      accountId: "acc-1",
      fileSha256: "ab".repeat(32),
      data: "AAEC",
      partSha256: "cd".repeat(32),
    };
    expect(spy.inputs).toStrictEqual([
      { ...common, label: "", uploadId: null, partIndex: 0, partCount: 1 },
      { ...common, label: "mascot", uploadId: "u-1", partIndex: 2, partCount: 3 },
    ]);
  });

  it("edit_post: new parts and time, or neither (null keeps them)", async () => {
    const spy = new Spy();
    const controller = new EditPostController(spy);
    await controller.handle(ACTOR, { post_id: "p", parts: [{ text: "c" }], publish_at: NOON });
    await controller.handle(ACTOR, { post_id: "p" });
    expect(spy.inputs).toStrictEqual([
      { actor: ACTOR, postId: "p", parts: [{ text: "c", media: [] }], publishAt: NOON_MS },
      { actor: ACTOR, postId: "p", parts: null, publishAt: null },
    ]);
  });

  it("cancel_post and delete_post take only the post id", async () => {
    const cancel = new Spy();
    const remove = new Spy();
    await new CancelPostController(cancel).handle(ACTOR, { post_id: "p1" });
    await new DeletePostController(remove).handle(ACTOR, { post_id: "p2" });
    expect(cancel.inputs).toStrictEqual([{ actor: ACTOR, postId: "p1" }]);
    expect(remove.inputs).toStrictEqual([{ actor: ACTOR, postId: "p2" }]);
  });
});

describe("reading controllers", () => {
  it("get_post and get_post_metrics take the post id", async () => {
    const get = new Spy();
    const metrics = new Spy();
    await new GetPostController(get).handle(ACTOR, { post_id: "p1" });
    await new GetPostMetricsController(metrics).handle(ACTOR, { post_id: "p2" });
    expect(get.inputs).toStrictEqual([{ actor: ACTOR, postId: "p1" }]);
    expect(metrics.inputs).toStrictEqual([{ actor: ACTOR, postId: "p2" }]);
  });

  it("list_backlog: everything absent means every account in scope, every status, any time", async () => {
    const spy = new Spy();
    const controller = new ListBacklogController(spy);
    await controller.handle(ACTOR, {});
    await controller.handle(ACTOR, {
      account_id: "acc-1",
      statuses: ["SCHEDULED", "PUBLISHED"],
      from: NOON,
    });
    expect(spy.inputs).toStrictEqual([
      { actor: ACTOR, accountId: null, statuses: null, window: null },
      {
        actor: ACTOR,
        accountId: "acc-1",
        statuses: ["SCHEDULED", "PUBLISHED"],
        window: { from: NOON_MS, to: Number.MAX_SAFE_INTEGER },
      },
    ]);
  });

  it("get_account_metrics and compare_posts take the account and the window", async () => {
    const totals = new Spy();
    const compare = new Spy();
    const window = { account_id: "acc-1", from: NOON, to: "2026-10-28T12:00:00Z" };
    await new GetAccountMetricsController(totals).handle(ACTOR, window);
    await new ComparePostsController(compare).handle(ACTOR, { ...window, sort_by: "likes" });
    const expected = { actor: ACTOR, accountId: "acc-1", window: { from: NOON_MS, to: LATE } };
    expect(totals.inputs).toStrictEqual([expected]);
    expect(compare.inputs).toStrictEqual([{ ...expected, sortBy: "likes" }]);
  });

  it("get_policy takes the account id", async () => {
    const policy = new Spy();
    await new GetPolicyController(policy).handle(ACTOR, { account_id: "a2" });
    expect(policy.inputs).toStrictEqual([{ actor: ACTOR, accountId: "a2" }]);
  });

  it("list_accounts takes only the caller", async () => {
    const list = new Spy();
    await new ListAccountsController(list).handle(ACTOR);
    expect(list.inputs).toStrictEqual([{ actor: ACTOR }]);
  });

  it("list_media defaults to the unused media, 20 at a time (GROKCHAT-18)", async () => {
    const list = new Spy();
    const controller = new ListMediaController(list);
    await controller.handle(ACTOR, { account_id: "acc-1" });
    await controller.handle(ACTOR, { account_id: "acc-1", status: "all", limit: 3 });
    expect(LIST_MEDIA_DEFAULT_LIMIT).toBe(20);
    expect(list.inputs).toStrictEqual([
      { actor: ACTOR, accountId: "acc-1", status: "unused", limit: 20 },
      { actor: ACTOR, accountId: "acc-1", status: "all", limit: 3 },
    ]);
  });
});
