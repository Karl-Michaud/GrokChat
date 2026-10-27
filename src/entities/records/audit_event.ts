import type { AccountId, PostId } from "../identity/ids";
import type { Instant } from "../time/instant";

/** One line of the audit log. `detail` is always passed through `redact` before it is built. */
export interface AuditEvent {
  readonly at: Instant;
  readonly actor: string;
  readonly action: string;
  readonly accountId: AccountId | null;
  readonly postId: PostId | null;
  readonly detail: string;
}
