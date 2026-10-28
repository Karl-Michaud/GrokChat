/**
 * The PostReader / PostWriter contract (plan §3.2). PR 3 runs the same suite against the D1
 * driver; every driver and stub must pass it (Agents/CLAUDE.md §7.1, Liskov).
 */
import { expect, it } from "vitest";
import { botId, idempotencyKey, postId, xPostId } from "../../src/entities/identity/ids";
import { HOUR, MINUTE } from "../../src/entities/time/instant";
import type { AuditLog } from "../../src/use_cases/ports/audit_log";
import type { CostLedger } from "../../src/use_cases/ports/cost_ledger";
import type { PostReader } from "../../src/use_cases/ports/post_reader";
import type { PostWriter } from "../../src/use_cases/ports/post_writer";
import type { PublishingCount } from "../../src/use_cases/ports/publishing_count";
import {
  ACCOUNT,
  aPost,
  OTHER_ACCOUNT,
  part,
  sendingState,
  sentState,
  T0,
  unknownState,
} from "../unit/support/builders";

export interface PostStore {
  readonly reader: PostReader & PublishingCount;
  readonly writer: PostWriter;
  readonly audit: AuditLog;
  readonly costs: CostLedger;
}

const AUDIT = {
  at: T0,
  actor: "a",
  action: "x.create",
  accountId: ACCOUNT,
  postId: null,
  detail: "",
};
const COST = {
  at: T0,
  accountId: ACCOUNT,
  operation: "create",
  estimate: { kind: "usd", micros: 1 },
} as const;

export function postStoreContract(make: () => PostStore): void {
  it("counts the posts PUBLISHING now, and nothing else", async () => {
    const { reader, writer } = make();
    expect(await reader.publishingCount()).toBe(0);
    const lifecycles = ["PUBLISHING", "SCHEDULED", "PUBLISHING", "DONE", "RESUMING"] as const;
    for (const [index, lifecycle] of lifecycles.entries()) {
      await writer.add(aPost({ id: postId(`p-${String(index)}`), lifecycle }));
    }
    expect(await reader.publishingCount()).toBe(2);
  });

  it("add then get; a missing id is null", async () => {
    const { reader, writer } = make();
    const post = aPost();
    expect(await writer.add(post)).toStrictEqual({ kind: "added" });
    expect(await reader.get(post.id)).toStrictEqual(post);
    expect(await reader.get(postId("nope"))).toBeNull();
  });

  it("keeps a reply's target", async () => {
    const { reader, writer } = make();
    const reply = aPost({ id: postId("reply-1"), replyTo: xPostId("1850000000000000001") });
    await writer.add(reply);
    expect(await reader.get(reply.id)).toStrictEqual(reply);
  });

  it("(bot, key) is unique: the second add returns the first post; humans and other keys do not collide", async () => {
    const { reader, writer } = make();
    const provenance = { ...aPost().provenance, botId: botId("b") };
    const first = aPost({ id: postId("a"), idempotencyKey: idempotencyKey("k"), provenance });
    await writer.add(first);
    expect(await writer.add({ ...first, id: postId("b") })).toStrictEqual({
      kind: "duplicate",
      existing: first,
    });
    expect(
      await writer.add({ ...first, id: postId("c"), idempotencyKey: idempotencyKey("other") }),
    ).toStrictEqual({
      kind: "added",
    });
    expect(
      await writer.add(aPost({ id: postId("d"), idempotencyKey: idempotencyKey("k") })),
    ).toStrictEqual({ kind: "added" });
    expect(await writer.add(aPost({ id: postId("e") }))).toStrictEqual({ kind: "added" });
    expect(await reader.findByIdempotency(botId("b"), idempotencyKey("k"))).toStrictEqual(first);
    expect(await reader.findByIdempotency(botId("z"), idempotencyKey("k"))).toBeNull();
  });

  it("save is guarded on version and lifecycle", async () => {
    const { reader, writer } = make();
    const post = aPost({ version: 3 });
    await writer.add(post);
    const next = { ...post, lifecycle: "PUBLISHING", version: 4 } as const;
    expect(await writer.save(next, 2, "SCHEDULED")).toStrictEqual({ kind: "version_conflict" });
    expect(await writer.save(next, 3, "DRAFT")).toStrictEqual({ kind: "version_conflict" });
    expect(await writer.save({ ...next, id: postId("ghost") }, 3, "SCHEDULED")).toStrictEqual({
      kind: "version_conflict",
    });
    expect(await writer.save(next, 3, "SCHEDULED")).toStrictEqual({ kind: "ok" });
    expect(await reader.get(post.id)).toStrictEqual(next);
  });

  it("commitPart writes the post, its audit and its cost together, or nothing (R21)", async () => {
    const { reader, writer, audit, costs } = make();
    const post = aPost({ lifecycle: "PUBLISHING", parts: [part("a", sendingState())], version: 5 });
    await writer.add(post);
    const done = {
      ...post,
      lifecycle: "DONE",
      parts: [part("a", sentState("x"))],
      version: 6,
    } as const;
    expect(await writer.commitPart(done, 4, "PUBLISHING", AUDIT, COST)).toStrictEqual({
      kind: "version_conflict",
    });
    expect(await writer.commitPart(done, 5, "SCHEDULED", AUDIT, COST)).toStrictEqual({
      kind: "version_conflict",
    });
    expect(
      await writer.commitPart({ ...done, id: postId("ghost") }, 5, "PUBLISHING", AUDIT, COST),
    ).toStrictEqual({ kind: "version_conflict" });
    expect(await reader.get(post.id)).toStrictEqual(post);
    expect(await audit.list({})).toStrictEqual([]);
    expect((await costs.totals({ from: T0, to: T0 + 1 }, null)).calls).toBe(0);
    expect(await writer.commitPart(done, 5, "PUBLISHING", AUDIT, COST)).toStrictEqual({
      kind: "ok",
    });
    expect(await reader.get(post.id)).toStrictEqual(done);
    expect(await audit.list({})).toStrictEqual([AUDIT]);
    expect((await costs.totals({ from: T0, to: T0 + 1 }, null)).calls).toBe(1);
  });

  it("list filters by account, lifecycle, part state, publish window and due time, ordered by publishAt", async () => {
    const { reader, writer } = make();
    await writer.add(aPost({ id: postId("late"), publishAt: T0 + HOUR }));
    await writer.add(aPost({ id: postId("early"), publishAt: T0 - HOUR }));
    await writer.add(aPost({ id: postId("other"), accountId: OTHER_ACCOUNT, publishAt: T0 }));
    await writer.add(
      aPost({
        id: postId("done"),
        lifecycle: "DONE",
        publishAt: T0,
        parts: [part("a", unknownState())],
      }),
    );
    await writer.add(
      aPost({
        id: postId("resume"),
        lifecycle: "RESUMING",
        publishAt: T0 - 2 * HOUR,
        resumeAt: T0 + MINUTE,
      }),
    );
    const ids = async (filter: Parameters<PostReader["list"]>[0]) =>
      (await reader.list(filter)).map((post) => post.id);
    expect(await ids({})).toStrictEqual(["resume", "early", "done", "other", "late"]);
    expect(await ids({ accountIds: [OTHER_ACCOUNT] })).toStrictEqual(["other"]);
    expect(await ids({ lifecycles: ["DONE", "RESUMING"] })).toStrictEqual(["resume", "done"]);
    expect(await ids({ partStates: ["UNKNOWN"] })).toStrictEqual(["done"]);
    expect(await ids({ publishWindow: { from: T0 - HOUR, to: T0 + HOUR } })).toStrictEqual([
      "early",
      "done",
      "other",
    ]);
    expect(await ids({ dueBy: T0, accountIds: [ACCOUNT] })).toStrictEqual(["early"]);
    expect(await ids({ dueBy: T0 + MINUTE, accountIds: [ACCOUNT] })).toStrictEqual([
      "resume",
      "early",
    ]);
  });

  it("recentActivity covers the account's posts with a part SENDING, SENT or UNKNOWN", async () => {
    const { reader, writer } = make();
    await writer.add(aPost({ id: postId("a"), parts: [part("a", sentState("x", T0 - 5))] }));
    await writer.add(aPost({ id: postId("b"), parts: [part("b")] }));
    await writer.add(
      aPost({ id: postId("c"), accountId: OTHER_ACCOUNT, parts: [part("c", sendingState(T0))] }),
    );
    expect(await reader.recentActivity(ACCOUNT, T0)).toStrictEqual({
      posts: [{ postId: postId("a"), firstAt: T0 - 5, lastAt: T0 - 5 }],
    });
  });

  it("accountsNeedingWork: due, PUBLISHING, UNKNOWN or metrics due; oldest due first", async () => {
    const { reader, writer } = make();
    await writer.add(aPost({ id: postId("due"), publishAt: T0 - MINUTE }));
    await writer.add(
      aPost({ id: postId("future"), accountId: OTHER_ACCOUNT, publishAt: T0 + HOUR }),
    );
    expect(await reader.accountsNeedingWork(T0)).toStrictEqual([
      {
        accountId: ACCOUNT,
        oldestDueAt: T0 - MINUTE,
        publish: true,
        reconcile: false,
        metrics: false,
      },
    ]);
    await writer.add(
      aPost({
        id: postId("unknown"),
        accountId: OTHER_ACCOUNT,
        lifecycle: "DONE",
        parts: [part("u", unknownState())],
      }),
    );
    await writer.add(
      aPost({
        id: postId("sent"),
        lifecycle: "DONE",
        parts: [part("s", sentState(xPostId("x"), T0 - HOUR))],
      }),
    );
    expect(await reader.accountsNeedingWork(T0)).toStrictEqual([
      {
        accountId: ACCOUNT,
        oldestDueAt: T0 - MINUTE,
        publish: true,
        reconcile: false,
        metrics: true,
      },
      {
        accountId: OTHER_ACCOUNT,
        oldestDueAt: T0,
        publish: false,
        reconcile: true,
        metrics: false,
      },
    ]);
  });
}
