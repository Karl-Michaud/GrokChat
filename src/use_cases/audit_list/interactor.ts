import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AuditLog } from "../ports/audit_log";
import type { AuditListInputBoundary } from "./input_boundary";
import type { AuditListInputData } from "./input_data";
import type { AuditListOutputBoundary } from "./output_boundary";

export class AuditListInteractor implements AuditListInputBoundary {
  constructor(
    private readonly log: AuditLog,
    private readonly guard: AccessGuard,
    private readonly presenter: AuditListOutputBoundary,
  ) {}

  async execute(input: AuditListInputData): Promise<void> {
    const action = { actor: input.actor, action: "audit.list", accountId: null, postId: null };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    this.presenter.present({ ok: true, events: await this.log.list(input.filter) });
  }
}
