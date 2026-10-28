import type { Account } from "../../entities/accounts/account";
import type { Person } from "../../entities/people/person";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit, AuditedAction } from "../access/action_audit";
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
    const current = person.token?.createdAt ?? null;
    if (input.expected?.createdAt !== current) {
      await this.stale(action, person);
      return;
    }
    const issued = await this.ports.issuer.issue();
    // Strictly later than the token it replaces, so the form's nonce is never reused.
    const createdAt = Math.max(this.ports.clock.now(), (current ?? 0) + 1);
    const token = { sha256: issued.sha256, createdAt };
    if (!(await this.ports.people.replaceToken(person.id, current, token))) {
      await this.stale(action, person);
      return;
    }
    const rotated = person.token !== null;
    const updated = { ...person, token };
    await this.ports.audit.done(action, `person ${person.id} ${rotated ? "rotated" : "generated"}`);
    this.presenter.present({
      ok: true,
      person: updated,
      token: issued.token,
      rotated,
      accounts: await this.accountsOf(updated.id),
    });
  }

  /**
   * The form named a token the person no longer has (a reload re-sent it, or a concurrent request
   * just rotated it): nothing changes, and the panel shows the person as stored now.
   */
  private async stale(action: AuditedAction, person: Person): Promise<void> {
    await this.ports.audit.refused(action, "token_already_issued");
    const latest = (await this.ports.people.get(person.id)) ?? person;
    this.presenter.present({ ...refusal("token_already_issued"), person: latest });
  }

  private async accountsOf(person: IssuePersonTokenInputData["personId"]): Promise<Account[]> {
    const ids = await this.ports.owners.accountsOf(person);
    const accounts = await Promise.all(ids.map((id) => this.ports.accounts.get(id)));
    return accounts.filter((account): account is Account => account !== null);
  }
}
