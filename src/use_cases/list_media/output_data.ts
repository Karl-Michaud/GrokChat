import type { StagedMedia } from "../../entities/content/staged_media";
import type { AccountId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";
import type { Refusal } from "../access/refusal";

/** One staged item as listed: whether a live post holds it, and when the cleanup deletes it. */
export interface MediaListing {
  readonly media: StagedMedia;
  readonly used: boolean;
  /** Null while a waiting or publishing post holds it. */
  readonly expiresAt: Instant | null;
}

export type ListMediaOutputData =
  | {
      readonly ok: true;
      readonly accountId: AccountId;
      readonly items: readonly MediaListing[];
    }
  | Refusal<"not_found" | "scope">;
