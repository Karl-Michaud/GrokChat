import type { Account } from "../../entities/accounts/account";
import { actorKindOf, type ActorKind } from "../../entities/analytics/activity_kind";
import type { CostEstimate } from "../../entities/costs/estimate_cost";
import type { Instant } from "../../entities/time/instant";
import type { ActivityEntry } from "../../use_cases/ports/activity_log";
import { badgeOf, type AccountBadge } from "./account_directory";
import { actionChip, type Chip } from "./chips";
import { dateTimeLabel, dollars, relativeTime } from "./format";
import { postHref } from "./links";

export interface ActivityRow {
  readonly when: string;
  readonly relative: string;
  readonly actor: { readonly kind: ActorKind | null; readonly name: string };
  readonly action: Chip;
  readonly account: AccountBadge | null;
  readonly postHref: string | null;
  readonly detail: string;
  /** "$0.0150", "unpriced" for a call X lists no price for, "" for no X call. */
  readonly cost: string;
}

export function costLabel(cost: CostEstimate | null): string {
  if (cost === null) {
    return "";
  }
  return cost.kind === "usd" ? dollars(cost.micros) : "unpriced";
}

/** `bot:muse-bot` → bot, "muse-bot". */
function actorOf(label: string): ActivityRow["actor"] {
  const kind = actorKindOf(label);
  return { kind, name: kind === null ? label : label.slice(kind.length + 1) };
}

export function activityRow(
  entry: ActivityEntry,
  accounts: readonly Account[],
  now: Instant,
): ActivityRow {
  return {
    when: dateTimeLabel(entry.at),
    relative: relativeTime(entry.at, now),
    actor: actorOf(entry.actor),
    action: actionChip(entry.action),
    account: entry.accountId === null ? null : badgeOf(accounts, entry.accountId),
    postHref: entry.postId === null ? null : postHref(entry.postId),
    detail: entry.detail,
    cost: costLabel(entry.cost),
  };
}
