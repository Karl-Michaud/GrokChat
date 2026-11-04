import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { ListAccountsInputBoundary } from "./input_boundary";
import type { ListAccountsInputData } from "./input_data";
import type { ListAccountsOutputBoundary } from "./output_boundary";

export class ListAccountsInteractor implements ListAccountsInputBoundary {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: ListAccountsOutputBoundary,
  ) {}

  async execute(input: ListAccountsInputData): Promise<void> {
    const action = { actor: input.actor, action: "account.list", accountId: null, postId: null };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    this.presenter.present({ ok: true, accounts: await this.accounts.list() });
  }
}
