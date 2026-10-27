import type { AuditListOutputData } from "./output_data";

/** Implemented by a presenter in interface_adapters. */
export interface AuditListOutputBoundary {
  present(output: AuditListOutputData): void;
}
