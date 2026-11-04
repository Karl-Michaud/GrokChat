import { refusal } from "../access/refusal";
import type { AccountCommand } from "../admin/account_command";
import type { SetAccountStatusInputBoundary } from "./input_boundary";
import type { SetAccountStatusInputData } from "./input_data";
import type { SetAccountStatusOutputBoundary } from "./output_boundary";

/**
 * The kill switch (plan §3.3 #10): PAUSED stops the account by the next tick, since every part
 * passes the gate. A DISCONNECTED or NEEDS_RECONNECT account can only be reconnected (A2).
 */
export class SetAccountStatusInteractor implements SetAccountStatusInputBoundary {
  constructor(
    private readonly command: AccountCommand,
    private readonly presenter: SetAccountStatusOutputBoundary,
  ) {}

  async execute(input: SetAccountStatusInputData): Promise<void> {
    const result = await this.command.run<"needs_reconnect">({
      actor: input.actor,
      accountId: input.accountId,
      action: `account.${input.status.toLowerCase()}`,
      change: (account) =>
        account.status === "ACTIVE" || account.status === "PAUSED"
          ? { ...account, status: input.status }
          : refusal("needs_reconnect"),
    });
    this.presenter.present(result);
  }
}
