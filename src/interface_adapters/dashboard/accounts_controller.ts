import type { Account, AccountStatus } from "../../entities/accounts/account";
import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import { accountId } from "../../entities/identity/ids";
import { MINUTE } from "../../entities/time/instant";
import type { AccountCommandResult } from "../../use_cases/admin/account_command";
import type { AccountBreakdown } from "../../use_cases/get_analytics/output_data";
import { badgeOf, loadAccounts, type AccountBadge } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { accountStatusChip, type Chip } from "./chips";
import { compact, exact } from "./format";
import { filled, formatClock } from "./form_values";
import { invalid, page, redirect, refused, type Outcome } from "./outcome";
import { parsePolicyForm, policyForm, type PolicyForm } from "./policy_form";
import { runUseCase } from "./presenter";
import type { AccountUseCases } from "./use_cases";

export interface AccountCard {
  readonly id: string;
  readonly badge: AccountBadge;
  readonly status: Chip;
  /** Refresh lost (A2) or revoked: shown first, cleared only by reconnecting. */
  readonly needsReconnect: boolean;
  readonly canActivate: boolean;
  readonly canPause: boolean;
  readonly mode: string;
  /** The posting limits in words, one per item. */
  readonly limits: readonly string[];
  readonly bioConfirmed: boolean;
  readonly automatedLabelConfirmed: boolean;
  readonly disclosed: boolean;
  readonly followers: string;
  readonly posts7d: string;
  readonly policy: PolicyForm;
}

export interface AccountsView {
  readonly accounts: readonly AccountCard[];
  readonly notice: string | null;
  /** What a Grok bot's `server_url` is: this Worker's `/mcp`. */
  readonly mcpUrl: string;
  /** The command that gives a bot a token for these accounts (docs/runbook.md). */
  readonly addBot: string;
}

export const ACCOUNTS_PAGE = "/dashboard/accounts";

/** The kill switch sets only these; reconnecting clears the others. */
const SWITCHABLE = ["ACTIVE", "PAUSED"] as const;

const plural = (count: number, one: string, many: string): string =>
  `${exact(count)} ${count === 1 ? one : many}`;

/** The policy in words: "10 posts a day", "30 min apart", "Quiet 22:00–06:00", … */
export function limitsOf(policy: PostingPolicy): readonly string[] {
  const quiet = policy.quietHours;
  return [
    `${plural(policy.dailyCap, "post", "posts")} a day`,
    policy.minGap === 0 ? "No minimum gap" : `${exact(policy.minGap / MINUTE)} min apart`,
    quiet === null
      ? "No quiet hours"
      : `Quiet ${formatClock(quiet.startMinute)}–${formatClock(quiet.endMinute)}`,
    policy.tz,
    policy.linkPolicy === "ALLOW" ? "Links allowed" : "No https:// links",
  ];
}

function followersOf(numbers: AccountBreakdown | undefined): string {
  return numbers === undefined || numbers.followers === null ? "—" : compact(numbers.followers);
}

function card(
  account: Account,
  accounts: readonly Account[],
  numbers: AccountBreakdown | undefined,
): AccountCard {
  const { disclosure, status } = account;
  return {
    id: account.id,
    badge: badgeOf(accounts, account.id),
    status: accountStatusChip(status),
    needsReconnect: status === "NEEDS_RECONNECT" || status === "DISCONNECTED",
    canActivate: status === "PAUSED",
    canPause: status === "ACTIVE",
    mode: account.policy.mode === "AUTO" ? "Auto-publish" : "Review first",
    limits: limitsOf(account.policy),
    bioConfirmed: disclosure.bioConfirmed,
    automatedLabelConfirmed: disclosure.automatedLabelConfirmed,
    disclosed: disclosure.bioConfirmed && disclosure.automatedLabelConfirmed,
    followers: followersOf(numbers),
    posts7d: exact(numbers === undefined ? 0 : numbers.published),
    policy: policyForm(account.policy),
  };
}

const toOutcome = (output: AccountCommandResult<string>): Outcome<never> =>
  output.ok ? redirect(ACCOUNTS_PAGE) : refused(output.code);

/** The account manager (GROKCHAT-15): connect, kill switch, disclosure, policy, bot setup. */
export class AccountsController {
  constructor(private readonly useCases: AccountUseCases) {}

  async accounts(query: {
    readonly connected: string | null;
    readonly origin: string;
  }): Promise<Outcome<AccountsView>> {
    const accounts = await loadAccounts(this.useCases);
    const week = await runUseCase(
      this.useCases.analytics,
      { actor: ADMIN, range: "7d", accountId: null },
      (output) => (output.ok ? output.accounts : null),
    );
    const connected = filled(query.connected);
    const ids = accounts.map((account) => account.id).join(",");
    return page({
      accounts: accounts.map((account) =>
        card(
          account,
          accounts,
          week?.find((row) => row.accountId === account.id),
        ),
      ),
      notice: connected === null ? null : `Connected ${connected}. It starts paused.`,
      mcpUrl: `${query.origin}/mcp`,
      addBot: `npm run add-bot -- --id <bot name> --accounts ${ids === "" ? "<account id>" : ids}`,
    });
  }

  status(id: string, value: string): Promise<Outcome<never>> {
    const status: AccountStatus | undefined = SWITCHABLE.find((candidate) => candidate === value);
    if (status === undefined) {
      return Promise.resolve(invalid("The status must be ACTIVE or PAUSED."));
    }
    const input = { actor: ADMIN, accountId: accountId(id), status };
    return runUseCase(this.useCases.setAccountStatus, input, toOutcome);
  }

  disclosure(
    id: string,
    form: { readonly bioConfirmed: boolean; readonly automatedLabelConfirmed: boolean },
  ): Promise<Outcome<never>> {
    const input = { actor: ADMIN, accountId: accountId(id), ...form };
    return runUseCase(this.useCases.confirmDisclosure, input, toOutcome);
  }

  policy(id: string, form: PolicyForm): Promise<Outcome<never>> {
    const policy = parsePolicyForm(form);
    if ("message" in policy) {
      return Promise.resolve(invalid(policy.message));
    }
    const input = { actor: ADMIN, accountId: accountId(id), policy };
    return runUseCase(this.useCases.setPolicy, input, toOutcome);
  }
}
