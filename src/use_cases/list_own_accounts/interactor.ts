import { authorize } from "../../entities/identity/actor";
import type { AccountRepository } from "../ports/account_repository";
import type { ListOwnAccountsInputBoundary } from "./input_boundary";
import type { ListOwnAccountsInputData } from "./input_data";
import type { ListOwnAccountsOutputBoundary } from "./output_boundary";

/**
 * `list_accounts` (GROKCHAT-16): a bot discovers its accounts, so its setup never depends on ids
 * pasted by hand, and an account assigned to its person later shows up on the next call.
 */
export class ListOwnAccountsInteractor implements ListOwnAccountsInputBoundary {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly presenter: ListOwnAccountsOutputBoundary,
  ) {}

  async execute(input: ListOwnAccountsInputData): Promise<void> {
    const all = await this.accounts.list();
    this.presenter.present({
      ok: true,
      accounts: all.filter((account) => authorize(input.actor, account.id).allowed),
    });
  }
}
