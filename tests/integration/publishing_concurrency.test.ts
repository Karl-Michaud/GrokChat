/**
 * The publish path through the real account Durable Object and D1, with negative controls
 * (plan §4): R1 double send, R4 crash between X's 201 and our write, R14 idempotency race,
 * R17 a throw inside a part, R20 an orphaned PUBLISHING post.
 */
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { idempotencyKey, postId, type AccountId } from "../../src/entities/identity/ids";
import type { Post } from "../../src/entities/posts/post";
import { MINUTE, SECOND } from "../../src/entities/time/instant";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../src/frameworks/durable_objects/account_client";
import { SequentialIds } from "../../src/frameworks/memory/manual_clock";
import { AccessGuard } from "../../src/use_cases/access/access_guard";
import { ActionAudit } from "../../src/use_cases/access/action_audit";
import { MediaAttachments } from "../../src/use_cases/authoring/media_attachments";
import { PartsValidator } from "../../src/use_cases/authoring/parts_validator";
import { CreatePostInteractor } from "../../src/use_cases/create_post/interactor";
import type { CreatePostOutputData } from "../../src/use_cases/create_post/output_data";
import { aPolicy, aPost, botActor, part, T0 } from "../unit/support/builders";
import { Capture } from "../unit/support/world";
import { freshStorage } from "./support/fresh_d1";
import { harness, newHarness, objectFor, seedAccount, sleep } from "./support/harness";

beforeEach(freshStorage);

const DEADLINE = T0 + 10 * SECOND;
const stores = () => d1Stores(env.DB);

async function duePosts(account: AccountId, count: number): Promise<readonly Post[]> {
  const posts = Array.from({ length: count }, (_, index) =>
    aPost({
      id: postId(`${account}-p${String(index)}`),
      accountId: account,
      publishAt: T0 - MINUTE,
      parts: [part(`post ${String(index)}`)],
    }),
  );
  for (const post of posts) {
    await stores().writer.add(post);
  }
  return posts;
}

/**
 * Holds every query matching `matches` until `parties` of them have arrived, then lets them all
 * (and any later one) through: the calls that reach it are forced past this point together.
 */
function barrier(parties: number, matches: (sql: string) => boolean) {
  let arrived = 0;
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return (sql: string): Promise<void> => {
    if (!matches(sql)) {
      return Promise.resolve();
    }
    arrived += 1;
    if (arrived >= parties) {
      open();
    }
    return opened;
  };
}

/** `PublishPost.one` loads its post after recovery and before starting it. */
const loadsThePost = (sql: string): boolean => sql.endsWith("FROM posts WHERE id = ?1");
/** `PartSender`'s gate reads the account's recent attempts, then writes SENDING. */
const readsRecentAttempts = (sql: string): boolean =>
  sql.includes("FROM post_parts WHERE account_id = ?1 AND attempt_at >= ?2");

async function tenConcurrentPublishNow(locks: "mutex" | "none"): Promise<number> {
  const h = newHarness({ locks });
  h.x.beforeCreate = () => sleep(5);
  const account = await seedAccount({ policy: aPolicy({ dailyCap: 3, minGap: 0 }) });
  const posts = await duePosts(account.id, 10);
  if (locks === "none") {
    // The race the mutex closes, forced instead of left to timing: every call finishes its
    // recovery before any post starts, and every call reads the cap's attempts before any of them
    // writes SENDING. With the mutex the calls never overlap, so no barrier could fill.
    const started = barrier(posts.length, loadsThePost);
    const gated = barrier(posts.length, readsRecentAttempts);
    h.meter.afterQuery = async (sql) => {
      await started(sql);
      await gated(sql);
    };
  }
  const object = objectFor(account.id);
  await Promise.all(posts.map((post) => object.publishNow(account.id, post.id, DEADLINE)));
  return h.x.posts.size;
}

describe("R1: one Durable Object per account and its publish mutex", () => {
  it("10 concurrent publishNow with a cap of 3 send exactly 3", async () => {
    expect(await tenConcurrentPublishNow("mutex")).toBe(3);
  });

  // Deterministic: the barriers force every call through the gate on the same empty count, so all
  // ten send. Twenty rounds, each on a fresh account and object, prove it does not depend on luck.
  it.each(Array.from({ length: 20 }, (_, round) => round + 1))(
    "negative control, round %i: without the mutex the same calls all send (10, not 3)",
    async () => {
      expect(await tenConcurrentPublishNow("none")).toBe(10);
    },
  );
});

describe("R4: X created the post, then our write failed", () => {
  it("the part was SENDING before X was called; recovery makes it UNKNOWN; reconcile finds it; never re-sent", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const [post] = await duePosts(account.id, 1);
    const seen: string[][] = [];
    h.x.beforeCreate = async () => {
      const sending = await stores().reader.list({ partStates: ["SENDING"] });
      seen.push(sending.map((item) => item.id));
      h.meter.failBatches = 1;
    };
    const object = objectFor(account.id);
    const first = await object.publishNow(account.id, post?.id ?? postId(""), DEADLINE);
    expect(first.ran).toBe(false);
    expect(seen).toStrictEqual([[post?.id]]);
    expect(h.x.posts.size).toBe(1);
    await object.publishDue(account.id, T0, DEADLINE);
    const recovered = await stores().reader.get(post?.id ?? postId(""));
    expect(recovered?.lifecycle).toBe("DONE");
    expect(recovered?.parts[0]?.state.kind).toBe("UNKNOWN");
    expect(await object.reconcile(account.id, T0, DEADLINE)).toStrictEqual({
      ran: true,
      found: 1,
      notFound: 0,
    });
    expect((await stores().reader.get(post?.id ?? postId("")))?.parts[0]?.state.kind).toBe("SENT");
    await object.publishDue(account.id, T0 + MINUTE, DEADLINE);
    expect(h.x.posts.size).toBe(1);
    expect(h.builds).toBe(1);
  });

  it("a Durable Object reset mid-publish: the Worker sees no outcome and never retries; the next call recovers the part as UNKNOWN", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const [post] = await duePosts(account.id, 1);
    const id = post?.id ?? postId("");
    const progress = { atX: false };
    h.x.beforeCreate = async () => {
      progress.atX = true;
      await sleep(100);
    };
    const worker = new AccountObjects(env.TEST_ACCOUNT);
    const inFlight = worker.publishNow(account.id, id, DEADLINE);
    while (!progress.atX) {
      await sleep(1);
    }
    await abortAllDurableObjects();
    h.x.beforeCreate = () => Promise.resolve();
    expect(await inFlight).toStrictEqual({
      ran: false,
      sent: 0,
      touched: [],
      appRateLimited: false,
    });
    expect((await stores().reader.get(id))?.parts[0]?.state.kind).toBe("SENDING");
    await objectFor(account.id).publishDue(account.id, T0, DEADLINE);
    expect(h.builds).toBe(2);
    expect((await stores().reader.get(id))?.parts[0]?.state.kind).toBe("UNKNOWN");
    // The aborted run never resumes: nothing reached X, and nothing will re-send the part.
    await sleep(150);
    expect((await stores().reader.get(id))?.parts[0]?.state.kind).toBe("UNKNOWN");
    expect(h.x.posts.size).toBe(0);
  });
});

function creator(account: AccountId) {
  const h = harness();
  const s = stores();
  const audit = new ActionAudit(s.audit, h.clock);
  const presenter = new Capture<CreatePostOutputData>();
  const interactor = new CreatePostInteractor(
    {
      ...s,
      attachments: new MediaAttachments(s.media),
      validator: new PartsValidator(s.media),
      publisher: new AccountObjects(env.TEST_ACCOUNT),
      guard: new AccessGuard(audit),
      audit,
      ids: new SequentialIds(`${account}-post`),
      clock: h.clock,
    },
    presenter,
  );
  return async (text: string): Promise<CreatePostOutputData> => {
    await interactor.execute({
      actor: botActor([account]),
      accountId: account,
      parts: [{ text, media: [] }],
      publishAt: null,
      replyTo: null,
      idempotencyKey: idempotencyKey("k"),
    });
    return presenter.last;
  };
}

describe("R14: two concurrent creates with one idempotency key", () => {
  it("make one post and one X call; different content is refused", async () => {
    const h = newHarness();
    h.x.beforeCreate = () => sleep(5);
    const account = await seedAccount();
    const create = creator(account.id);
    const [a, b] = await Promise.all([create("mine"), create("mine")]);
    expect([a, b].map((output) => output.ok)).toStrictEqual([true, true]);
    expect(a.ok && b.ok && a.postId === b.postId).toBe(true);
    expect((await stores().reader.list({})).length).toBe(1);
    expect(h.x.posts.size).toBe(1);
    expect(await create("different")).toMatchObject({ ok: false, code: "idempotency_mismatch" });
  });
});

describe("R17: a throw inside a part is caught; the object is not reset and recovers the post", () => {
  it("a throw after SENDING: UNKNOWN on the next call, never re-sent", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const [post] = await duePosts(account.id, 1);
    const id = post?.id ?? postId("");
    h.x.beforeCreate = () => Promise.reject(new Error("thrown inside the part"));
    const object = objectFor(account.id);
    expect((await object.publishNow(account.id, id, DEADLINE)).ran).toBe(false);
    expect((await stores().reader.get(id))?.parts[0]?.state.kind).toBe("SENDING");
    h.x.beforeCreate = () => Promise.resolve();
    await object.publishDue(account.id, T0, DEADLINE);
    expect((await stores().reader.get(id))?.parts[0]?.state.kind).toBe("UNKNOWN");
    expect(h.x.posts.size).toBe(0);
    expect(h.builds).toBe(1);
  });

  it("a throw before SENDING: the post goes back to the queue and is sent by the next call", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const [post] = await duePosts(account.id, 1);
    const id = post?.id ?? postId("");
    // The start (SCHEDULED → PUBLISHING) is written; the SENDING write fails.
    h.meter.passBatches = 1;
    h.meter.failBatches = 1;
    const object = objectFor(account.id);
    expect((await object.publishNow(account.id, id, DEADLINE)).ran).toBe(false);
    expect((await stores().reader.get(id))?.lifecycle).toBe("PUBLISHING");
    expect(await object.publishDue(account.id, T0, DEADLINE)).toMatchObject({ ran: true, sent: 1 });
    expect((await stores().reader.get(id))?.lifecycle).toBe("DONE");
    expect(h.x.posts.size).toBe(1);
  });
});

describe("R20: an orphaned PUBLISHING post", () => {
  it("on an account with nothing else due is found by the tick's query and recovered by the next call", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const orphan = aPost({
      id: postId(`${account.id}-orphan`),
      accountId: account.id,
      lifecycle: "PUBLISHING",
      publishAt: T0 - MINUTE,
      version: 2,
    });
    await stores().writer.add(orphan);
    const work = await stores().reader.accountsNeedingWork(T0);
    expect(work).toStrictEqual([
      { accountId: account.id, oldestDueAt: T0, publish: true, reconcile: false, metrics: false },
    ]);
    expect(await objectFor(account.id).publishDue(account.id, T0, DEADLINE)).toMatchObject({
      ran: true,
      sent: 1,
    });
    expect((await stores().reader.get(orphan.id))?.lifecycle).toBe("DONE");
    expect(h.x.posts.size).toBe(1);
  });
});

describe("§3.1.1: a publishNow that cannot get publishLock by its deadline", () => {
  it("returns not-run at its deadline while a publishDue still holds the lock, and leaves its post unchanged", async () => {
    const h = newHarness();
    const account = await seedAccount();
    const [first, second] = await duePosts(account.id, 2);
    // Flags polled on each side's own timers, and the clock moved from inside the object: a promise
    // settled across the test and the object would carry one context's I/O into the other.
    const flags = { entered: false, released: false };
    h.x.beforeCreate = async () => {
      flags.entered = true;
      while (h.clock.pendingWaits() === 0) {
        await sleep(1);
      }
      h.clock.advance(DEADLINE - T0 + SECOND);
      while (!flags.released) {
        await sleep(1);
      }
    };
    const object = objectFor(account.id);
    const due = object.publishDue(account.id, T0, DEADLINE + MINUTE);
    while (!flags.entered) {
      await sleep(1);
    }
    const now = object.publishNow(account.id, second?.id ?? postId(""), DEADLINE);
    expect(await now).toMatchObject({ ran: false, sent: 0 });
    const untouched = await stores().reader.get(second?.id ?? postId(""));
    expect(untouched?.lifecycle).toBe("SCHEDULED");
    expect(untouched?.version).toBe(second?.version);
    expect(untouched?.parts[0]?.state.kind).toBe("PENDING");
    expect(h.x.posts.size).toBe(0);
    flags.released = true;
    expect((await due).ran).toBe(true);
    expect((await stores().reader.get(first?.id ?? postId("")))?.lifecycle).toBe("DONE");
  });
});
