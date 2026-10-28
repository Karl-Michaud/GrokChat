/** GROKCHAT-18: list_media, the Media page's delete and its thumbnails, over the in-memory world. */
import { describe, expect, it } from "vitest";
import { accountId, postId, stagedMediaId } from "../../../src/entities/identity/ids";
import { KEEP_UNUSED } from "../../../src/entities/media/media_cleanup";
import { DAY } from "../../../src/entities/time/instant";
import { DeleteMediaInteractor } from "../../../src/use_cases/delete_media/interactor";
import type { DeleteMediaOutputData } from "../../../src/use_cases/delete_media/output_data";
import { GetMediaFileInteractor } from "../../../src/use_cases/get_media_file/interactor";
import type { GetMediaFileOutputData } from "../../../src/use_cases/get_media_file/output_data";
import {
  ListMediaInteractor,
  MAX_MEDIA_LIST,
  MEDIA_LIST_SCAN,
} from "../../../src/use_cases/list_media/interactor";
import type { MediaStatusFilter } from "../../../src/use_cases/list_media/input_data";
import type { ListMediaOutputData } from "../../../src/use_cases/list_media/output_data";
import {
  ACCOUNT,
  aMedia,
  aPost,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../support/builders";
import { Capture, makeWorld, PNG, type World } from "../support/world";

async function list(
  world: World,
  options: {
    readonly actor?: Parameters<ListMediaInteractor["execute"]>[0]["actor"];
    readonly account?: string;
    readonly status?: MediaStatusFilter;
    readonly limit?: number;
  } = {},
): Promise<ListMediaOutputData> {
  const presenter = new Capture<ListMediaOutputData>();
  await new ListMediaInteractor(world, presenter).execute({
    actor: options.actor ?? botActor(),
    accountId: accountId(options.account ?? ACCOUNT),
    status: options.status ?? "all",
    limit: options.limit ?? 20,
  });
  return presenter.last;
}

const ids = (output: ListMediaOutputData): readonly string[] =>
  output.ok ? output.items.map((item) => String(item.media.id)) : [];

describe("listMedia (GROKCHAT-18)", () => {
  it("lists the account's media newest first, each with used and expires_at", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.writer.add(aPost({ id: postId("waiting"), lifecycle: "SCHEDULED" }));
    await world.writer.add(aPost({ id: postId("dropped"), lifecycle: "CANCELLED" }));
    await world.writer.add(
      aPost({ id: postId("done"), lifecycle: "DONE", parts: [part("a", sentState("x", T0))] }),
    );
    const old = aMedia({ id: stagedMediaId("old"), stagedAt: T0 - DAY });
    const held = aMedia({ id: stagedMediaId("held"), stagedAt: T0, attachedTo: postId("waiting") });
    const freed = aMedia({ id: stagedMediaId("freed"), stagedAt: T0, attachedTo: postId("dropped") });
    const sent = aMedia({ id: stagedMediaId("sent"), stagedAt: T0 + 1, attachedTo: postId("done") });
    const theirs = aMedia({ id: stagedMediaId("theirs"), ownerAccountId: OTHER_ACCOUNT });
    for (const item of [old, held, freed, sent, theirs]) {
      await world.media.save(item);
    }
    expect(await list(world)).toStrictEqual({
      ok: true,
      accountId: ACCOUNT,
      items: [
        { media: sent, used: true, expiresAt: T0 + 1 + 7 * DAY },
        { media: held, used: true, expiresAt: null },
        { media: freed, used: false, expiresAt: T0 + KEEP_UNUSED },
        { media: old, used: false, expiresAt: T0 - DAY + KEEP_UNUSED },
      ],
    });
    expect(ids(await list(world, { status: "unused" }))).toStrictEqual(["freed", "old"]);
    expect(ids(await list(world, { limit: 2 }))).toStrictEqual(["sent", "held"]);
    expect(ids(await list(world, { status: "unused", limit: 1 }))).toStrictEqual(["freed"]);
  });

  it("shows an upload from the dashboard to the account's bot", async () => {
    const world = makeWorld();
    const account = await world.seedAccount();
    const stored = await world.intake.store(HUMAN, account, PNG, {
      label: "launch banner",
      source: { kind: "dashboard" },
    });
    const output = await list(world, { status: "unused" });
    expect(output).toMatchObject({
      ok: true,
      items: [
        {
          media: { id: stored.ok ? stored.mediaId : "", label: "launch banner" },
          used: false,
          expiresAt: T0 + KEEP_UNUSED,
        },
      ],
    });
  });

  it("is scope-checked: another person's account is refused, an unknown one not found", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.media.save(aMedia());
    expect(await list(world, { actor: botActor([OTHER_ACCOUNT]) })).toStrictEqual({
      ok: false,
      code: "scope",
    });
    expect(await list(world, { account: "ghost" })).toStrictEqual({
      ok: false,
      code: "not_found",
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["refused.media.list", "scope"],
    ]);
    expect(ids(await list(world, { actor: HUMAN }))).toStrictEqual(["media-1"]);
  });

  it("the limit is kept between 1 and 50; the scan reads at most 200", async () => {
    expect(MAX_MEDIA_LIST).toBe(50);
    expect(MEDIA_LIST_SCAN).toBe(200);
    const world = makeWorld();
    await world.seedAccount();
    for (let index = 0; index < 60; index += 1) {
      const id = `m-${String(index).padStart(3, "0")}`;
      await world.media.save(aMedia({ id: stagedMediaId(id), stagedAt: T0 + index }));
    }
    expect(ids(await list(world, { limit: 0 }))).toStrictEqual(["m-059"]);
    expect(ids(await list(world, { limit: 1000 }))).toHaveLength(50);
    const requested: number[] = [];
    const counting = {
      ...world,
      catalog: {
        recent: (account: typeof ACCOUNT, limit: number) => {
          requested.push(limit);
          return world.catalog.recent(account, limit);
        },
      },
    };
    await new ListMediaInteractor(counting, new Capture<ListMediaOutputData>()).execute({
      actor: HUMAN,
      accountId: ACCOUNT,
      status: "all",
      limit: 5,
    });
    expect(requested).toStrictEqual([200]);
  });
});

async function remove(world: World, id: string, actor = HUMAN): Promise<DeleteMediaOutputData> {
  const presenter = new Capture<DeleteMediaOutputData>();
  const ports = { ...world, audit: world.actionAudit };
  await new DeleteMediaInteractor(ports, presenter).execute({ actor, mediaId: stagedMediaId(id) });
  return presenter.last;
}

describe("deleteMedia (GROKCHAT-18)", () => {
  it("deletes unused media: the bytes, its stored size and the row; audited as human", async () => {
    const world = makeWorld();
    const account = await world.seedAccount();
    const stored = await world.intake.store(HUMAN, account, PNG, {
      label: null,
      source: { kind: "dashboard" },
    });
    const id = stored.ok ? stored.mediaId : "";
    expect(await remove(world, id)).toStrictEqual({ ok: true, accountId: ACCOUNT });
    expect(world.media.rows.size).toBe(0);
    expect(world.blobs.blobs.size).toBe(0);
    expect(await world.usage.current(T0)).toMatchObject({ storedBytes: 0, classA: 1 });
    expect(world.audit.events.map((event) => [event.actor, event.action, event.detail])).toStrictEqual(
      [
        ["human:owner", "media.upload", id],
        ["human:owner", "media.delete", id],
      ],
    );
  });

  it("media of a cancelled post counts as unused and may be deleted", async () => {
    const world = makeWorld();
    await world.writer.add(aPost({ id: postId("p"), lifecycle: "CANCELLED" }));
    await world.media.save(aMedia({ attachedTo: postId("p") }));
    expect(await remove(world, "media-1")).toMatchObject({ ok: true });
  });

  it("refuses media a live post holds, a bot and an unknown id, deleting nothing", async () => {
    const world = makeWorld();
    await world.writer.add(aPost({ id: postId("p"), lifecycle: "SCHEDULED" }));
    const held = aMedia({ attachedTo: postId("p") });
    await world.media.save(held);
    expect(await remove(world, "media-1")).toStrictEqual({ ok: false, code: "media_in_use" });
    expect(await remove(world, "media-1", botActor())).toStrictEqual({
      ok: false,
      code: "human_only",
    });
    expect(await remove(world, "ghost")).toStrictEqual({ ok: false, code: "not_found" });
    expect(world.media.rows.get(stagedMediaId("media-1"))).toStrictEqual(held);
    expect(world.audit.events.map((event) => [event.action, event.detail, event.postId])).toStrictEqual(
      [
        ["refused.media.delete", "media_in_use", "p"],
        ["refused.media.delete", "human_only", "p"],
      ],
    );
  });
});

async function file(world: World, id: string, actor = HUMAN): Promise<GetMediaFileOutputData> {
  const presenter = new Capture<GetMediaFileOutputData>();
  await new GetMediaFileInteractor(world, presenter).execute({ actor, mediaId: stagedMediaId(id) });
  return presenter.last;
}

describe("getMediaFile (GROKCHAT-18 thumbnails)", () => {
  it("serves the bytes with the sniffed type, one Class B read", async () => {
    const world = makeWorld();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-1");
    expect(await file(world, item.id)).toStrictEqual({
      ok: true,
      bytes: PNG,
      contentType: "image/png",
    });
    expect(await world.usage.current(T0)).toMatchObject({ classB: 1 });
  });

  it("refuses a bot, an unknown id, missing bytes, and reads past the quota", async () => {
    const world = makeWorld();
    const item = await world.stage(ACCOUNT, "PHOTO", "m-1");
    expect(await file(world, item.id, botActor())).toStrictEqual({ ok: false, code: "human_only" });
    expect(await file(world, "ghost")).toStrictEqual({ ok: false, code: "not_found" });
    await world.media.save(aMedia({ id: stagedMediaId("gone"), storageKey: "nowhere" }));
    expect(await file(world, "gone")).toStrictEqual({ ok: false, code: "not_found" });
    expect(await world.usage.current(T0)).toMatchObject({ classB: 0 });
    await world.usage.record({ storedBytes: 0, classA: 0, classB: 8_000_000 }, T0);
    expect(await file(world, item.id)).toStrictEqual({ ok: false, code: "media_quota" });
    expect(world.audit.events.map((event) => event.action)).toStrictEqual([
      "refused.media.view",
    ]);
  });
});
