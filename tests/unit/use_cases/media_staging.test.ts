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
      label: null,
      source: { kind: "url", host: "cdn.example.com" },
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
    expect(await stage(world, "https://evil.com/a.png")).toStrictEqual({
      ok: false,
      code: "host_not_allowed",
      allowedHosts: ["cdn.example.com"],
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

describe("stageMediaFromUrl: Grok's image host and the host refusal (GROKCHAT-18)", () => {
  const IMGEN = "https://imgen.x.ai/xai-imgen/xai-tmp-imgen-0b7c.jpeg";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const stage = async (world: World, url: string, allowedHosts: readonly string[]) => {
    const presenter = new Capture<StageMediaFromUrlOutputData>();
    const ports = { ...world, allowedHosts };
    await new StageMediaFromUrlInteractor(ports, presenter).execute({
      actor: botActor(),
      accountId: ACCOUNT,
      url,
    });
    return presenter.last;
  };

  it("an imgen.x.ai link stages, recorded with its host", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.fetcher.files.set(IMGEN, JPEG);
    expect(await stage(world, IMGEN, ["imgen.x.ai"])).toMatchObject({ ok: true, kind: "PHOTO" });
    expect([...world.media.rows.values()]).toMatchObject([
      { contentType: "image/jpeg", label: null, source: { kind: "url", host: "imgen.x.ai" } },
    ]);
  });

  it("a host refusal carries the allowlist, empty when none is set", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await stage(world, IMGEN, [])).toStrictEqual({
      ok: false,
      code: "host_not_allowed",
      allowedHosts: [],
    });
    expect(
      await stage(world, "https://other.example/a.png", ["imgen.x.ai", "cdn.x"]),
    ).toStrictEqual({ ok: false, code: "host_not_allowed", allowedHosts: ["imgen.x.ai", "cdn.x"] });
    expect(world.fetcher.requests).toStrictEqual([]);
  });

  it("a redirect refused by the fetcher for its host carries the allowlist too", async () => {
    const world = makeWorld();
    await world.seedAccount();
    world.fetcher.responses.set(IMGEN, { ok: false, reason: "host_not_allowed" });
    expect(await stage(world, IMGEN, ["imgen.x.ai"])).toStrictEqual({
      ok: false,
      code: "host_not_allowed",
      allowedHosts: ["imgen.x.ai"],
    });
    world.fetcher.responses.set(IMGEN, { ok: false, reason: "bad_type" });
    expect(await stage(world, IMGEN, ["imgen.x.ai"])).toStrictEqual({
      ok: false,
      code: "bad_type",
    });
  });
});

describe("stageMediaUpload (dashboard)", () => {
  const upload = async (
    world: World,
    bytes: Uint8Array,
    actor = HUMAN,
    account: AccountId = ACCOUNT,
    label = "launch banner",
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
      label,
      bytes,
    });
    return presenter.last;
  };

  it("a human uploads with a label: stored like staged media, audited as media.upload", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await upload(world, GIF, HUMAN, ACCOUNT, "  launch   banner ")).toStrictEqual({
      ok: true,
      mediaId: stagedMediaId("id-1"),
      kind: "GIF",
      size: GIF.length,
    });
    expect(world.media.rows.get(stagedMediaId("id-1"))).toMatchObject({
      ownerAccountId: ACCOUNT,
      contentType: "image/gif",
      label: "launch banner",
      source: { kind: "dashboard" },
      attachedTo: null,
    });
    expect(await world.usage.current(T0)).toMatchObject({ storedBytes: GIF.length, classA: 1 });
    expect(
      world.audit.events.map((event) => [event.actor, event.action, event.detail]),
    ).toStrictEqual([["human:owner", "media.upload", "id-1"]]);
    expect(await upload(world, PNG, HUMAN, ACCOUNT, "")).toMatchObject({ ok: true });
    expect(world.media.rows.get(stagedMediaId("id-2"))?.label).toBeNull();
  });

  it("the same limits as stage_media_from_url: photos 5 MB, GIFs 15 MB", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const photo = new Uint8Array(5 * 1024 * 1024);
    photo.set(PNG);
    expect((await upload(world, photo)).ok).toBe(true);
    const overPhoto = new Uint8Array(5 * 1024 * 1024 + 1);
    overPhoto.set(PNG);
    expect(await upload(world, overPhoto)).toStrictEqual({ ok: false, code: "too_large" });
    const gif = new Uint8Array(15 * 1024 * 1024);
    gif.set(GIF);
    expect((await upload(world, gif)).ok).toBe(true);
    const overGif = new Uint8Array(15 * 1024 * 1024 + 1);
    overGif.set(GIF);
    expect(await upload(world, overGif)).toStrictEqual({ ok: false, code: "too_large" });
  });

  it("refuses a label over 80 characters and stores nothing", async () => {
    const world = makeWorld();
    await world.seedAccount();
    expect(await upload(world, PNG, HUMAN, ACCOUNT, "x".repeat(81))).toStrictEqual({
      ok: false,
      code: "invalid_label",
    });
    expect(world.media.rows.size).toBe(0);
  });

  it("the type comes from the bytes: a renamed text file is refused", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const text = new TextEncoder().encode("not really a png, just text");
    expect(await upload(world, text)).toStrictEqual({ ok: false, code: "not_media" });
    expect(world.blobs.blobs.size).toBe(0);
  });

  it("goes through the R2 quota guard", async () => {
    const world = makeWorld();
    await world.seedAccount();
    await world.usage.record({ storedBytes: 8_000_000_000, classA: 0, classB: 0 }, T0);
    expect(await upload(world, PNG)).toStrictEqual({ ok: false, code: "media_quota" });
    expect(world.media.rows.size).toBe(0);
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
