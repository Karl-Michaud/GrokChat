import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { PersonalityRepository } from "../ports/personality_repository";
import type { ListPersonalitiesInputBoundary } from "./input_boundary";
import type { ListPersonalitiesInputData } from "./input_data";
import type { ListPersonalitiesOutputBoundary } from "./output_boundary";

export class ListPersonalitiesInteractor implements ListPersonalitiesInputBoundary {
  constructor(
    private readonly personalities: PersonalityRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: ListPersonalitiesOutputBoundary,
  ) {}

  async execute(input: ListPersonalitiesInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "personality.list",
      accountId: null,
      postId: null,
    };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    this.presenter.present({ ok: true, personalities: await this.personalities.list() });
  }
}
