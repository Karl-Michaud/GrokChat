import { personName, sameName } from "../../entities/people/person";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { PersonRepository } from "../ports/person_repository";
import type { DeletePersonInputBoundary } from "./input_boundary";
import type { DeletePersonInputData } from "./input_data";
import type { DeletePersonOutputBoundary } from "./output_boundary";

export interface DeletePersonPorts {
  readonly people: PersonRepository;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/**
 * Deletes a person once their name is typed again: their accounts become unassigned and their
 * token stops working at once (the repository removes both in one step).
 */
export class DeletePersonInteractor implements DeletePersonInputBoundary {
  constructor(
    private readonly ports: DeletePersonPorts,
    private readonly presenter: DeletePersonOutputBoundary,
  ) {}

  async execute(input: DeletePersonInputData): Promise<void> {
    const action = { actor: input.actor, action: "person.delete", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const person = await this.ports.people.get(input.personId);
    if (person === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const typed = personName(input.confirmation);
    if (typed === null || !sameName(typed, person.name)) {
      this.presenter.present(refusal("name_mismatch"));
      return;
    }
    await this.ports.people.delete(person.id);
    await this.ports.audit.done(action, `person ${person.id}`);
    this.presenter.present({ ok: true, person });
  }
}
