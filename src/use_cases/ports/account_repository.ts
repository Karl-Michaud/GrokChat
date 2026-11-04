import type { Account } from "../../entities/accounts/account";
import type { AccountId, XUserId } from "../../entities/identity/ids";

export interface AccountRepository {
  get(id: AccountId): Promise<Account | null>;
  findByXUserId(xUser: XUserId): Promise<Account | null>;
  list(): Promise<readonly Account[]>;
  save(account: Account): Promise<void>;
}
