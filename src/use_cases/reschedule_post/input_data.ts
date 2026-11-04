import type { Actor } from "../../entities/identity/actor";
import type { PostId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

export interface ReschedulePostInputData {
  readonly actor: Actor;
  readonly postId: PostId;
  /** The new publish time for a FAILED or MISSED post. */
  readonly publishAt: Instant;
  /** For a NOT_FOUND post: the human checked X and the part is not there (rev 4 M4). */
  readonly confirmedNotOnX: boolean;
}
