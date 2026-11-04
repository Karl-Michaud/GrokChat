import type { AccountId, XUserId } from "../../entities/identity/ids";
import type { AccountRepository } from "../../use_cases/ports/account_repository";

/** The account's X user id, which `GET /2/users/:id/tweets` needs and the X ports do not carry. */
export interface XUserDirectory {
  xUserIdOf(account: AccountId): Promise<XUserId | null>;
}

/**
 * Reads it from the account row once per instance: an account's X user never changes (a
 * reconnect as another X user is refused, plan §3.3 #10), so the answer is safe to keep.
 */
export class AccountXUserDirectory implements XUserDirectory {
  private readonly known = new Map<AccountId, XUserId>();

  constructor(private readonly accounts: AccountRepository) {}

  async xUserIdOf(account: AccountId): Promise<XUserId | null> {
    const cached = this.known.get(account);
    if (cached !== undefined) {
      return cached;
    }
    const found = await this.accounts.get(account);
    if (found !== null) {
      this.known.set(account, found.xUserId);
    }
    return found?.xUserId ?? null;
  }
}
