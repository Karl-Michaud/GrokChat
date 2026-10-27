import type { MediaUsage } from "../../entities/media/r2_quota";
import type { Refusal } from "../access/refusal";

export interface R2Limits {
  readonly storedBytes: number;
  readonly classA: number;
  readonly classB: number;
}

/** This month's R2 use against the guards and the free allowance (plan §3.5). */
export type GetMediaUsageOutputData =
  | {
      readonly ok: true;
      readonly usage: MediaUsage;
      readonly guards: R2Limits;
      readonly allowance: R2Limits;
    }
  | Refusal<"human_only">;
