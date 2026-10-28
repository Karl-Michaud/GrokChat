/** The store of posts made outside GrokChat (GROKCHAT-19), for the stub and the D1 driver. */
import { expect, it } from "vitest";
import { accountId, postId, xPostId, xUserId } from "../../src/entities/identity/ids";
import { IMPORT_INTERVAL, type ImportedPost } from "../../src/entities/posts/imported_post";
import { DAY, HOUR } from "../../src/entities/time/instant";
import type { AccountRepository } from "../../src/use_cases/ports/account_repository";
import type { ImportedPostStore, ImportSchedule } from "../../src/use_cases/ports/imported_posts";
import type { MetricsRepository } from "../../src/use_cases/ports/metrics_repository";
import type { PostWriter } from "../../src/use_cases/ports/post_writer";
import {
  ACCOUNT,
  anAccount,
  aPost,
  aSnapshot,
  OTHER_ACCOUNT,
  part,
  sentState,
  T0,
} from "../unit/support/builders";

export interface ImportedPostsHarness {
  readonly store: ImportedPostStore & ImportSchedule;
  readonly accounts: AccountRepository;
  readonly writer: PostWriter;
  readonly metrics: MetricsRepository;
}

const imported = (id: string, createdAt = T0, account = ACCOUNT): ImportedPost => ({
  xPostId: xPostId(id),
  accountId: account,
  text: `post ${id}`,
  createdAt,
  inReplyTo: id === "reply" ? xPostId("42") : null,
  importedAt: createdAt + HOUR,
});

export function importedPostsContract(make: () => ImportedPostsHarness): void {
  it("stores new posts once and lists them oldest first, as stored", async () => {
    const { store } = make();
    expect(await store.add([])).toBe(0);
    expect(await store.add([imported("b", T0 + 1), imported("reply", T0)])).toBe(2);
    expect(await store.add([imported("b", T0 + 1), imported("c", T0 + 2)])).toBe(1);
    expect(await store.list({})).toStrictEqual([
      imported("reply", T0),
      imported("b", T0 + 1),
      imported("c", T0 + 2),
    ]);
  });

  it("filters by account and by a half-open creation window", async () => {
    const { store } = make();
    await store.add([imported("a", T0), imported("b", T0 + DAY), imported("o", T0, OTHER_ACCOUNT)]);
    const ids = async (filter: Parameters<ImportedPostStore["list"]>[0]) =>
      (await store.list(filter)).map((post) => post.xPostId);
    expect(await ids({ accountIds: [ACCOUNT] })).toStrictEqual(["a", "b"]);
    expect(await ids({ accountIds: [] })).toStrictEqual([]);
    expect(await ids({ createdWindow: { from: T0, to: T0 + DAY } })).toStrictEqual(["a", "o"]);
    expect(
      await ids({ accountIds: [OTHER_ACCOUNT], createdWindow: { from: T0 + 1, to: T0 + DAY } }),
    ).toStrictEqual([]);
  });

  it("never stores or lists a post GrokChat published itself", async () => {
    const { store, writer } = make();
    await store.add([imported("x-race")]);
    await writer.add(aPost({ id: postId("p"), parts: [part("ours", sentState("x-ours"))] }));
    expect(await store.add([imported("x-ours")])).toBe(0);
    expect(await store.list({})).toStrictEqual([imported("x-race")]);
    await writer.add(aPost({ id: postId("q"), parts: [part("late", sentState("x-race"))] }));
    expect(await store.list({})).toStrictEqual([]);
  });

  it("keeps a cursor per account; a finish without a newest post keeps the last one", async () => {
    const { store } = make();
    expect(await store.cursor(ACCOUNT)).toStrictEqual({ lastRunAt: null, newestCreatedAt: null });
    await store.finish(ACCOUNT, T0, T0 - HOUR);
    await store.finish(ACCOUNT, T0 + DAY, null);
    expect(await store.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: T0 + DAY,
      newestCreatedAt: T0 - HOUR,
    });
    await store.finish(ACCOUNT, T0 + 2 * DAY, T0 + DAY);
    expect(await store.cursor(ACCOUNT)).toStrictEqual({
      lastRunAt: T0 + 2 * DAY,
      newestCreatedAt: T0 + DAY,
    });
    expect(await store.cursor(OTHER_ACCOUNT)).toStrictEqual({
      lastRunAt: null,
      newestCreatedAt: null,
    });
  });

  it("is due for connected accounts not imported within the interval, by id", async () => {
    const { store, accounts } = make();
    const account = (id: string, status: "ACTIVE" | "PAUSED" | "NEEDS_RECONNECT") =>
      accounts.save(anAccount({ id: accountId(id), xUserId: xUserId(`x-${id}`), status }));
    await account("b-active", "ACTIVE");
    await account("a-paused", "PAUSED");
    await account("c-lost", "NEEDS_RECONNECT");
    expect(await store.accountsDue(T0)).toStrictEqual([
      accountId("a-paused"),
      accountId("b-active"),
    ]);
    await store.finish(accountId("a-paused"), T0, null);
    expect(await store.accountsDue(T0 + IMPORT_INTERVAL - 1)).toStrictEqual([
      accountId("b-active"),
    ]);
    expect(await store.accountsDue(T0 + IMPORT_INTERVAL)).toStrictEqual([
      accountId("a-paused"),
      accountId("b-active"),
    ]);
  });

  it("is due for an account with an imported post whose metrics read has passed", async () => {
    const { store, metrics } = make();
    await store.add([imported("m", T0, OTHER_ACCOUNT)]);
    expect(await store.accountsDue(T0 + HOUR - 1)).toStrictEqual([]);
    expect(await store.accountsDue(T0 + HOUR)).toStrictEqual([OTHER_ACCOUNT]);
    await metrics.addSnapshots([aSnapshot("m", T0 + HOUR, 5, { accountId: OTHER_ACCOUNT })]);
    expect(await store.accountsDue(T0 + 6 * HOUR - 1)).toStrictEqual([]);
    expect(await store.accountsDue(T0 + 6 * HOUR)).toStrictEqual([OTHER_ACCOUNT]);
  });
}
