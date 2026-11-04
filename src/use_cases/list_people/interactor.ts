import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountOwners } from "../ports/account_owners";
import type { PersonRepository } from "../ports/person_repository";
import type { ListPeopleInputBoundary } from "./input_boundary";
import type { ListPeopleInputData } from "./input_data";
import type { ListPeopleOutputBoundary } from "./output_boundary";

export interface ListPeoplePorts {
  readonly people: PersonRepository;
  readonly owners: AccountOwners;
  readonly guard: AccessGuard;
}

/** The people and their accounts, for the dashboard's accounts page (human only). */
export class ListPeopleInteractor implements ListPeopleInputBoundary {
  constructor(
    private readonly ports: ListPeoplePorts,
    private readonly presenter: ListPeopleOutputBoundary,
  ) {}

  async execute(input: ListPeopleInputData): Promise<void> {
    const action = { actor: input.actor, action: "person.list", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const people = await this.ports.people.list();
    const owners = await this.ports.owners.list();
    this.presenter.present({
      ok: true,
      people: people.map((person) => ({
        person,
        accountIds: owners
          .filter((owner) => owner.personId === person.id)
          .map((owner) => owner.accountId),
      })),
    });
  }
}
