/**
 * The MediaCleanupCandidates contract (plan §3.5): only due items, oldest staged first, at most
 * `limit`. The D1 driver and the in-memory stub both pass it (Agents/CLAUDE.md §7.1, Liskov).
 */
import { expect, it } from "vitest";
import { postId, stagedMediaId } from "../../src/entities/identity/ids";
import { KEEP_AFTER_DONE, KEEP_UNUSED } from "../../src/entities/media/media_cleanup";
import { HOUR } from "../../src/entities/time/instant";
import type { MediaCleanupCandidates } from "../../src/use_cases/ports/media_cleanup_candidates";
import type { MediaRepository } from "../../src/use_cases/ports/media_repository";
import type { PostWriter } from "../../src/use_cases/ports/post_writer";
import { aMedia, aPost, part, sentState, T0 } from "../unit/support/builders";

export interface CleanupStore {
  readonly candidates: MediaCleanupCandidates;
  readonly media: MediaRepository;
  readonly writer: PostWriter;
}

export function mediaCleanupCandidatesContract(make: () => CleanupStore): void {
  it("returns only due items: unused after 2 days, a done post's 7 days after its last send", async () => {
    const { candidates, media, writer } = make();
    const sentAt = T0 + HOUR;
    await writer.add(aPost({ id: postId("waiting"), lifecycle: "SCHEDULED" }));
    await writer.add(aPost({ id: postId("cancelled"), lifecycle: "CANCELLED" }));
    await writer.add(
      aPost({
        id: postId("done"),
        lifecycle: "DONE",
        parts: [part("a", sentState("x1", T0)), part("b", sentState("x2", sentAt))],
      }),
    );
    const item = (id: string, attachedTo: string | null) =>
      aMedia({
        id: stagedMediaId(id),
        storageKey: `key-${id}`,
        attachedTo: attachedTo === null ? null : postId(attachedTo),
      });
    for (const row of [
      item("free", null),
      item("gone", "missing"),
      item("kept", "waiting"),
      item("dropped", "cancelled"),
      item("used", "done"),
    ]) {
      await media.save(row);
    }
    const ids = async (now: number) => (await candidates.due(now, 10)).map((row) => String(row.id));
    expect(await ids(T0 + KEEP_UNUSED - 1)).toStrictEqual([]);
    expect(await ids(T0 + KEEP_UNUSED)).toStrictEqual(["dropped", "free", "gone"]);
    expect(await ids(sentAt + KEEP_AFTER_DONE - 1)).toStrictEqual(["dropped", "free", "gone"]);
    expect(await ids(sentAt + KEEP_AFTER_DONE)).toStrictEqual(["dropped", "free", "gone", "used"]);
    expect(await candidates.due(T0 + KEEP_UNUSED, 1)).toStrictEqual([item("dropped", "cancelled")]);
  });

  it("oldest staged first, then by id, at most `limit`; a limit of 0 returns nothing", async () => {
    const { candidates, media } = make();
    const rows = [
      aMedia({ id: stagedMediaId("c"), stagedAt: T0 }),
      aMedia({ id: stagedMediaId("a"), stagedAt: T0 + 1 }),
      aMedia({ id: stagedMediaId("b"), stagedAt: T0 }),
    ];
    for (const row of rows) {
      await media.save(row);
    }
    const now = T0 + 1 + KEEP_UNUSED;
    expect(await candidates.due(now, 10)).toStrictEqual([rows[2], rows[0], rows[1]]);
    expect(await candidates.due(now, 2)).toStrictEqual([rows[2], rows[0]]);
    expect(await candidates.due(now, 0)).toStrictEqual([]);
  });
}
