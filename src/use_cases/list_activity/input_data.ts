import type { Actor } from "../../entities/identity/actor";
import type { ActivityFilter } from "../ports/activity_log";

export interface ListActivityInputData {
  readonly actor: Actor;
  readonly filter: ActivityFilter;
  /** 1-based. */
  readonly page: number;
  readonly pageSize: number;
}
