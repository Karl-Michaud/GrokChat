import { personName } from "../../entities/people/person";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { PersonRepository } from "../ports/person_repository";
import type { RenamePersonInputBoundary } from "./input_boundary";
import type { RenamePersonInputData } from "./input_data";
import type { RenamePersonOutputBoundary } from "./output_boundary";

export interface RenamePersonPorts {
  readonly people: PersonRepository;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/** Renames a person; the token, the accounts and the audit actor (`bot:<id>`) stay. */
export class RenamePersonInteractor implements RenamePersonInputBoundary {
  constructor(
    private readonly ports: RenamePersonPorts,
    private readonly presenter: RenamePersonOutputBoundary,
  ) {}

  async execute(input: RenamePersonInputData): Promise<void> {
    const action = { actor: input.actor, action: "person.rename", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const person = await this.ports.people.get(input.personId);
    if (person === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const name = personName(input.name);
    if (name === null) {
      this.presenter.present(refusal("invalid_name"));
      return;
    }
    const holder = await this.ports.people.findByName(name);
    if (holder !== null && holder.id !== person.id) {
      this.presenter.present(refusal("name_taken"));
      return;
    }
    const renamed = { ...person, name };
    await this.ports.people.save(renamed);
    await this.ports.audit.done(action, `person ${person.id}`);
    this.presenter.present({ ok: true, person: renamed });
  }
}
