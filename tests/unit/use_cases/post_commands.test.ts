import { describe, expect, it } from "vitest";
import { postId, stagedMediaId } from "../../../src/entities/identity/ids";
import type { PartState } from "../../../src/entities/posts/part_state";
import type { Post } from "../../../src/entities/posts/post";
import { HOUR, MINUTE } from "../../../src/entities/time/instant";
import { ApprovePostInteractor } from "../../../src/use_cases/approve_post/interactor";
import type { CommandResult } from "../../../src/use_cases/authoring/post_command";
import { CancelPostInteractor } from "../../../src/use_cases/cancel_post/interactor";
import { EditPostInteractor } from "../../../src/use_cases/edit_post/interactor";
import type { EditPostInputData } from "../../../src/use_cases/edit_post/input_data";
import { RejectPostInteractor } from "../../../src/use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "../../../src/use_cases/reschedule_post/interactor";
import { toPostView } from "../../../src/use_cases/views/post_view";
import {
  ACCOUNT,
  aPolicy,
  aPost,
  botActor,
  HUMAN,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../support/builders";
import { Capture, makeWorld, type World } from "../support/world";
import { required } from "../support/publishing";

const ID = postId("post-1");

function put(world: World, post: Post): Post {
  world.table.rows.set(post.id, post);
  return post;
}

async function setup(post: Partial<Post> = {}): Promise<{ world: World; post: Post }> {
  const world = makeWorld();
  await world.seedAccount();
  return { world, post: put(world, aPost(post)) };
}

const cancel = async (world: World, actor = HUMAN) => {
  const presenter = new Capture<CommandResult>();
  await new CancelPostInteractor(world.command, presenter).execute({ actor, postId: ID });
  return presenter.last;
};

describe("PostCommand through cancel", () => {
  it("not found, out of scope (audited), and an invalid transition", async () => {
    const empty = makeWorld();
    expect(await cancel(empty)).toStrictEqual({ ok: false, code: "not_found" });
    const { world } = await setup();
    expect(await cancel(world, botActor([OTHER_ACCOUNT]))).toStrictEqual({
      ok: false,
      code: "scope",
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["refused.post.cancel", "scope"],
    ]);
    const done = await setup({ lifecycle: "DONE", parts: [part("a", sentState("x"))] });
    expect(await cancel(done.world)).toStrictEqual({ ok: false, code: "invalid_transition" });
  });

  it("cancels, audits the event, and returns the post view", async () => {
    const { world, post } = await setup();
    const out = await cancel(world, botActor());
    const cancelled = { ...post, lifecycle: "CANCELLED", version: 2 } as const;
    expect(out).toStrictEqual({ ok: true, post: toPostView(cancelled) });
    expect(world.table.rows.get(ID)).toStrictEqual(cancelled);
    expect(world.audit.events).toStrictEqual([
      {
        at: T0,
        actor: "bot:bot-1",
        action: "post.cancel",
        accountId: ACCOUNT,
        postId: ID,
        detail: "cancel",
      },
    ]);
  });

  it("a stale version is a conflict", async () => {
    const { world } = await setup();
    world.writer.save = () => Promise.resolve({ kind: "version_conflict" });
    expect(await cancel(world)).toStrictEqual({ ok: false, code: "version_conflict" });
  });
});

describe("approve and reject are human only", () => {
  it("a bot is refused and audited", async () => {
    const { world } = await setup({ lifecycle: "PENDING_REVIEW" });
    const presenter = new Capture<CommandResult>();
    await new ApprovePostInteractor(world.command, world.clock, presenter).execute({
      actor: botActor(),
      postId: ID,
    });
    await new RejectPostInteractor(world.command, presenter).execute({
      actor: botActor(),
      postId: ID,
    });
    expect(presenter.outputs).toStrictEqual([
      { ok: false, code: "human_only" },
      { ok: false, code: "human_only" },
    ]);
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["refused.post.approve", "human_only"],
      ["refused.post.reject", "human_only"],
    ]);
  });

  it("approve schedules at now when publishAt has passed; reject cancels", async () => {
    const { world } = await setup({ lifecycle: "PENDING_REVIEW", publishAt: T0 - HOUR });
    const presenter = new Capture<CommandResult>();
    await new ApprovePostInteractor(world.command, world.clock, presenter).execute({
      actor: HUMAN,
      postId: ID,
    });
    expect(presenter.last).toMatchObject({
      ok: true,
      post: { status: "SCHEDULED", publishAt: T0 },
    });
    const other = await setup({ lifecycle: "PENDING_REVIEW" });
    await new RejectPostInteractor(other.world.command, presenter).execute({
      actor: HUMAN,
      postId: ID,
    });
    expect(presenter.last).toMatchObject({ ok: true, post: { status: "CANCELLED" } });
  });
});

describe("reschedule (human only)", () => {
  const NOT_FOUND: PartState = { kind: "NOT_FOUND", attemptAt: T0 };
  const run = async (world: World, confirmedNotOnX = false, actor = HUMAN) => {
    const presenter = new Capture<CommandResult<"confirmation_required">>();
    const interactor = new ReschedulePostInteractor(world.command, world.clock, presenter);
    await interactor.execute({ actor, postId: ID, publishAt: T0 + HOUR, confirmedNotOnX });
    return presenter.last;
  };

  it("a MISSED or FAILED post gets the new time", async () => {
    const missed = await setup({ lifecycle: "MISSED" });
    expect(await run(missed.world)).toMatchObject({
      ok: true,
      post: { status: "SCHEDULED", publishAt: T0 + HOUR },
    });
    const failed = await setup({
      lifecycle: "DONE",
      parts: [part("a", { kind: "REJECTED", reason: "r" })],
    });
    expect(await run(failed.world)).toMatchObject({ ok: true, post: { status: "SCHEDULED" } });
  });

  it("a NOT_FOUND part is re-sent only with the confirmation, which is audited", async () => {
    const { world } = await setup({
      lifecycle: "DONE",
      parts: [part("a", sentState("x")), part("b", NOT_FOUND)],
    });
    expect(await run(world)).toStrictEqual({ ok: false, code: "confirmation_required" });
    expect(await run(world, true)).toMatchObject({
      ok: true,
      post: { status: "RESUMING", resumeAt: T0, parts: [{ state: "SENT" }, { state: "PENDING" }] },
    });
    expect(world.audit.events.map((event) => [event.action, event.detail])).toStrictEqual([
      ["post.reschedule", "resend"],
    ]);
  });

  it("a bot cannot reschedule; anything else is an invalid transition", async () => {
    const { world } = await setup({ lifecycle: "MISSED" });
    expect(await run(world, false, botActor())).toStrictEqual({ ok: false, code: "human_only" });
    const scheduled = await setup();
    expect(await run(scheduled.world)).toStrictEqual({ ok: false, code: "invalid_transition" });
  });
});

describe("edit", () => {
  const run = async (world: World, input: Partial<EditPostInputData>) => {
    const presenter = new Capture<CommandResult<string>>();
    const interactor = new EditPostInteractor(
      {
        command: world.command,
        accounts: world.accounts,
        validator: world.validator,
        attachments: world.attachments,
      },
      presenter,
    );
    await interactor.execute({ actor: HUMAN, postId: ID, parts: null, publishAt: null, ...input });
    return presenter.last;
  };

  it("only a new time keeps the parts; nothing at all keeps both", async () => {
    const { world, post } = await setup({ publishAt: T0 + HOUR });
    expect(await run(world, { publishAt: T0 + 2 * HOUR })).toMatchObject({
      ok: true,
      post: { publishAt: T0 + 2 * HOUR },
    });
    expect(world.table.rows.get(ID)?.parts).toStrictEqual(post.parts);
    expect(await run(world, {})).toMatchObject({
      ok: true,
      post: { publishAt: T0 + 2 * HOUR, version: 3 },
    });
  });

  it("new parts are validated as at create, and the media attachments follow", async () => {
    const { world } = await setup({ publishAt: T0 + HOUR });
    const old = await world.stage(ACCOUNT, "PHOTO", "m-old");
    await world.media.save({ ...old, attachedTo: ID });
    const fresh = await world.stage(ACCOUNT, "PHOTO", "m-new");
    const out = await run(world, { parts: [{ text: "new", media: [fresh.id] }] });
    expect(out).toMatchObject({ ok: true, post: { parts: [{ text: "new", state: "PENDING" }] } });
    expect(world.media.rows.get(stagedMediaId("m-new"))?.attachedTo).toBe(ID);
    expect(world.media.rows.get(stagedMediaId("m-old"))?.attachedTo).toBeNull();
  });

  it("refuses invalid parts, the link policy, and an account that is gone", async () => {
    const { world } = await setup({ publishAt: T0 + HOUR });
    expect(await run(world, { parts: [] })).toStrictEqual({ ok: false, code: "no_parts" });
    await world.accounts.save({
      ...required(await world.accounts.get(ACCOUNT)),
      policy: aPolicy({ linkPolicy: "REFUSE" }),
    });
    expect(await run(world, { parts: [{ text: "https://x.co", media: [] }] })).toStrictEqual({
      ok: false,
      code: "link_policy",
    });
    world.accounts.rows.clear();
    expect(await run(world, { parts: [{ text: "a", media: [] }] })).toStrictEqual({
      ok: false,
      code: "account_not_found",
    });
    expect(world.table.rows.get(ID)?.version).toBe(1);
  });

  it("a started post cannot be edited", async () => {
    const { world } = await setup({
      lifecycle: "RESUMING",
      resumeAt: T0 + MINUTE,
      parts: [part("a", sentState("x")), part("b")],
    });
    expect(await run(world, { publishAt: T0 })).toStrictEqual({
      ok: false,
      code: "invalid_transition",
    });
  });
});
