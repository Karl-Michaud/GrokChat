import type { AccountCommand } from "../admin/account_command";
import type { ConfirmDisclosureInputBoundary } from "./input_boundary";
import type { ConfirmDisclosureInputData } from "./input_data";
import type { ConfirmDisclosureOutputBoundary } from "./output_boundary";

/** The owner confirms the bio says MuseChat runs the account and X's automated label is on (§0). */
export class ConfirmDisclosureInteractor implements ConfirmDisclosureInputBoundary {
  constructor(
    private readonly command: AccountCommand,
    private readonly presenter: ConfirmDisclosureOutputBoundary,
  ) {}

  async execute(input: ConfirmDisclosureInputData): Promise<void> {
    const disclosure = {
      bioConfirmed: input.bioConfirmed,
      automatedLabelConfirmed: input.automatedLabelConfirmed,
    };
    const result = await this.command.run({
      actor: input.actor,
      accountId: input.accountId,
      action: "account.disclosure",
      change: (account) => ({ ...account, disclosure }),
    });
    this.presenter.present(result);
  }
}
