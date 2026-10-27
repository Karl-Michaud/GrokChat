import type { SystemActor } from "../../entities/identity/actor";

/** What the three tick use cases share: they run as the system, with no other input (plan §3). */
export interface TickInputBoundary {
  execute(input: { readonly actor: SystemActor }): Promise<void>;
}

/**
 * Framework-free: `scheduled()` calls this for one cron job. The job's name is the system actor
 * the tick runs and audits as (`system:<job>`).
 */
export class TickController {
  constructor(
    private readonly job: string,
    private readonly useCase: TickInputBoundary,
  ) {}

  run(): Promise<void> {
    return this.useCase.execute({ actor: { kind: "system", job: this.job } });
  }
}
