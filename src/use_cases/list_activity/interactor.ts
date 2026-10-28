import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { ActivityLog } from "../ports/activity_log";
import type { ListActivityInputBoundary } from "./input_boundary";
import type { ListActivityInputData } from "./input_data";
import type { ListActivityOutputBoundary } from "./output_boundary";

/** The history of requests (GROKCHAT-15): the audit log, newest first, a page at a time. */
export class ListActivityInteractor implements ListActivityInputBoundary {
  constructor(
    private readonly log: ActivityLog,
    private readonly guard: AccessGuard,
    private readonly presenter: ListActivityOutputBoundary,
  ) {}

  async execute(input: ListActivityInputData): Promise<void> {
    const action = { actor: input.actor, action: "activity.list", accountId: null, postId: null };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const size = input.pageSize;
    const page = Math.max(1, input.page);
    const found = await this.log.page(input.filter, (page - 1) * size, size);
    const pages = Math.max(1, Math.ceil(found.total / size));
    this.presenter.present({ ok: true, entries: found.entries, total: found.total, page, pages });
  }
}
