import { describe, expect, it } from "vitest";
import { idempotencyKey, postId, stagedMediaId, xPostId } from "../../../src/entities/identity/ids";
import { requestHash } from "../../../src/entities/posts/new_post";
import { MINUTE, SECOND } from "../../../src/entities/time/instant";
import {
  CreatePostInteractor,
  PUBLISH_NOW_BUDGET,
} from "../../../src/use_cases/create_post/interactor";
import type { CreatePostInputData } from "../../../src/use_cases/create_post/input_data";
import type { CreatePostOutputData } from "../../../src/use_cases/create_post/output_data";
import type { PostReader } from "../../../src/use_cases/ports/post_reader";
import { ACCOUNT, aPolicy, BOT, botActor, HUMAN, OTHER_ACCOUNT, T0 } from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";

function creator(world: World, reader: PostReader = world.reader) {
  const presenter = new Capture<CreatePostOutputData>();
  const interactor = new CreatePostInteractor(
    {
      accounts: world.accounts,
      reader,
      writer: world.writer,
      attachments: world.attachments,
      validator: world.validator,
      publisher: world.accountPublisher,
      guard: world.guard,
      audit: world.actionAudit,
      ids: world.ids,
      clock: world.clock,
    },
    presenter,
  );
  return async (input: Partial<CreatePostInputData> = {}): Promise<CreatePostOutputData> => {
    await interactor.execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      parts: [{ text: "hello world", media: [] }],
      publishAt: null,
      idempotencyKey: null,
      ...input,
    });
    return presenter.last;
  };
}

const KEY = idempotencyKey("key-1");

describe("createPost: refusals before anything is written", () => {
  it("unknown account", async () => {
    const world = makeWorld();
    expect(await creator(world)()).toStrictEqual({ ok: false, code: "not_found", part: null });
  });

  it("a bot outside its scope is refused and audited; nothing is written", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const out = await creator(world)({ actor: botActor([OTHER_ACCOUNT]), idempotencyKey: KEY });
    expect(out).toStrictEqual({ ok: false, code: "scope", part: null });
    expect(world.table.rows.size).toBe(0);
    expect(world.audit.events).toStrictEqual([
      {
        at: T0,
        actor: "bot:bot-1",
        action: "refused.post.create",
        accountId: ACCOUNT,
        postId: null,
        detail: "scope",
      },
    ]);
  });

  it("a bot must send an idempotency key; a human need not", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const out = await creator(world)({ actor: botActor() });
    expect(out).toStrictEqual({ ok: false, code: "idempotency_key_required", part: null });
    expect((await creator(world)({ publishAt: T0 + MINUTE })).ok).toBe(true);
  });

  it("a publish time further back than the grace is refused; at the grace it is accepted", async () => {
    const world = makeWorld();
    const account = await world.seedAccount();
    const create = creator(world);
    const edge = T0 - account.policy.grace;
    expect(await create({ publishAt: edge - 1 })).toStrictEqual({
      ok: false,
      code: "publish_at_past",
      part: null,
    });
    world.x.scripts.create.push({ kind: "fail", failure: { kind: "not_sent" } });
    expect((await create({ publishAt: edge })).ok).toBe(true);
  });

  it("part refusals carry the part index", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const out = await creator(world)({
      parts: [
        { text: "ok", media: [] },
        { text: "x".repeat(281), media: [] },
      ],
    });
    expect(out).toStrictEqual({ ok: false, code: "part_too_long", part: 1 });
  });
});

describe("createPost: publish now", () => {
  it("an AUTO post with no time is published inline within a 10 s budget", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const out = await creator(world)();
    expect(out).toStrictEqual({
      ok: true,
      postId: postId("id-1"),
      status: "PUBLISHED",
      estimatedCostMicros: 15_000,
      duplicate: false,
    });
    expect(PUBLISH_NOW_BUDGET).toBe(10 * SECOND);
    expect(world.accountPublisher.meters.map((meter) => meter.remaining().deadline)).toStrictEqual([
      T0 + 10 * SECOND,
    ]);
    expect([...world.x.posts.values()].map((post) => post.text)).toStrictEqual(["hello world"]);
  });

  it("stores the post with its provenance, request hash and the actor", async () => {
    const world = makeWorld();
    const account = await world.seedAccount({ policy: aPolicy({ mode: "REVIEW" }) });
    await creator(world)({ actor: botActor(), idempotencyKey: KEY, publishAt: T0 + MINUTE });
    expect(world.table.rows.get(postId("id-1"))).toStrictEqual({
      id: postId("id-1"),
      accountId: ACCOUNT,
      parts: [{ text: "hello world", media: [], state: { kind: "PENDING" } }],
      lifecycle: "PENDING_REVIEW",
      publishAt: T0 + MINUTE,
      resumeAt: null,
      idempotencyKey: KEY,
      requestHash: requestHash(ACCOUNT, [{ text: "hello world", media: [] }], T0 + MINUTE),
      createdBy: botActor(),
      provenance: { botId: BOT, policySnapshot: account.policy },
      version: 1,
    });
    expect(world.x.posts.size).toBe(0);
  });

  it("a thread is sent part by part, each a reply to the one before", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const parts = ["one", "two", "three"].map((text) => ({ text, media: [] }));
    const out = await creator(world)({ parts });
    expect(out).toMatchObject({ ok: true, status: "PUBLISHED", estimatedCostMicros: 45_000 });
    expect([...world.x.posts.values()].map((post) => [post.text, post.inReplyTo])).toStrictEqual([
      ["one", null],
      ["two", xPostId("x-1")],
      ["three", xPostId("x-2")],
    ]);
  });

  it("a future post is only scheduled; a past one inside the grace is published", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    expect(await create({ publishAt: T0 + MINUTE })).toMatchObject({
      ok: true,
      status: "SCHEDULED",
    });
    expect(world.x.posts.size).toBe(0);
    expect(
      await create({ publishAt: T0 - MINUTE, parts: [{ text: "late", media: [] }] }),
    ).toMatchObject({
      status: "PUBLISHED",
    });
  });

  it("a REVIEW account's post waits for review and is never sent inline", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ mode: "REVIEW" }) });
    expect(await creator(world)()).toMatchObject({ ok: true, status: "PENDING_REVIEW" });
    expect(world.accountPublisher.meters).toHaveLength(0);
  });

  it("the gate still applies inline: a paused account's post stays SCHEDULED", async () => {
    const world = makeWorld();
    await world.seedAccount({ status: "PAUSED" });
    expect(await creator(world)()).toMatchObject({ ok: true, status: "SCHEDULED" });
    expect(world.x.posts.size).toBe(0);
  });

  it("estimates $0.20 for a part with a scheme URL, for the app owner too", async () => {
    const world = makeWorld();
    await world.seedAccount({ isAppOwner: true });
    const parts = [
      { text: "see https://trymusechat.com", media: [] },
      { text: "or trymusechat.com", media: [] },
    ];
    expect(await creator(world)({ parts, publishAt: T0 + MINUTE })).toMatchObject({
      estimatedCostMicros: 215_000,
    });
  });

  it("attaches the post's media and audits the create", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-1");
    await creator(world)({ parts: [{ text: "pic", media: [photo.id] }], publishAt: T0 + MINUTE });
    expect(world.media.rows.get(stagedMediaId("m-1"))?.attachedTo).toBe(postId("id-1"));
    expect(world.audit.events.map((event) => [event.action, event.postId])).toStrictEqual([
      ["post.create", postId("id-1")],
    ]);
  });
});

describe("createPost: idempotency (rev 4 B3, N6)", () => {
  it("the same key and request returns the first post, sent once", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    const first = await create({ actor: botActor(), idempotencyKey: KEY });
    const again = await create({ actor: botActor(), idempotencyKey: KEY });
    expect(again).toStrictEqual({ ...first, duplicate: true });
    expect(world.x.posts.size).toBe(1);
  });

  it("the same key with a different request is refused", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    await create({ actor: botActor(), idempotencyKey: KEY });
    const other = await create({
      actor: botActor(),
      idempotencyKey: KEY,
      parts: [{ text: "other", media: [] }],
    });
    expect(other).toStrictEqual({ ok: false, code: "idempotency_mismatch", part: null });
  });

  it("a key that loses the insert race returns the winner (unique index)", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await creator(world)({ actor: botActor(), idempotencyKey: KEY, publishAt: T0 + MINUTE });
    const blind: PostReader = {
      get: (id) => world.reader.get(id),
      findByIdempotency: () => Promise.resolve(null),
      list: (filter) => world.reader.list(filter),
      recentActivity: (account, now) => (world.reader as PostReader).recentActivity(account, now),
      accountsNeedingWork: (now) => world.reader.accountsNeedingWork(now),
    };
    const raced = await creator(
      world,
      blind,
    )({ actor: botActor(), idempotencyKey: KEY, publishAt: T0 + MINUTE });
    expect(raced).toStrictEqual({
      ok: true,
      postId: postId("id-1"),
      status: "SCHEDULED",
      estimatedCostMicros: 15_000,
      duplicate: true,
    });
    expect(world.table.rows.size).toBe(1);
  });

  it("keys are per bot: a human's post never collides", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    await create({ actor: HUMAN, idempotencyKey: KEY, publishAt: T0 + MINUTE });
    const bot = await create({ actor: botActor(), idempotencyKey: KEY, publishAt: T0 + MINUTE });
    expect(bot).toMatchObject({ ok: true, duplicate: false, postId: postId("id-2") });
  });

  it("reports the post's own status if it cannot be read back", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const gone: PostReader = {
      get: () => Promise.resolve(null),
      findByIdempotency: () => Promise.resolve(null),
      list: (filter) => world.reader.list(filter),
      recentActivity: (account, now) => (world.reader as PostReader).recentActivity(account, now),
      accountsNeedingWork: (now) => world.reader.accountsNeedingWork(now),
    };
    expect(await creator(world, gone)({ publishAt: T0 + MINUTE })).toMatchObject({
      ok: true,
      status: "SCHEDULED",
    });
  });
});
