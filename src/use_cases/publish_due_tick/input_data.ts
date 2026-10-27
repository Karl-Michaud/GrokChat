import type { SystemActor } from "../../entities/identity/actor";

/** Cron Triggers call `scheduled()` directly; the tick runs as the system (plan §3). */
export interface PublishDueTickInputData {
  readonly actor: SystemActor;
}
