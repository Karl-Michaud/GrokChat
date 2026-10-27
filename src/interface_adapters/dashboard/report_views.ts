import type { Account } from "../../entities/accounts/account";
import type { MediaUsage } from "../../entities/media/r2_quota";
import type { AuditEvent } from "../../entities/records/audit_event";
import type { CostTotals } from "../../entities/records/cost_entry";
import type { R2Limits } from "../../use_cases/get_media_usage/output_data";
import { handleOf } from "./account_directory";
import { formatUtc } from "./form_values";
import { postHref } from "./post_views";

export interface CostRow {
  readonly label: string;
  readonly usd: string;
  readonly calls: number;
  /** Calls X lists no price for (media upload): counted, never guessed (plan §2). */
  readonly unknownPriced: number;
}

export interface MediaRow {
  readonly name: string;
  readonly used: string;
  readonly guard: string;
  readonly allowance: string;
  /** Of the free allowance. */
  readonly percent: string;
  /** At or past the guard: uploads (or reads) are refused with media_quota. */
  readonly atGuard: boolean;
}

export interface AuditRow {
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly account: string;
  readonly postId: string | null;
  readonly postHref: string | null;
  readonly detail: string;
}

const count = (value: number): string => value.toLocaleString("en-US");

/** Micro-dollars as dollars with four decimals: a plain post is $0.0150 (plan §1.1). */
export function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

export function costRow(label: string, totals: CostTotals): CostRow {
  return {
    label,
    usd: usd(totals.micros),
    calls: totals.calls,
    unknownPriced: totals.unknownPriced,
  };
}

function mediaRow(name: string, used: number, guard: number, allowance: number): MediaRow {
  return {
    name,
    used: count(used),
    guard: count(guard),
    allowance: count(allowance),
    percent: `${((used / allowance) * 100).toFixed(1)}%`,
    atGuard: used >= guard,
  };
}

export function mediaRows(
  usage: MediaUsage,
  guards: R2Limits,
  allowance: R2Limits,
): readonly MediaRow[] {
  return [
    mediaRow("Stored bytes", usage.storedBytes, guards.storedBytes, allowance.storedBytes),
    mediaRow("Class A operations", usage.classA, guards.classA, allowance.classA),
    mediaRow("Class B operations", usage.classB, guards.classB, allowance.classB),
  ];
}

export function auditRow(event: AuditEvent, accounts: readonly Account[]): AuditRow {
  return {
    at: formatUtc(event.at),
    actor: event.actor,
    action: event.action,
    account: event.accountId === null ? "" : handleOf(accounts, event.accountId),
    postId: event.postId,
    postHref: event.postId === null ? null : postHref(event.postId),
    detail: event.detail,
  };
}
