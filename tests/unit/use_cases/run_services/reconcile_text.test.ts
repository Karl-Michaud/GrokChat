/** Reconcile matches X's v2 `text`, where every URL is a t.co link and media adds one (§3.3 #6). */
import { describe, expect, it } from "vitest";
import { postId, stagedMediaId, xPostId } from "../../../../src/entities/identity/ids";
import { ACCOUNT, aPost, part, T0, unknownState } from "../../support/builders";
import { meter, put, stored } from "../../support/publishing";
import { makeWorld } from "../../support/world";

describe("reconcile finds a part whose timeline text X rewrote", () => {
  it.each([
    ["a scheme URL", "read https://example.com/a?b=1 now", [], "read https://t.co/AbC123 now"],
    ["a bare domain", "visit example.com today", [], "visit https://t.co/Xy9 today"],
    ["media", "look &", ["m-1"], "look &amp; https://t.co/Med1A"],
    [
      "a final URL and media",
      "go https://example.com",
      ["m-1"],
      "go https://t.co/a https://t.co/b",
    ],
  ] as const)("%s", async (_name, text, media, timeline) => {
    const world = makeWorld();
    await world.seedAccount();
    const ids = media.map((id) => stagedMediaId(id));
    put(world, aPost({ lifecycle: "DONE", parts: [part(text, unknownState(), ids)] }));
    const id = xPostId("x-live");
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text: timeline,
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toMatchObject({ found: 1 });
    expect(stored(world, postId("post-1"))?.parts[0]?.state).toMatchObject({
      kind: "SENT",
      xPostId: id,
    });
  });

  it("a different text around the links is still not found", async () => {
    const world = makeWorld();
    await world.seedAccount();
    put(world, aPost({ lifecycle: "DONE", parts: [part("read example.com now", unknownState())] }));
    const id = xPostId("x-live");
    const text = "read https://t.co/AbC later";
    world.x.posts.set(id, {
      id,
      account: ACCOUNT,
      text,
      media: [],
      inReplyTo: null,
      createdAt: T0,
    });
    expect(await world.reconcileAccount.reconcile(ACCOUNT, meter())).toMatchObject({ found: 0 });
  });
});
