import { describe, expect, it } from "vitest";
import { accountId, stagedMediaId, type AccountId } from "../../../src/entities/identity/ids";
import {
  MEDIA_TYPES,
  StageMediaFromUrlInteractor,
} from "../../../src/use_cases/stage_media_from_url/interactor";
import type { StageMediaFromUrlOutputData } from "../../../src/use_cases/stage_media_from_url/output_data";
import { StageMediaUploadInteractor } from "../../../src/use_cases/stage_media_upload/interactor";
import type { StageMediaUploadOutputData } from "../../../src/use_cases/stage_media_upload/output_data";
import { ACCOUNT, botActor, HUMAN, OTHER_ACCOUNT, T0 } from "../support/builders";
import { Capture, GIF, makeWorld, PNG, type World } from "../support/world";

describe("stageMediaFromUrl (plan §3.3 #3, U18)", () => {
  const URL = "https://cdn.example.com/a.png";
  const stage = async (world: World, url = URL, actor = botActor()) => {
    const presenter = new Capture<StageMediaFromUrlOutputData>();
    const interactor = new StageMediaFromUrlInteractor(
      {
        accounts: world.accounts,
        fetcher: world.fetcher,
        intake: world.intake,
        guard: world.guard,
        allowedHosts: ["cdn.example.com"],
      },
      presenter,
    );
    await interactor.execute({ actor, accountId: ACCOUNT, url });
    return presenter.last;
  };

  it("fetches, sniffs and stores the media, counting the R2 write", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.fetcher.responses.set(URL, { ok: true, bytes: PNG, contentType: "image/png" });
    expect(await stage(world)).toStrictEqual({
      ok: true,
      mediaId: stagedMediaId("id-1"),
      kind: "PHOTO",
      size: PNG.length,
    });
    expect(world.fetcher.requests).toStrictEqual([{ url: URL, maxBytes: 15 * 1024 * 1024 }]);
    expect(MEDIA_TYPES).toStrictEqual(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    expect(world.media.rows.get(stagedMediaId("id-1"))).toStrictEqual({
      id: stagedMediaId("id-1"),
      ownerAccountId: ACCOUNT,
      kind: "PHOTO",
      contentType: "image/png",
      size: PNG.length,
      storageKey: "blob-1",
      sha256: await world.hasher.sha256Hex(PNG),
      stagedAt: T0,
      attachedTo: null,
    });
    expect(await world.usage.current(T0)).toStrictEqual({
      month: "2026-10",
      storedBytes: PNG.length,
      classA: 1,
      classB: 0,
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["media.stage", "id-1"],
    ]);
  });

  it("refuses: unknown account, scope, a URL off the allowlist, a failed fetch", async () => {
    const world = makeWorld();
    expect(await stage(world)).toStrictEqual({ ok: false, code: "not_found" });
    await world.seedAccount();
    expect(await stage(world, URL, botActor([OTHER_ACCOUNT]))).toStrictEqual({
      ok: false,
      code: "scope",
    });
    expect(await stage(world, "https://127.0.0.1/a.png")).toStrictEqual({
      ok: false,
      code: "literal_ip",
    });
    expect(await stage(world)).toStrictEqual({ ok: false, code: "unreachable" });
    expect(world.fetcher.requests).toHaveLength(1);
  });

  it("refuses what is not media, too large for its kind, or over the R2 quota", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.fetcher.responses.set(URL, {
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    expect(await stage(world)).toStrictEqual({ ok: false, code: "not_media" });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    world.fetcher.responses.set(URL, { ok: true, bytes: big, contentType: "image/png" });
    expect(await stage(world)).toStrictEqual({ ok: false, code: "too_large" });
    await world.usage.record({ storedBytes: 8_000_000_000, classA: 0, classB: 0 }, T0);
    world.fetcher.responses.set(URL, { ok: true, bytes: GIF, contentType: "image/gif" });
    expect(await stage(world)).toStrictEqual({ ok: false, code: "media_quota" });
    expect(world.media.rows.size).toBe(0);
  });
});

describe("stageMediaUpload (dashboard)", () => {
  const upload = async (
    world: World,
    bytes: Uint8Array,
    actor = HUMAN,
    account: AccountId = ACCOUNT,
  ) => {
    const presenter = new Capture<StageMediaUploadOutputData>();
    await new StageMediaUploadInteractor(
      world.accounts,
      world.intake,
      world.guard,
      presenter,
    ).execute({
      actor,
      accountId: account,
      bytes,
    });
    return presenter.last;
  };

  it("a human uploads up to 4 MB", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await upload(world, GIF)).toStrictEqual({
      ok: true,
      mediaId: stagedMediaId("id-1"),
      kind: "GIF",
      size: GIF.length,
    });
    const limit = new Uint8Array(4 * 1024 * 1024);
    limit.set(PNG);
    expect((await upload(world, limit)).ok).toBe(true);
    expect(await upload(world, new Uint8Array(4 * 1024 * 1024 + 1))).toStrictEqual({
      ok: false,
      code: "too_large",
    });
  });

  it("refuses a bot, an unknown account and bytes that are not media", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await upload(world, PNG, botActor())).toStrictEqual({ ok: false, code: "human_only" });
    expect(await upload(world, PNG, HUMAN, accountId("nope"))).toStrictEqual({
      ok: false,
      code: "not_found",
    });
    expect(await upload(world, new Uint8Array([0]))).toStrictEqual({
      ok: false,
      code: "not_media",
    });
  });
});
