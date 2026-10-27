import type { Account } from "../../entities/accounts/account";
import { accountId, postId } from "../../entities/identity/ids";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import { DAY, type Instant } from "../../entities/time/instant";
import type { GetPostMetricsOutputData } from "../../use_cases/get_post_metrics/output_data";
import type { Clock } from "../../use_cases/ports/clock";
import type { PostView } from "../../use_cases/views/post_view";
import { accountOptions, loadAccounts, type AccountOption } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { filled, formatUtcDate, parseUtcDate, startOfUtcDay } from "./form_values";
import { invalid, page, refused, type Outcome } from "./outcome";
import {
  postDetail,
  postRow,
  STATUS_OPTIONS,
  type PostDetailView,
  type PostRow,
} from "./post_views";
import { runUseCase } from "./presenter";
import type { PostPageUseCases } from "./use_cases";

export interface StatusOption {
  readonly value: DerivedStatus;
  readonly selected: boolean;
}

export interface BacklogView {
  readonly accounts: readonly AccountOption[];
  readonly statuses: readonly StatusOption[];
  readonly rows: readonly PostRow[];
}

export interface CalendarDay {
  readonly date: string;
  readonly weekday: string;
  readonly posts: readonly PostRow[];
}

export interface CalendarView {
  readonly start: string;
  readonly previous: string;
  readonly next: string;
  readonly days: readonly CalendarDay[];
}

const CALENDAR_DAYS = 7;

type Posts =
  | { readonly ok: true; readonly posts: readonly PostView[] }
  | { readonly ok: false; readonly code: string };

function calendarDays(start: Instant, posts: readonly PostView[], accounts: readonly Account[]) {
  return Array.from({ length: CALENDAR_DAYS }, (_, offset): CalendarDay => {
    const day = start + offset * DAY;
    return {
      date: formatUtcDate(day),
      weekday: new Date(day).toUTCString().slice(0, 3),
      posts: posts
        .filter((post) => post.publishAt >= day && post.publishAt < day + DAY)
        .map((post) => postRow(post, accounts)),
    };
  });
}

/** The read pages about posts: backlog, calendar, post detail (plan §3.4). */
export class PostPagesController {
  constructor(
    private readonly useCases: PostPageUseCases,
    private readonly clock: Clock,
  ) {}

  async backlog(query: {
    readonly account: string | null;
    readonly status: string | null;
  }): Promise<Outcome<BacklogView>> {
    const account = filled(query.account);
    const status = filled(query.status);
    const selected = STATUS_OPTIONS.find((option) => option === status);
    if (status !== null && selected === undefined) {
      return invalid("Unknown status.");
    }
    const accounts = await loadAccounts(this.useCases);
    const input = {
      actor: ADMIN,
      // Stryker disable next-line ConditionalExpression: the id brands are identity casts, so null maps to null either way.
      accountId: account === null ? null : accountId(account),
      statuses: selected === undefined ? null : [selected],
      window: null,
    };
    const result: Posts = await runUseCase(this.useCases.listBacklog, input, (output) => output);
    if (!result.ok) {
      return refused(result.code);
    }
    return page({
      accounts: accountOptions(accounts, account),
      statuses: STATUS_OPTIONS.map((value) => ({ value, selected: value === selected })),
      rows: result.posts.map((post) => postRow(post, accounts)),
    });
  }

  async calendar(query: { readonly start: string | null }): Promise<Outcome<CalendarView>> {
    const text = filled(query.start);
    const given = text === null ? null : parseUtcDate(text);
    if (text !== null && given === null) {
      return invalid("The start must be a date, YYYY-MM-DD.");
    }
    const start = given ?? startOfUtcDay(this.clock.now());
    const window = { from: start, to: start + CALENDAR_DAYS * DAY };
    const accounts = await loadAccounts(this.useCases);
    const result: Posts = await runUseCase(
      this.useCases.getCalendar,
      { actor: ADMIN, window },
      (output) => output,
    );
    if (!result.ok) {
      return refused(result.code);
    }
    return page({
      start: formatUtcDate(start),
      previous: formatUtcDate(start - CALENDAR_DAYS * DAY),
      next: formatUtcDate(window.to),
      days: calendarDays(start, result.posts, accounts),
    });
  }

  async detail(id: string): Promise<Outcome<PostDetailView>> {
    const input = { actor: ADMIN, postId: postId(id) };
    const post = await runUseCase(this.useCases.getPost, input, (output) => output);
    if (!post.ok) {
      return refused(post.code);
    }
    const metrics = await runUseCase(
      this.useCases.getPostMetrics,
      input,
      (output: GetPostMetricsOutputData) => (output.ok ? output.parts : []),
    );
    const accounts = await loadAccounts(this.useCases);
    return page(postDetail(post.post, accounts, metrics));
  }
}
