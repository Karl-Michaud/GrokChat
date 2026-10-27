import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { GetPolicyInputBoundary } from "./input_boundary";
import type { GetPolicyInputData } from "./input_data";
import type { GetPolicyOutputBoundary } from "./output_boundary";

/** An account's posting policy and status: what a bot checks before writing (rev 4 M12). */
export class GetPolicyInteractor implements GetPolicyInputBoundary {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: GetPolicyOutputBoundary,
  ) {}

  async execute(input: GetPolicyInputData): Promise<void> {
    const account = await this.accounts.get(input.accountId);
    if (account === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const action = {
      actor: input.actor,
      action: "policy.get",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.guard.inScope(action))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const { id, handle, status, disclosure, policy } = account;
    this.presenter.present({ ok: true, accountId: id, handle, status, disclosure, policy });
  }
}
