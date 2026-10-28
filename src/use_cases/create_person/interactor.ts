import { personId } from "../../entities/identity/ids";
import { personName } from "../../entities/people/person";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id_generator";
import type { PersonRepository } from "../ports/person_repository";
import type { CreatePersonInputBoundary } from "./input_boundary";
import type { CreatePersonInputData } from "./input_data";
import type { CreatePersonOutputBoundary } from "./output_boundary";

export interface CreatePersonPorts {
  readonly people: PersonRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
}

/** A person with no token and no account yet; names are unique, ignoring ASCII case. */
export class CreatePersonInteractor implements CreatePersonInputBoundary {
  constructor(
    private readonly ports: CreatePersonPorts,
    private readonly presenter: CreatePersonOutputBoundary,
  ) {}

  async execute(input: CreatePersonInputData): Promise<void> {
    const action = { actor: input.actor, action: "person.create", accountId: null, postId: null };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const name = personName(input.name);
    if (name === null) {
      this.presenter.present(refusal("invalid_name"));
      return;
    }
    if ((await this.ports.people.findByName(name)) !== null) {
      this.presenter.present(refusal("name_taken"));
      return;
    }
    const person = {
      id: personId(this.ports.ids.newId()),
      name,
      createdAt: this.ports.clock.now(),
      token: null,
    };
    await this.ports.people.save(person);
    await this.ports.audit.done(action, `person ${person.id}`);
    this.presenter.present({ ok: true, person });
  }
}
