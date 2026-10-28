import type { Actor } from "../../entities/identity/actor";
import type { AccountId, IdempotencyKey } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { PartInput } from "../authoring/parts_validator";

/** A single post is a thread of one (`create_post` and `create_thread` both land here). */
export interface CreatePostInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly parts: readonly PartInput[];
  /** Null: publish now. The boundary has already checked it carried an offset (m5). */
  readonly publishAt: Instant | null;
  /** Null: an original post. Otherwise the post to reply to, as an X post id or its URL. */
  readonly replyTo: string | null;
  /** Required for bots (rev 4 B3). */
  readonly idempotencyKey: IdempotencyKey | null;
}
