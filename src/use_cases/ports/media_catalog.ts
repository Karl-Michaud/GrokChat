import type { StagedMedia } from "../../entities/content/staged_media";
import type { AccountId } from "../../entities/identity/ids";

/** An account's staged media for `list_media` and the dashboard's Media page (GROKCHAT-18). */
export interface MediaCatalog {
  /** At most `limit` of the account's items, newest staged first, then by id (descending). */
  recent(account: AccountId, limit: number): Promise<readonly StagedMedia[]>;
}
