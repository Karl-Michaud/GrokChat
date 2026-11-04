import { describe, expect, it } from "vitest";
import { postId } from "../../../../src/entities/identity/ids";
import { derivedStatus } from "../../../../src/entities/posts/derived_status";
import { ACCOUNT, aPost, part, sentState, T0 } from "../../support/builders";
import { setupPosts as setup } from "../../support/dashboard";

describe("the post page's commands", () => {
  const AT = "/dashboard/posts/post-1";
  const conflict = {
    kind: "refused",
    status: 409,
    message: "The post cannot do that in its current state.",
  };

  it("approve, then approving again is refused", async () => {
    const { commands, world } = await setup([aPost({ lifecycle: "PENDING_REVIEW" })]);
    expect(await commands.approve("post-1")).toStrictEqual({ kind: "redirect", location: AT });
    expect((await world.reader.get(postId("post-1")))?.lifecycle).toBe("SCHEDULED");
    expect(await commands.approve("post-1")).toStrictEqual(conflict);
  });

  it("reject and cancel", async () => {
    const { commands, world } = await setup([
      aPost({ lifecycle: "PENDING_REVIEW" }),
      aPost({ id: postId("post-2") }),
    ]);
    expect(await commands.reject("post-1")).toStrictEqual({ kind: "redirect", location: AT });
    expect((await world.reader.get(postId("post-1")))?.lifecycle).toBe("CANCELLED");
    expect(await commands.cancel("post-2")).toStrictEqual({
      kind: "redirect",
      location: "/dashboard/posts/post-2",
    });
    expect((await world.reader.get(postId("post-2")))?.lifecycle).toBe("CANCELLED");
    expect(await commands.cancel("post-2")).toStrictEqual(conflict);
    expect(await commands.reject("nope")).toMatchObject({ status: 404 });
  });

  it("edit replaces the texts, keeps each part's media and moves the time", async () => {
    const { commands, world } = await setup();
    const media = await world.stage(ACCOUNT, "PHOTO", "m-a");
    await world.writer.add(aPost({ parts: [part("a", undefined, [media.id]), part("b")] }));
    const form = { texts: ["new a", "new b"], media: [" m-a "], publishAt: "2026-10-28T09:15" };
    expect(await commands.edit("post-1", form)).toStrictEqual({ kind: "redirect", location: AT });
    const edited = await world.reader.get(postId("post-1"));
    expect(edited?.parts.map((p) => [p.text, p.media])).toStrictEqual([
      ["new a", [media.id]],
      ["new b", []],
    ]);
    expect(edited?.publishAt).toBe(Date.UTC(2026, 9, 28, 9, 15));
    await commands.edit("post-1", { ...form, texts: ["again", "b"], publishAt: " " });
    const kept = await world.reader.get(postId("post-1"));
    expect([kept?.parts[0]?.text, kept?.publishAt]).toStrictEqual([
      "again",
      Date.UTC(2026, 9, 28, 9, 15),
    ]);
  });

  it("edit refuses a bad time before calling the use case, and shows its refusals", async () => {
    const { commands, world } = await setup([aPost()]);
    expect(
      await commands.edit("post-1", { texts: ["x"], media: [], publishAt: "tomorrow" }),
    ).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The publish time must be YYYY-MM-DDTHH:MM (UTC).",
    });
    expect((await world.reader.get(postId("post-1")))?.version).toBe(1);
    expect(await commands.edit("post-1", { texts: [], media: [], publishAt: "" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "A post needs at least one part.",
    });
  });

  it("delete a published post", async () => {
    const { commands, world } = await setup([
      aPost({ lifecycle: "DONE", parts: [part("a", sentState("x-1"))] }),
    ]);
    expect(await commands.delete("post-1")).toStrictEqual({ kind: "redirect", location: AT });
    const deleted = await world.reader.get(postId("post-1"));
    expect(deleted === null ? null : derivedStatus(deleted)).toBe("DELETED");
    expect(await commands.delete("post-1")).toMatchObject({ status: 409 });
  });

  it("reschedule a missed post; a NOT_FOUND post needs the confirmation", async () => {
    const { commands, world } = await setup([
      aPost({ lifecycle: "MISSED" }),
      aPost({
        id: postId("post-2"),
        lifecycle: "DONE",
        parts: [part("a", { kind: "NOT_FOUND", attemptAt: T0 })],
      }),
    ]);
    const form = { publishAt: "2026-10-28T10:00", confirmedNotOnX: false };
    expect(await commands.reschedule("post-1", form)).toStrictEqual({
      kind: "redirect",
      location: AT,
    });
    const moved = await world.reader.get(postId("post-1"));
    expect([moved?.lifecycle, moved?.publishAt]).toStrictEqual([
      "SCHEDULED",
      Date.UTC(2026, 9, 28, 10),
    ]);
    expect(await commands.reschedule("post-2", form)).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "Confirm that you checked X and the post is not there.",
    });
    expect(await commands.reschedule("post-2", { ...form, confirmedNotOnX: true })).toStrictEqual({
      kind: "redirect",
      location: "/dashboard/posts/post-2",
    });
    expect(await commands.reschedule("post-1", { ...form, publishAt: "" })).toStrictEqual({
      kind: "refused",
      status: 400,
      message: "The publish time must be YYYY-MM-DDTHH:MM (UTC).",
    });
  });
});
