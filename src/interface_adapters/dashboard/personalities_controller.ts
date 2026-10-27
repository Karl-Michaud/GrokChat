import type { Personality } from "../../entities/content/personality";
import { personalityId } from "../../entities/identity/ids";
import { ADMIN } from "./admin_actor";
import { filled, parseLines } from "./form_values";
import { page, redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import type { PersonalityUseCases } from "./use_cases";

/** A personality as its form shows it: lists one entry per line. */
export interface PersonalityForm {
  readonly id: string;
  readonly name: string;
  readonly voiceGuide: string;
  readonly topics: string;
  readonly dos: string;
  readonly donts: string;
  readonly examples: string;
}

export interface PersonalityRowView extends PersonalityForm {
  readonly version: number;
}

export interface PersonalitiesView {
  readonly personalities: readonly PersonalityRowView[];
}

export const PERSONALITIES_PAGE = "/dashboard/personalities";

function row(personality: Personality): PersonalityRowView {
  return {
    id: personality.id,
    name: personality.name,
    voiceGuide: personality.voiceGuide,
    topics: personality.topics.join("\n"),
    dos: personality.dos.join("\n"),
    donts: personality.donts.join("\n"),
    examples: personality.examples.join("\n"),
    version: personality.version,
  };
}

/** The personalities page: list, create, edit (plan §3.4). */
export class PersonalitiesController {
  constructor(private readonly useCases: PersonalityUseCases) {}

  personalities(): Promise<Outcome<PersonalitiesView>> {
    return runUseCase(this.useCases.listPersonalities, { actor: ADMIN }, (output) =>
      output.ok ? page({ personalities: output.personalities.map(row) }) : refused(output.code),
    );
  }

  save(form: PersonalityForm): Promise<Outcome<never>> {
    const id = filled(form.id);
    const input = {
      actor: ADMIN,
      // Stryker disable next-line ConditionalExpression: the id brands are identity casts, so null maps to null either way.
      id: id === null ? null : personalityId(id),
      name: form.name.trim(),
      voiceGuide: form.voiceGuide.trim(),
      topics: parseLines(form.topics),
      dos: parseLines(form.dos),
      donts: parseLines(form.donts),
      examples: parseLines(form.examples),
    };
    return runUseCase(this.useCases.savePersonality, input, (output) =>
      output.ok ? redirect(PERSONALITIES_PAGE) : refused(output.code),
    );
  }
}
