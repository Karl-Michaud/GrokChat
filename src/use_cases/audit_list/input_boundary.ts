import type { AuditListInputData } from "./input_data";

/** What a controller calls. */
export interface AuditListInputBoundary {
  execute(input: AuditListInputData): Promise<void>;
}
