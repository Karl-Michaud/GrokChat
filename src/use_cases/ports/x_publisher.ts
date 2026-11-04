import type { AccountId, XMediaId, XPostId } from "../../entities/identity/ids";
import type { XResult } from "../../entities/x/x_failure";

/** Takes an account, never a token: the driver gets the token inside the account's DO (rev 4 M6). */
export interface XPublisher {
  create(
    account: AccountId,
    text: string,
    media: readonly XMediaId[],
    inReplyTo: XPostId | null,
  ): Promise<XResult<XPostId>>;
  delete(account: AccountId, xPost: XPostId): Promise<XResult<null>>;
}
