import type { Actor } from "../../entities/identity/actor";
import type { TimeWindow } from "../../entities/time/instant";

export interface GetCalendarInputData {
  readonly actor: Actor;
  readonly window: TimeWindow;
}
