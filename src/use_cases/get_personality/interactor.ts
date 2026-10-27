import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { PersonalityRepository } from "../ports/personality_repository";
import type { GetPersonalityInputBoundary } from "./input_boundary";
import type { GetPersonalityInputData } from "./input_data";
import type { GetPersonalityOutputBoundary } from "./output_boundary";
import type { GetPersonalityOutputData } from "./output_data";

/** The voice a bot writes in for an account (rev 4 M12). */
export class GetPersonalityInteractor implements GetPersonalityInputBoundary {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly personalities: PersonalityRepository,
    private readonly guard: AccessGuard,
    private readonly presenter: GetPersonalityOutputBoundary,
  ) {}

  async execute(input: GetPersonalityInputData): Promise<void> {
    this.presenter.present(await this.find(input));
  }

  private async find(input: GetPersonalityInputData): Promise<GetPersonalityOutputData> {
    const account = await this.accounts.get(input.accountId);
    if (account === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "personality.get",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.guard.inScope(action))) {
      return refusal("scope");
    }
    const personality = await this.personalities.get(account.personalityId);
    return personality === null ? refusal("personality_not_found") : { ok: true, personality };
  }
}
