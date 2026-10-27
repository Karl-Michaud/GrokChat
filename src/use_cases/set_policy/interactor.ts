import { validatePolicy, type PolicyRefusal } from "../../entities/accounts/posting_policy";
import { refusal } from "../access/refusal";
import type { AccountCommand } from "../admin/account_command";
import type { SetPolicyInputBoundary } from "./input_boundary";
import type { SetPolicyInputData } from "./input_data";
import type { SetPolicyOutputBoundary } from "./output_boundary";

export class SetPolicyInteractor implements SetPolicyInputBoundary {
  constructor(
    private readonly command: AccountCommand,
    private readonly presenter: SetPolicyOutputBoundary,
  ) {}

  async execute(input: SetPolicyInputData): Promise<void> {
    const result = await this.command.run<PolicyRefusal>({
      actor: input.actor,
      accountId: input.accountId,
      action: "account.policy",
      change: (account) => {
        const valid = validatePolicy(input.policy);
        return valid.allowed ? { ...account, policy: input.policy } : refusal(valid.reason);
      },
    });
    this.presenter.present(result);
  }
}
