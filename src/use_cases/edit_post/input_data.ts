import type { Actor } from "../../entities/identity/actor";
import type { PostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { PartInput } from "../authoring/parts_validator";

export interface EditPostInputData {
  readonly actor: Actor;
  readonly postId: PostId;
  /** Null keeps the parts. */
  readonly parts: readonly PartInput[] | null;
  /** Null keeps the publish time. */
  readonly publishAt: Instant | null;
}
