import {
  ACTIVITY_KINDS,
  ACTOR_KINDS,
  type ActivityKind,
  type ActorKind,
} from "../../entities/analytics/activity_kind";
import { accountId } from "../../entities/identity/ids";
import type { ListActivityOutputData } from "../../use_cases/list_activity/output_data";
import type { Clock } from "../../use_cases/ports/clock";
import type { ActivityFilter } from "../../use_cases/ports/activity_log";
import { accountOptions, loadAccounts, type AccountOption } from "./account_directory";
import { activityRow, type ActivityRow } from "./activity_views";
import { ADMIN } from "./admin_actor";
import { exact } from "./format";
import { filled } from "./form_values";
import { href } from "./links";
import { invalid, page, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import { optional, pageNumber } from "./query";
import type { ActivityUseCases } from "./use_cases";

export const ACTIVITY_PAGE = "/dashboard/activity";
export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityQuery {
  readonly account: string | null;
  readonly actor: string | null;
  readonly kind: string | null;
  readonly page: string | null;
}

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly selected: boolean;
}

export interface ActivityView {
  readonly accounts: readonly AccountOption[];
  readonly actors: readonly Choice<ActorKind>[];
  readonly kinds: readonly Choice<ActivityKind>[];
  readonly filtered: boolean;
  readonly rows: readonly ActivityRow[];
  readonly total: string;
  readonly page: number;
  readonly pages: number;
  readonly previous: string | null;
  readonly next: string | null;
}

const ACTOR_LABELS: Readonly<Record<ActorKind, string>> = {
  bot: "Bots",
  human: "You",
  system: "System",
};

export const KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  posts: "Posts",
  publishing: "Publishing",
  reads: "Metrics reads",
  accounts: "Accounts",
  refusals: "Refusals",
  media: "Media",
  sessions: "Logins",
};

function choices<T extends string>(
  all: readonly T[],
  labels: Readonly<Record<T, string>>,
  chosen: T | null,
) {
  return all.map((value) => ({ value, label: labels[value], selected: value === chosen }));
}

interface Chosen {
  readonly account: string | null;
  readonly actor: ActorKind | null;
  readonly kind: ActivityKind | null;
}

type Listed = Extract<ListActivityOutputData, { readonly ok: true }>;

function filterOf(chosen: Chosen): ActivityFilter {
  return {
    ...(chosen.account === null ? {} : { accountId: accountId(chosen.account) }),
    ...(chosen.actor === null ? {} : { actor: chosen.actor }),
    ...(chosen.kind === null ? {} : { kind: chosen.kind }),
  };
}

/** The history of requests (GROKCHAT-15): who did what, on which account, at what cost. */
export class ActivityController {
  constructor(
    private readonly useCases: ActivityUseCases,
    private readonly clock: Clock,
  ) {}

  async activity(query: ActivityQuery): Promise<Outcome<ActivityView>> {
    const actor = optional(query.actor, ACTOR_KINDS);
    const kind = optional(query.kind, ACTIVITY_KINDS);
    const asked = pageNumber(query.page);
    if (actor === "invalid" || kind === "invalid" || asked === null) {
      return invalid("Unknown filter or page.");
    }
    const chosen = { account: filled(query.account), actor, kind };
    const input = {
      actor: ADMIN,
      filter: filterOf(chosen),
      page: asked,
      pageSize: ACTIVITY_PAGE_SIZE,
    };
    const result = await runUseCase(this.useCases.activity, input, (output) => output);
    return result.ok ? page(await this.view(chosen, result)) : refused(result.code);
  }

  private async view(chosen: Chosen, result: Listed): Promise<ActivityView> {
    const accounts = await loadAccounts(this.useCases);
    const now = this.clock.now();
    const at = (n: number) =>
      href(ACTIVITY_PAGE, {
        account: chosen.account,
        actor: chosen.actor,
        kind: chosen.kind,
        page: String(n),
      });
    return {
      accounts: accountOptions(accounts, chosen.account),
      actors: choices(ACTOR_KINDS, ACTOR_LABELS, chosen.actor),
      kinds: choices(ACTIVITY_KINDS, KIND_LABELS, chosen.kind),
      filtered: chosen.account !== null || chosen.actor !== null || chosen.kind !== null,
      rows: result.entries.map((entry) => activityRow(entry, accounts, now)),
      total: exact(result.total),
      page: result.page,
      pages: result.pages,
      previous: result.page > 1 ? at(result.page - 1) : null,
      next: result.page < result.pages ? at(result.page + 1) : null,
    };
  }
}
