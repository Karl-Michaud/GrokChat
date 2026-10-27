import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { GetCalendarInputBoundary } from "./input_boundary";
import type { GetCalendarInputData } from "./input_data";
import type { GetCalendarOutputBoundary } from "./output_boundary";

export class GetCalendarInteractor implements GetCalendarInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly guard: AccessGuard,
    private readonly presenter: GetCalendarOutputBoundary,
  ) {}

  async execute(input: GetCalendarInputData): Promise<void> {
    const action = { actor: input.actor, action: "calendar.get", accountId: null, postId: null };
    if (!(await this.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const posts = await this.reader.list({ publishWindow: input.window });
    this.presenter.present({ ok: true, posts: posts.map(toPostView) });
  }
}
