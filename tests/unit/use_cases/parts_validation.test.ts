import { describe, expect, it } from "vitest";
import { postId, stagedMediaId } from "../../../src/entities/identity/ids";
import { aPolicy, anAccount, ACCOUNT, OTHER_ACCOUNT } from "../support/builders";
import { makeWorld } from "../support/world";

describe("PartsValidator (plan §3.3 #1)", () => {
  it("accepts 1–25 parts and returns them PENDING with their media", async () => {
    const world = makeWorld();
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-1");
    const parts = Array.from({ length: 25 }, (_, index) => ({
      text: `p${String(index)}`,
      media: [],
    }));
    expect((await world.validator.check(anAccount(), parts, null)).ok).toBe(true);
    expect(
      await world.validator.check(anAccount(), [{ text: "a", media: [photo.id] }], null),
    ).toStrictEqual({
      ok: true,
      parts: [{ text: "a", media: [photo.id], state: { kind: "PENDING" } }],
      media: [photo],
    });
  });

  it.each([
    ["no parts", [], "no_parts", null],
    [
      "26 parts",
      Array.from({ length: 26 }, () => ({ text: "x", media: [] })),
      "too_many_parts",
      null,
    ],
  ] as const)("%s", async (_name, parts, code, part) => {
    const world = makeWorld();
    expect(await world.validator.check(anAccount(), parts, null)).toStrictEqual({
      ok: false,
      code,
      part,
    });
  });

  it("media that is missing, someone else's, used twice or attached to another post", async () => {
    const world = makeWorld();
    const mine = await world.stage(ACCOUNT, "PHOTO", "m-mine");
    const theirs = await world.stage(OTHER_ACCOUNT, "PHOTO", "m-theirs");
    const attached = await world.stage(ACCOUNT, "PHOTO", "m-attached");
    await world.media.save({ ...attached, attachedTo: postId("other") });
    const check = (media: readonly string[], post: string | null = null) =>
      world.validator.check(
        anAccount(),
        [
          { text: "ok", media: [] },
          { text: "x", media: media.map(stagedMediaId) },
        ],
        post === null ? null : postId(post),
      );
    expect(await check(["m-none"])).toStrictEqual({ ok: false, code: "media_not_found", part: 1 });
    expect(await check([theirs.id])).toStrictEqual({ ok: false, code: "media_not_owned", part: 1 });
    expect(await check([mine.id, mine.id])).toStrictEqual({
      ok: false,
      code: "media_reused",
      part: 1,
    });
    expect(await check([attached.id])).toStrictEqual({ ok: false, code: "media_reused", part: 1 });
    expect((await check([attached.id], "other")).ok).toBe(true);
    const twice = await world.validator.check(
      anAccount(),
      [
        { text: "a", media: [mine.id] },
        { text: "b", media: [mine.id] },
      ],
      null,
    );
    expect(twice).toStrictEqual({ ok: false, code: "media_reused", part: 1 });
  });

  it("part rules and the link policy, with the part's index", async () => {
    const world = makeWorld();
    const gif = await world.stage(ACCOUNT, "GIF", "m-gif");
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-photo");
    expect(
      await world.validator.check(anAccount(), [{ text: "g", media: [gif.id, photo.id] }], null),
    ).toStrictEqual({
      ok: false,
      code: "part_gif_not_alone",
      part: 0,
    });
    const refusing = anAccount({ policy: aPolicy({ linkPolicy: "REFUSE" }) });
    const linked = [
      { text: "a", media: [] },
      { text: "https://x.co", media: [] },
    ];
    expect(await world.validator.check(refusing, linked, null)).toStrictEqual({
      ok: false,
      code: "link_policy",
      part: 1,
    });
    expect((await world.validator.check(anAccount(), linked, null)).ok).toBe(true);
  });
});
