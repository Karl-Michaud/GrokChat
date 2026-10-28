import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";

/** `unused`: only media no live post holds, ready for a new post. */
export type MediaStatusFilter = "unused" | "all";

export interface ListMediaInputData {
  readonly actor: Actor;
  readonly accountId: AccountId;
  readonly status: MediaStatusFilter;
  /** 1 to `MAX_MEDIA_LIST`. */
  readonly limit: number;
}
