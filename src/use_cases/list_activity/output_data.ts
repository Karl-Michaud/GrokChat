import type { Refusal } from "../access/refusal";
import type { ActivityEntry } from "../ports/activity_log";

/** The activity page (GROKCHAT-15): human only. */
export type ListActivityOutputData =
  | {
      readonly ok: true;
      readonly entries: readonly ActivityEntry[];
      readonly total: number;
      readonly page: number;
      readonly pages: number;
    }
  | Refusal<"human_only">;
