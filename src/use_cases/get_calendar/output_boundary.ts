import type { GetCalendarOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface GetCalendarOutputBoundary {
  present(output: GetCalendarOutputData): void;
}
