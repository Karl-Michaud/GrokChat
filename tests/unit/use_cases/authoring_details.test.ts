/** The details the mutation run showed were not yet pinned down by a test. */
import { describe, expect, it } from "vitest";
import { idempotencyKey, postId, stagedMediaId, xPostId } from "../../../src/entities/identity/ids";
import type { MetricsSnapshot } from "../../../src/entities/metrics/metrics_snapshot";
import { DAY, HOUR, MINUTE } from "../../../src/entities/time/instant";
import type { CommandResult } from "../../../src/use_cases/authoring/post_command";
import { CreatePostInteractor } from "../../../src/use_cases/create_post/interactor";
import type { CreatePostInputData } from "../../../src/use_cases/create_post/input_data";
import type { CreatePostOutputData } from "../../../src/use_cases/create_post/output_data";
import { DeletePostInteractor } from "../../../src/use_cases/delete_post/interactor";
import type { DeletePostOutputData } from "../../../src/use_cases/delete_post/output_data";
import { EditPostInteractor } from "../../../src/use_cases/edit_post/interactor";
import { GetPostMetricsInteractor } from "../../../src/use_cases/get_post_metrics/interactor";
import type { GetPostMetricsOutputData } from "../../../src/use_cases/get_post_metrics/output_data";
import { ListBacklogInteractor } from "../../../src/use_cases/list_backlog/interactor";
import type { PostFilter } from "../../../src/use_cases/ports/post_reader";
import { StageMediaFromUrlInteractor } from "../../../src/use_cases/stage_media_from_url/interactor";
import type { StageMediaFromUrlOutputData } from "../../../src/use_cases/stage_media_from_url/output_data";
import { ACCOUNT, aPost, botActor, HUMAN, part, sentState, T0 } from "../support/builders";
import { Capture, makeWorld, PNG, type World } from "../support/world";

function creator(world: World) {
  const presenter = new Capture<CreatePostOutputData>();
  const interactor = new CreatePostInteractor(
    {
      accounts: world.accounts,
      reader: world.reader,
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
  return async (input: Partial<CreatePostInputData>): Promise<CreatePostOutputData> => {
    await interactor.execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      parts: [{ text: "hello", media: [] }],
      publishAt: null,
      idempotencyKey: null,
      ...input,
    });
    return presenter.last;
  };
}

describe("createPost details", () => {
  it("a future post never opens a publish call", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await creator(world)({ publishAt: T0 + 1 });
    expect(world.accountPublisher.meters).toHaveLength(0);
  });

  it("a human's idempotency key is not a dedup key: two posts", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    const key = idempotencyKey("k");
    await create({ idempotencyKey: key, publishAt: T0 + MINUTE });
    expect(await create({ idempotencyKey: key, publishAt: T0 + MINUTE })).toMatchObject({
      duplicate: false,
    });
    expect(world.table.rows.size).toBe(2);
  });

  it("a bot's retry returns the earlier post before validating anything again", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-1");
    const create = creator(world);
    const input = {
      actor: botActor(),
      idempotencyKey: idempotencyKey("k"),
      parts: [{ text: "pic", media: [photo.id] }],
      publishAt: T0 + MINUTE,
    };
    await create(input);
    world.media.rows.clear();
    expect(await create(input)).toMatchObject({
      ok: true,
      duplicate: true,
      postId: postId("id-1"),
    });
  });
});

describe("edit, delete and backlog details", () => {
  it("a bot may edit a post of its own account", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(postId("post-1"), aPost({ publishAt: T0 + HOUR }));
    const presenter = new Capture<CommandResult<string>>();
    await new EditPostInteractor(
      {
        command: world.command,
        accounts: world.accounts,
        validator: world.validator,
        attachments: world.attachments,
      },
      presenter,
    ).execute({ actor: botActor(), postId: postId("post-1"), parts: null, publishAt: T0 + DAY });
    expect(presenter.last).toMatchObject({ ok: true, post: { publishAt: T0 + DAY } });
  });

  it("a partly published thread can be deleted", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(
      postId("post-1"),
      aPost({
        lifecycle: "DONE",
        parts: [part("a", sentState("x-a")), part("b", { kind: "REJECTED", reason: "r" })],
      }),
    );
    const presenter = new Capture<DeletePostOutputData>();
    await new DeletePostInteractor(
      {
        reader: world.reader,
        gateway: world.gateway,
        steps: world.steps,
        guard: world.guard,
        audit: world.actionAudit,
      },
      presenter,
    ).execute({ actor: HUMAN, postId: postId("post-1") });
    expect(presenter.last).toMatchObject({ ok: true, deleted: 1, post: { status: "DELETED" } });
  });

  it("a human's backlog asks the reader for everything; a bot's for its scope", async () => {
    const world = makeWorld();
    const filters: PostFilter[] = [];
    const list = world.reader.list.bind(world.reader);
    world.reader.list = (filter) => {
      filters.push(filter);
      return list(filter);
    };
    const backlog = new ListBacklogInteractor(world.reader, world.guard, new Capture());
    await backlog.execute({ actor: HUMAN, accountId: null, statuses: null, window: null });
    await backlog.execute({ actor: botActor(), accountId: null, statuses: null, window: null });
    expect(filters).toStrictEqual([{}, { accountIds: [ACCOUNT] }]);
  });
});

describe("metrics and media details", () => {
  const snapshot = (id: string, likes: number): MetricsSnapshot => ({
    xPostId: xPostId(id),
    accountId: ACCOUNT,
    takenAt: T0,
    impressions: 1,
    likes,
    reposts: 0,
    replies: 0,
    quotes: 0,
    bookmarks: 0,
    urlLinkClicks: null,
    userProfileClicks: null,
  });

  it("getPostMetrics asks only for the sent parts, and returns one snapshot per part in order", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.table.rows.set(
      postId("t"),
      aPost({
        id: postId("t"),
        lifecycle: "DONE",
        parts: [part("a", sentState("x-a")), part("b"), part("c", sentState("x-c"))],
      }),
    );
    await world.metrics.addSnapshots([snapshot("x-c", 3), snapshot("x-a", 1)]);
    const asked: (readonly string[])[] = [];
    const latest = world.metrics.latest.bind(world.metrics);
    world.metrics.latest = (ids) => {
      asked.push(ids);
      return latest(ids);
    };
    const presenter = new Capture<GetPostMetricsOutputData>();
    await new GetPostMetricsInteractor(world.reader, world.metrics, world.guard, presenter).execute(
      {
        actor: HUMAN,
        postId: postId("t"),
      },
    );
    expect(asked).toStrictEqual([["x-a", "x-c"]]);
    expect(presenter.last).toStrictEqual({
      ok: true,
      postId: postId("t"),
      parts: [snapshot("x-a", 1), snapshot("x-c", 3)],
    });
  });

  it("a photo of exactly 5 MB is accepted from a URL", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const bytes = new Uint8Array(5 * 1024 * 1024);
    bytes.set(PNG);
    world.fetcher.responses.set("https://cdn.example.com/a.png", {
      ok: true,
      bytes,
      contentType: "image/png",
    });
    const presenter = new Capture<StageMediaFromUrlOutputData>();
    await new StageMediaFromUrlInteractor(
      {
        accounts: world.accounts,
        fetcher: world.fetcher,
        intake: world.intake,
        guard: world.guard,
        allowedHosts: ["cdn.example.com"],
      },
      presenter,
    ).execute({ actor: botActor(), accountId: ACCOUNT, url: "https://cdn.example.com/a.png" });
    expect(presenter.last).toMatchObject({ ok: true, size: bytes.length });
  });

  it("MediaAttachments moves the post's media and leaves other posts' alone", async () => {
    const world = makeWorld();
    const keep = await world.stage(ACCOUNT, "PHOTO", "m-keep");
    const drop = await world.stage(ACCOUNT, "PHOTO", "m-drop");
    const other = await world.stage(ACCOUNT, "PHOTO", "m-other");
    const fresh = await world.stage(ACCOUNT, "PHOTO", "m-new");
    await world.media.save({ ...keep, attachedTo: postId("p") });
    await world.media.save({ ...drop, attachedTo: postId("p") });
    await world.media.save({ ...other, attachedTo: postId("q") });
    await world.attachments.replace(postId("p"), [{ ...keep, attachedTo: postId("p") }, fresh]);
    const attached = (id: string) => world.media.rows.get(stagedMediaId(id))?.attachedTo;
    expect([
      attached("m-keep"),
      attached("m-drop"),
      attached("m-other"),
      attached("m-new"),
    ]).toStrictEqual([postId("p"), null, postId("q"), postId("p")]);
  });
});
