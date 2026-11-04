import type { XPostId } from "../identity/ids";
import type { Instant } from "../time/instant";

/** The state of one part of a post (plan §3.1): the post's status is derived from these. */
export type PartState =
  | { readonly kind: "PENDING" }
  | { readonly kind: "SENDING"; readonly attemptAt: Instant }
  | { readonly kind: "SENT"; readonly xPostId: XPostId; readonly at: Instant }
  | { readonly kind: "UNKNOWN"; readonly attemptAt: Instant; readonly checks: number }
  | { readonly kind: "NOT_FOUND"; readonly attemptAt: Instant }
  | { readonly kind: "REJECTED"; readonly reason: string }
  | { readonly kind: "DELETED"; readonly xPostId: XPostId };

export type PartStateKind = PartState["kind"];

export const PART_STATE_KINDS: readonly PartStateKind[] = [
  "PENDING",
  "SENDING",
  "SENT",
  "UNKNOWN",
  "NOT_FOUND",
  "REJECTED",
  "DELETED",
];

export const PENDING: PartState = { kind: "PENDING" };

/** When a send was attempted, for the parts that count against the cap and the gap. */
export function attemptTime(state: PartState): Instant | null {
  switch (state.kind) {
    case "SENDING":
    case "UNKNOWN":
      return state.attemptAt;
    case "SENT":
      return state.at;
    default:
      return null;
  }
}
