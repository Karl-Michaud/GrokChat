import { personalityId, type PersonalityId } from "../../entities/identity/ids";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit, AuditedAction } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { IdGenerator } from "../ports/id_generator";
import type { PersonalityRepository } from "../ports/personality_repository";
import type { SavePersonalityInputBoundary } from "./input_boundary";
import type { SavePersonalityInputData } from "./input_data";
import type { SavePersonalityOutputBoundary } from "./output_boundary";
import type { SavePersonalityOutputData } from "./output_data";

/** Every save is a new version; posts record the version they were written under (provenance). */
export class SavePersonalityInteractor implements SavePersonalityInputBoundary {
  constructor(
    private readonly personalities: PersonalityRepository,
    private readonly ids: IdGenerator,
    private readonly guard: AccessGuard,
    private readonly audit: ActionAudit,
    private readonly presenter: SavePersonalityOutputBoundary,
  ) {}

  async execute(input: SavePersonalityInputData): Promise<void> {
    this.presenter.present(await this.save(input));
  }

  private async save(input: SavePersonalityInputData): Promise<SavePersonalityOutputData> {
    const action = {
      actor: input.actor,
      action: "personality.save",
      accountId: null,
      postId: null,
    };
    if (!(await this.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    if (input.name.trim().length === 0) {
      return refusal("name_required");
    }
    if (input.id === null) {
      return this.store(input, personalityId(this.ids.newId()), 1, action);
    }
    const existing = await this.personalities.get(input.id);
    if (existing === null) {
      return refusal("not_found");
    }
    return this.store(input, existing.id, existing.version + 1, action);
  }

  private async store(
    input: SavePersonalityInputData,
    id: PersonalityId,
    version: number,
    action: AuditedAction,
  ): Promise<SavePersonalityOutputData> {
    const { name, voiceGuide, topics, dos, donts, examples } = input;
    const personality = { id, name, voiceGuide, topics, dos, donts, examples, version };
    await this.personalities.save(personality);
    await this.audit.done(action, `${personality.id} v${String(personality.version)}`);
    return { ok: true, personality };
  }
}
