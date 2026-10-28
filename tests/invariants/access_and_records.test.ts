/**
 * I2 scope on every bot-facing use case (R7), I5 every X call has a cost and an audit entry,
 * I6 no secret in any output, record or stored row (R8), I8 idempotency under concurrency (R14).
 */
import { describe, expect, it } from "vitest";
import {
  idempotencyKey,
  postId,
  stagedMediaId,
  xPostId,
  xUserId,
} from "../../src/entities/identity/ids";
import { DAY, HOUR } from "../../src/entities/time/instant";
import { invocationBudget } from "../../src/entities/budget/budget";
import { InvocationBudgetMeter } from "../../src/frameworks/budget/invocation_meter";
import type { CommandResult } from "../../src/use_cases/authoring/post_command";
import { CancelPostInteractor } from "../../src/use_cases/cancel_post/interactor";
import { ComparePostsInteractor } from "../../src/use_cases/compare_posts/interactor";
import { CreatePostInteractor } from "../../src/use_cases/create_post/interactor";
import type { CreatePostInputData } from "../../src/use_cases/create_post/input_data";
import type { CreatePostOutputData } from "../../src/use_cases/create_post/output_data";
import { DeletePostInteractor } from "../../src/use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../src/use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "../../src/use_cases/get_account_metrics/interactor";
import { GetPolicyInteractor } from "../../src/use_cases/get_policy/interactor";
import { GetPostInteractor } from "../../src/use_cases/get_post/interactor";
import { GetPostMetricsInteractor } from "../../src/use_cases/get_post_metrics/interactor";
import { ListBacklogInteractor } from "../../src/use_cases/list_backlog/interactor";
import { StageMediaFromUrlInteractor } from "../../src/use_cases/stage_media_from_url/interactor";
import {
  ACCOUNT,
  aPolicy,
  aPost,
  botActor,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../unit/support/builders";
import { Capture, makeWorld, PNG, type World } from "../unit/support/world";

const BOT = botActor([ACCOUNT]);
const THEIRS = postId("theirs");
const WINDOW = { from: T0 - DAY, to: T0 + DAY };

async function twoAccounts(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
  await world.seedAccount({ id: OTHER_ACCOUNT, xUserId: xUserId("x-user-2") });
  world.table.rows.set(
    THEIRS,
    aPost({
      id: THEIRS,
      accountId: OTHER_ACCOUNT,
      lifecycle: "DONE",
      parts: [part("theirs", sentState("x-theirs"))],
    }),
  );
  await world.stage(OTHER_ACCOUNT, "PHOTO", "their-media");
  return world;
}

function creator(world: World) {
  const presenter = new Capture<CreatePostOutputData>();
  const interactor = new CreatePostInteractor(
    {
      accounts: world.accounts,
      reader: world.reader,
      ownPosts: world.reader,
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
      actor: BOT,
      accountId: ACCOUNT,
      parts: [{ text: "mine", media: [] }],
      publishAt: null,
      replyTo: null,
      idempotencyKey: idempotencyKey("k"),
      ...input,
    });
    return presenter.last;
  };
}

type Probe = (world: World) => Promise<unknown>;

function last<T>(run: (presenter: Capture<T>) => Promise<void>): Promise<T> {
  const presenter = new Capture<T>();
  return run(presenter).then(() => presenter.last);
}

/** Every bot-facing use case, aimed at the other account's post, account or media. */
const PROBES: Readonly<Record<string, Probe>> = {
  create_post: (w) => creator(w)({ accountId: OTHER_ACCOUNT }),
  create_post_media: (w) =>
    creator(w)({ parts: [{ text: "x", media: [stagedMediaId("their-media")] }] }),
  stage_media_from_url: (w) =>
    last((p) =>
      new StageMediaFromUrlInteractor(
        {
          accounts: w.accounts,
          fetcher: w.fetcher,
          intake: w.intake,
          guard: w.guard,
          allowedHosts: ["cdn.example.com"],
        },
        p,
      ).execute({ actor: BOT, accountId: OTHER_ACCOUNT, url: "https://cdn.example.com/a.png" }),
    ),
  edit_post: (w) =>
    last<CommandResult<string>>((p) =>
      new EditPostInteractor(
        {
          command: w.command,
          accounts: w.accounts,
          validator: w.validator,
          attachments: w.attachments,
        },
        p,
      ).execute({ actor: BOT, postId: THEIRS, parts: null, publishAt: T0 }),
    ),
  cancel_post: (w) =>
    last((p) => new CancelPostInteractor(w.command, p).execute({ actor: BOT, postId: THEIRS })),
  delete_post: (w) =>
    last((p) =>
      new DeletePostInteractor(
        {
          reader: w.reader,
          gateway: w.gateway,
          steps: w.steps,
          guard: w.guard,
          audit: w.actionAudit,
        },
        p,
      ).execute({ actor: BOT, postId: THEIRS }),
    ),
  get_post: (w) =>
    last((p) =>
      new GetPostInteractor(w.reader, w.guard, p).execute({ actor: BOT, postId: THEIRS }),
    ),
  list_backlog: (w) =>
    last((p) =>
      new ListBacklogInteractor(w.reader, w.guard, p).execute({
        actor: BOT,
        accountId: OTHER_ACCOUNT,
        statuses: null,
        window: null,
      }),
    ),
  get_post_metrics: (w) =>
    last((p) =>
      new GetPostMetricsInteractor(w.reader, w.metrics, w.guard, p).execute({
        actor: BOT,
        postId: THEIRS,
      }),
    ),
  get_account_metrics: (w) =>
    last((p) =>
      new GetAccountMetricsInteractor(w.metrics, w.guard, p).execute({
        actor: BOT,
        accountId: OTHER_ACCOUNT,
        window: WINDOW,
      }),
    ),
  compare_posts: (w) =>
    last((p) =>
      new ComparePostsInteractor(w.metrics, w.guard, p).execute({
        actor: BOT,
        accountId: OTHER_ACCOUNT,
        window: WINDOW,
        sortBy: "likes",
      }),
    ),
  get_policy: (w) =>
    last((p) =>
      new GetPolicyInteractor(w.accounts, w.guard, p).execute({
        actor: BOT,
        accountId: OTHER_ACCOUNT,
      }),
    ),
};

/** The audit action each probe's refusal is written under. */
const ACTIONS: Readonly<Record<string, string>> = {
  create_post: "post.create",
  stage_media_from_url: "media.stage",
  edit_post: "post.edit",
  cancel_post: "post.cancel",
  delete_post: "post.delete",
  get_post: "post.get",
  list_backlog: "post.list",
  get_post_metrics: "metrics.post",
  get_account_metrics: "metrics.account",
  compare_posts: "metrics.compare",
  get_personality: "personality.get",
  get_policy: "policy.get",
};

describe("I2 / R7: a bot outside its scope is refused everywhere, nothing is written, the refusal is audited", () => {
  it.each(Object.keys(PROBES))("%s", async (name) => {
    const world = await twoAccounts();
    const before = JSON.stringify({
      posts: [...world.table.rows],
      media: [...world.media.rows],
      x: [...world.x.posts],
    });
    const probe = PROBES[name];
    if (probe === undefined) {
      throw new Error(name);
    }
    const out = await probe(world);
    const expected = name === "create_post_media" ? "media_not_owned" : "scope";
    expect(out).toMatchObject({ ok: false, code: expected });
    expect(
      JSON.stringify({
        posts: [...world.table.rows],
        media: [...world.media.rows],
        x: [...world.x.posts],
      }),
    ).toBe(before);
    if (expected === "scope") {
      const seen = world.audit.events.map((event) => [
        event.actor,
        event.action,
        event.detail,
        event.accountId,
      ]);
      expect(seen).toStrictEqual([
        ["bot:bot-1", `refused.${ACTIONS[name] ?? ""}`, "scope", OTHER_ACCOUNT],
      ]);
    }
    expect(world.costs.entries).toHaveLength(0);
  });
});

describe("I5: every X call writes one cost entry and one audit entry", () => {
  it("across publish with media, a failure, reconcile, metrics and delete", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    let calls = 0;
    const count =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      (...args: A): Promise<R> => {
        calls += 1;
        return fn(...args);
      };
    world.xPublisher.create = count(world.xPublisher.create.bind(world.xPublisher));
    world.xPublisher.delete = count(world.xPublisher.delete.bind(world.xPublisher));
    world.uploader.upload = count(world.uploader.upload.bind(world.uploader));
    world.timeline.recent = count(world.timeline.recent.bind(world.timeline));
    world.xMetrics.read = count(world.xMetrics.read.bind(world.xMetrics));
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-1");
    world.table.rows.set(
      postId("a"),
      aPost({ id: postId("a"), parts: [part("a", undefined, [photo.id]), part("b")] }),
    );
    world.table.rows.set(postId("u"), aPost({ id: postId("u"), parts: [part("u")] }));
    world.x.scripts.create.push(
      { kind: "ok" },
      { kind: "ok" },
      { kind: "fail", failure: { kind: "no_response" } },
    );
    const meter = (): InvocationBudgetMeter =>
      new InvocationBudgetMeter(invocationBudget(world.clock.now() + DAY));
    await world.publishPost.publishDue(ACCOUNT, meter());
    await world.reconcileAccount.reconcile(ACCOUNT, meter());
    world.clock.advance(HOUR);
    await world.collectMetrics.collect(ACCOUNT, meter());
    await world.gateway.deletePost(ACCOUNT, [xPostId("x-3"), xPostId("x-2")]);
    const xAudit = world.audit.events.filter((event) => event.actor === "system:x");
    expect(calls).toBe(8);
    expect(world.costs.entries).toHaveLength(calls);
    expect(xAudit).toHaveLength(calls);
    expect(xAudit.map((event) => event.action)).toStrictEqual([
      "x.media_upload",
      "x.create",
      "x.create",
      "x.create",
      "x.read",
      "x.read",
      "x.delete",
      "x.delete",
    ]);
  });
});

describe("I6 / R8: no token or bearer credential anywhere", () => {
  it("after connecting, refreshing, publishing, failing and reading back", async () => {
    const world = makeWorld();
    await world.seedAccount({ policy: aPolicy({ minGap: 0 }) });
    world.clock.advance(3 * HOUR);
    world.table.rows.set(
      postId("p"),
      aPost({ id: postId("p"), publishAt: world.clock.now(), parts: [part("a"), part("b")] }),
    );
    world.x.scripts.create.push(
      { kind: "ok" },
      {
        kind: "fail",
        failure: {
          kind: "http",
          status: 400,
          detail: "echo: Bearer access-2",
          retryAt: null,
          scope: "user",
        },
      },
    );
    const outputs: unknown[] = [];
    outputs.push(
      await world.publishPost.publishDue(
        ACCOUNT,
        new InvocationBudgetMeter(invocationBudget(world.clock.now() + HOUR)),
      ),
    );
    outputs.push(await creator(world)({ actor: BOT, parts: [{ text: "c", media: [] }] }));
    const secrets = [
      ...world.tokenEndpoint.valid,
      ...world.tokenEndpoint.calls,
      "access-1",
      "access-2",
      "access-3",
    ];
    const visible = JSON.stringify({
      outputs,
      posts: [...world.table.rows.values()],
      accounts: [...world.accounts.rows.values()],
      audit: world.audit.events,
      costs: world.costs.entries,
    });
    expect(world.tokenEndpoint.calls).toStrictEqual(["refresh-1"]);
    for (const secret of secrets) {
      expect(visible.includes(secret)).toBe(false);
    }
    expect(visible).toContain("Bearer [redacted]");
  });
});

describe("I8 / R14: two concurrent creates with one key", () => {
  it("make one post and one X call; different content is refused", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const create = creator(world);
    const [a, b] = await Promise.all([create({}), create({})]);
    expect(a).toMatchObject({ ok: true, postId: postId("id-1") });
    expect(b).toMatchObject({ ok: true, postId: postId("id-1"), duplicate: true });
    expect(world.table.rows.size).toBe(1);
    expect(world.x.posts.size).toBe(1);
    expect(await create({ parts: [{ text: "different", media: [] }] })).toMatchObject({
      ok: false,
      code: "idempotency_mismatch",
    });
  });

  it("the stored media is untouched by a duplicate", async () => {
    const world = makeWorld();
    await world.seedAccount();
    const photo = await world.stage(ACCOUNT, "PHOTO", "m-1");
    const create = creator(world);
    await create({ parts: [{ text: "pic", media: [photo.id] }] });
    await create({ parts: [{ text: "pic", media: [photo.id] }] });
    expect(world.uploader.uploads).toStrictEqual([
      { account: ACCOUNT, size: PNG.length, kind: "PHOTO" },
    ]);
  });
});
