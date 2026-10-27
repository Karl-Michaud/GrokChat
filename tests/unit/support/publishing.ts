/** Helpers for the publishing tests: a generous meter, an HTTP failure, direct table access. */
import { invocationBudget } from "../../../src/entities/budget/budget";
import { postId, type PostId } from "../../../src/entities/identity/ids";
import type { PartState } from "../../../src/entities/posts/part_state";
import type { Post } from "../../../src/entities/posts/post";
import { HOUR } from "../../../src/entities/time/instant";
import type { XFailure } from "../../../src/entities/x/x_failure";
import { MemoryBudgetMeter } from "../../../src/frameworks/memory/memory_budget";
import { aPost, T0 } from "./builders";
import type { World } from "./world";

export const meter = (deadline = T0 + HOUR): MemoryBudgetMeter =>
  new MemoryBudgetMeter(invocationBudget(deadline));

export const http = (
  status: number,
  scope: "user" | "app" = "user",
  retryAt: number | null = null,
): XFailure => ({
  kind: "http",
  status,
  detail: "why",
  retryAt,
  scope,
});

export function put(world: World, post: Post): Post {
  world.table.rows.set(post.id, post);
  return post;
}

export const stored = (world: World, id: PostId = postId("post-1")): Post | undefined =>
  world.table.rows.get(id);

export const states = (world: World, id?: PostId): readonly PartState["kind"][] =>
  stored(world, id)?.parts.map((p) => p.state.kind) ?? [];

/** A seeded account and a SCHEDULED post due now. */
export async function ready(world: World, post: Partial<Post> = {}): Promise<Post> {
  await world.seedAccount();
  return put(world, aPost({ lifecycle: "SCHEDULED", publishAt: T0, ...post }));
}

/** The value, or a test failure: no non-null assertions in tests either. */
export function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}
