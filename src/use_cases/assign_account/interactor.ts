import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { AccountOwners } from "../ports/account_owners";
import type { AccountRepository } from "../ports/account_repository";
import type { PersonRepository } from "../ports/person_repository";
import type { AssignAccountInputBoundary } from "./input_boundary";
import type { AssignAccountInputData } from "./input_data";
import type { AssignAccountOutputBoundary } from "./output_boundary";

export interface AssignAccountPorts {
  readonly accounts: AccountRepository;
  readonly people: PersonRepository;
  readonly owners: AccountOwners;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/**
 * Moves an account to a person, or to nobody. Bot auth reads the assignment per request, so the
 * person's token reaches the account (or stops reaching it) from the next call, with no reissue.
 */
export class AssignAccountInteractor implements AssignAccountInputBoundary {
  constructor(
    private readonly ports: AssignAccountPorts,
    private readonly presenter: AssignAccountOutputBoundary,
  ) {}

  async execute(input: AssignAccountInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "person.assign",
      accountId: input.accountId,
      postId: null,
    };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    if ((await this.ports.accounts.get(input.accountId)) === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    if (input.personId !== null && (await this.ports.people.get(input.personId)) === null) {
      this.presenter.present(refusal("person_not_found"));
      return;
    }
    await this.ports.owners.assign(input.accountId, input.personId);
    const detail = input.personId === null ? "unassigned" : `person ${input.personId}`;
    await this.ports.audit.done(action, detail);
    this.presenter.present({ ok: true });
  }
}
