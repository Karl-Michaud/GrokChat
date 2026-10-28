import type { Account } from "../../entities/accounts/account";
import {
  POST_SORT_KEYS,
  type PostSortKey,
  type SortDirection,
} from "../../entities/analytics/post_sort";
import { accountId, postId } from "../../entities/identity/ids";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import { DAY, type TimeWindow } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import { accountOptions, loadAccounts, type AccountOption } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { postStatusChip, type Chip } from "./chips";
import { exact } from "./format";
import { filled, parseUtcDate } from "./form_values";
import { href } from "./links";
import { invalid, page, refused, type Outcome } from "./outcome";
import {
  postListRow,
  sortColumns,
  STATUS_OPTIONS,
  type PostListRow,
  type SortColumn,
} from "./post_list_views";
import { postDetail, type PostDetailView } from "./post_views";
import { runUseCase } from "./presenter";
import { oneOf, optional, pageNumber } from "./query";
import type { PostPageUseCases } from "./use_cases";

export const POSTS_PAGE = "/dashboard/posts";
export const PAGE_SIZE = 25;

export interface PostsQuery {
  readonly account: string | null;
  readonly status: string | null;
  /** `YYYY-MM-DD`, UTC, both days included. */
  readonly from: string | null;
  readonly to: string | null;
  readonly sort: string | null;
  readonly dir: string | null;
  readonly page: string | null;
}

export interface StatusOption extends Chip {
  readonly value: DerivedStatus;
  readonly selected: boolean;
}

export interface PostsView {
  readonly accounts: readonly AccountOption[];
  readonly statuses: readonly StatusOption[];
  readonly from: string;
  readonly to: string;
  readonly filtered: boolean;
  readonly clearHref: string;
  readonly columns: readonly SortColumn[];
  readonly rows: readonly PostListRow[];
  readonly total: string;
  readonly page: number;
  readonly pages: number;
  readonly previous: string | null;
  readonly next: string | null;
}

const DIRECTIONS: readonly SortDirection[] = ["desc", "asc"];

interface Filters {
  readonly account: string | null;
  readonly status: DerivedStatus | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly window: TimeWindow | null;
  readonly sort: PostSortKey;
  readonly dir: SortDirection;
}

/** The two dates as a window, from the start of `from` to the end of `to`; either may be open. */
function dateWindow(from: string | null, to: string | null): TimeWindow | "invalid" | null {
  const start = from === null ? null : parseUtcDate(from);
  const end = to === null ? null : parseUtcDate(to);
  if ((from !== null && start === null) || (to !== null && end === null)) {
    return "invalid";
  }
  if (start === null && end === null) {
    return null;
  }
  return { from: start ?? 0, to: end === null ? Number.MAX_SAFE_INTEGER : end + DAY };
}

function filters(query: PostsQuery): Filters | string {
  const status = optional(query.status, STATUS_OPTIONS);
  const sort = oneOf(query.sort, POST_SORT_KEYS, "time");
  const dir = oneOf(query.dir, DIRECTIONS, "desc");
  const from = filled(query.from);
  const to = filled(query.to);
  const window = dateWindow(from, to);
  if (status === "invalid" || sort === null || dir === null) {
    return "Unknown status or sort.";
  }
  if (window === "invalid") {
    return "Dates must be YYYY-MM-DD.";
  }
  const account = filled(query.account);
  return { account, status, from, to, window, sort, dir };
}

function link(chosen: Filters, changes: Partial<Record<"sort" | "dir" | "page", string>>): string {
  return href(POSTS_PAGE, {
    account: chosen.account,
    status: chosen.status,
    from: chosen.from,
    to: chosen.to,
    sort: changes.sort ?? chosen.sort,
    dir: changes.dir ?? chosen.dir,
    page: changes.page ?? null,
  });
}

/** The posts page and a post's page (GROKCHAT-15). */
export class PostsController {
  constructor(
    private readonly useCases: PostPageUseCases,
    private readonly clock: Clock,
  ) {}

  async posts(query: PostsQuery): Promise<Outcome<PostsView>> {
    const chosen = filters(query);
    const pageAsked = pageNumber(query.page);
    if (typeof chosen === "string" || pageAsked === null) {
      return invalid(typeof chosen === "string" ? chosen : "Unknown page.");
    }
    const input = {
      actor: ADMIN,
      // Stryker disable next-line ConditionalExpression: the id brands are identity casts, so null maps to null either way.
      accountId: chosen.account === null ? null : accountId(chosen.account),
      statuses: chosen.status === null ? null : [chosen.status],
      window: chosen.window,
      sort: chosen.sort,
      direction: chosen.dir,
      page: pageAsked,
      pageSize: PAGE_SIZE,
    };
    const result = await runUseCase(this.useCases.listPosts, input, (output) => output);
    if (!result.ok) {
      return refused(result.code);
    }
    const accounts = await loadAccounts(this.useCases);
    const now = this.clock.now();
    return page({
      ...this.filtersView(chosen, accounts),
      columns: sortColumns(POST_SORT_KEYS, chosen.sort, chosen.dir, (sort, dir) =>
        link(chosen, { sort, dir }),
      ),
      rows: result.rows.map((row) => postListRow(row, accounts, now)),
      total: exact(result.total),
      page: result.page,
      pages: result.pages,
      previous: result.page > 1 ? link(chosen, { page: String(result.page - 1) }) : null,
      next: result.page < result.pages ? link(chosen, { page: String(result.page + 1) }) : null,
    });
  }

  async detail(id: string): Promise<Outcome<PostDetailView>> {
    const found = await runUseCase(
      this.useCases.insights,
      { actor: ADMIN, postId: postId(id) },
      (output) => output,
    );
    if (!found.ok) {
      return refused(found.code);
    }
    const accounts = await loadAccounts(this.useCases);
    return page(postDetail(found, accounts, this.clock.now()));
  }

  private filtersView(chosen: Filters, accounts: readonly Account[]) {
    return {
      accounts: accountOptions(accounts, chosen.account),
      statuses: STATUS_OPTIONS.map((value) => ({
        value,
        ...postStatusChip(value),
        selected: value === chosen.status,
      })),
      from: chosen.from ?? "",
      to: chosen.to ?? "",
      filtered: chosen.account !== null || chosen.status !== null || chosen.window !== null,
      clearHref: POSTS_PAGE,
    };
  }
}
