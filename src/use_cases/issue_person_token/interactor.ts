import type { Account } from "../../entities/accounts/account";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { AccountOwners } from "../ports/account_owners";
import type { AccountRepository } from "../ports/account_repository";
import type { BotTokenIssuer } from "../ports/bot_token_issuer";
import type { Clock } from "../ports/clock";
import type { PersonRepository } from "../ports/person_repository";
import type { IssuePersonTokenInputBoundary } from "./input_boundary";
import type { IssuePersonTokenInputData } from "./input_data";
import type { IssuePersonTokenOutputBoundary } from "./output_boundary";

export interface IssuePersonTokenPorts {
  readonly people: PersonRepository;
  readonly owners: AccountOwners;
  readonly accounts: AccountRepository;
  readonly issuer: BotTokenIssuer;
  readonly clock: Clock;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/**
 * Generates a person's token, or rotates it: only the new hash is saved, so the old token stops
 * working on the next request. The audit records that it happened, never the token.
 */
export class IssuePersonTokenInteractor implements IssuePersonTokenInputBoundary {
  constructor(
    private readonly ports: IssuePersonTokenPorts,
    private readonly presenter: IssuePersonTokenOutputBoundary,
  ) {}

  async execute(input: IssuePersonTokenInputData): Promise<void> {
    const action = { actor: input.actor, action: "person.token", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const person = await this.ports.people.get(input.personId);
    if (person === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const issued = await this.ports.issuer.issue();
    const rotated = person.token !== null;
    const updated = {
      ...person,
      token: { sha256: issued.sha256, createdAt: this.ports.clock.now() },
    };
    await this.ports.people.save(updated);
    await this.ports.audit.done(action, `person ${person.id} ${rotated ? "rotated" : "generated"}`);
    this.presenter.present({
      ok: true,
      person: updated,
      token: issued.token,
      rotated,
      accounts: await this.accountsOf(updated.id),
    });
  }

  private async accountsOf(person: IssuePersonTokenInputData["personId"]): Promise<Account[]> {
    const ids = await this.ports.owners.accountsOf(person);
    const accounts = await Promise.all(ids.map((id) => this.ports.accounts.get(id)));
    return accounts.filter((account): account is Account => account !== null);
  }
}
