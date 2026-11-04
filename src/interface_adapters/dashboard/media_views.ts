import type { MediaUsage } from "../../entities/media/r2_quota";
import type { R2Limits } from "../../use_cases/get_media_usage/output_data";
import { meter, type MeterTone } from "./charts";
import { compact } from "./format";

export interface MediaMeter {
  readonly name: string;
  /** "1.2K of 1M" */
  readonly used: string;
  /** Where uploads (or reads) stop, so the free allowance is never passed. */
  readonly guard: string;
  readonly percent: number;
  readonly tone: MeterTone;
}

const GB = 1e9;

const bytes = (value: number): string => `${String(Number((value / GB).toFixed(2)))} GB`;

function row(
  name: string,
  used: number,
  guard: number,
  allowance: number,
  show: (value: number) => string,
): MediaMeter {
  return {
    name,
    used: `${show(used)} of ${show(allowance)}`,
    guard: show(guard),
    ...meter(used, guard, allowance),
  };
}

/** This month's R2 use against the free allowance, with the guard where GrokChat stops. */
export function mediaMeters(
  usage: MediaUsage,
  guards: R2Limits,
  allowance: R2Limits,
): readonly MediaMeter[] {
  return [
    row("Storage", usage.storedBytes, guards.storedBytes, allowance.storedBytes, bytes),
    row("Writes (Class A)", usage.classA, guards.classA, allowance.classA, compact),
    row("Reads (Class B)", usage.classB, guards.classB, allowance.classB, compact),
  ];
}
