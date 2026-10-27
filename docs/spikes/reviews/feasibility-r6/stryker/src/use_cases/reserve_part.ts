import { checkPublishable, type Recent } from "../entities/policy";
export interface PartStore {
  recent(accountId: string): Promise<Recent>;
  markSending(postId: string, k: number, expectedVersion: number): Promise<"ok" | "conflict">;
}
export type ReserveResult = "reserved" | "conflict" | "refused:cap" | "refused:gap";
export async function reservePart(store: PartStore, accountId: string, postId: string, k: number, version: number,
                                  now: number, cap: number, minGapMs: number): Promise<ReserveResult> {
  const verdict = checkPublishable(now, await store.recent(accountId), cap, minGapMs);
  if (verdict.kind === "refused") return `refused:${verdict.reason}`;
  return (await store.markSending(postId, k, version)) === "ok" ? "reserved" : "conflict";
}
