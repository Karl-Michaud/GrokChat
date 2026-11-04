import type { Actor } from "../../entities/identity/actor";
import type { AccountId } from "../../entities/identity/ids";
import { derivedStatus } from "../../entities/posts/derived_status";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { PostFilter, PostReader } from "../ports/post_reader";
import { toPostView } from "../views/post_view";
import type { ListBacklogInputBoundary } from "./input_boundary";
import type { ListBacklogInputData } from "./input_data";
import type { ListBacklogOutputBoundary } from "./output_boundary";

/** The accounts a listing covers: the one asked for, or a bot's whole scope; null for everything. */
function accountsFor(actor: Actor, account: AccountId | null): readonly AccountId[] | null {
  if (account !== null) {
    return [account];
  }
  return actor.kind === "bot" ? actor.scope.accountIds : null;
}

export class ListBacklogInteractor implements ListBacklogInputBoundary {
  constructor(
    private readonly reader: PostReader,
    private readonly guard: AccessGuard,
    private readonly presenter: ListBacklogOutputBoundary,
  ) {}

  async execute(input: ListBacklogInputData): Promise<void> {
    if (input.accountId !== null) {
      const action = {
        actor: input.actor,
        action: "post.list",
        accountId: input.accountId,
        postId: null,
      };
      if (!(await this.guard.inScope(action))) {
        this.presenter.present(refusal("scope"));
        return;
      }
    }
    const accounts = accountsFor(input.actor, input.accountId);
    const filter: PostFilter = {
      ...(accounts === null ? {} : { accountIds: accounts }),
      ...(input.window === null ? {} : { publishWindow: input.window }),
    };
    const statuses = input.statuses;
    const posts = (await this.reader.list(filter)).filter(
      (post) => statuses === null || statuses.includes(derivedStatus(post)),
    );
    this.presenter.present({ ok: true, posts: posts.map(toPostView) });
  }
}
