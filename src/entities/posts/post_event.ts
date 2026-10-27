import type { PublishMode } from "../accounts/posting_policy";
import type { XPostId } from "../identity/ids";
import type { Instant, Millis } from "../time/instant";
import type { PostPart } from "./post";

/** Every event of the §3.1.1 transition table. `part` is a 0-based index (k = part + 1). */
export type PostEvent =
  | { readonly kind: "submit"; readonly mode: PublishMode }
  | { readonly kind: "edit"; readonly parts: readonly PostPart[]; readonly publishAt: Instant }
  | { readonly kind: "cancel" }
  | { readonly kind: "approve"; readonly now: Instant }
  | { readonly kind: "reject" }
  | { readonly kind: "start"; readonly now: Instant; readonly grace: Millis }
  | { readonly kind: "miss"; readonly now: Instant; readonly grace: Millis }
  | { readonly kind: "reserve"; readonly part: number; readonly now: Instant }
  | { readonly kind: "defer"; readonly part: number; readonly resumeAt: Instant }
  | {
      readonly kind: "sent";
      readonly part: number;
      readonly xPostId: XPostId;
      readonly now: Instant;
    }
  | { readonly kind: "unknown"; readonly part: number }
  | { readonly kind: "rejected"; readonly part: number; readonly reason: string }
  | { readonly kind: "retry"; readonly part: number; readonly resumeAt: Instant }
  | { readonly kind: "yield"; readonly now: Instant }
  | { readonly kind: "recover"; readonly now: Instant }
  | {
      readonly kind: "reconcileFound";
      readonly part: number;
      readonly xPostId: XPostId;
      readonly now: Instant;
    }
  | { readonly kind: "reconcileNotFound"; readonly part: number }
  | { readonly kind: "resend"; readonly part: number; readonly now: Instant }
  | { readonly kind: "reschedule"; readonly publishAt: Instant }
  | { readonly kind: "deleted"; readonly part: number };

export type PostEventKind = PostEvent["kind"];
