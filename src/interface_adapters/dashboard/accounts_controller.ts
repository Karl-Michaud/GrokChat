import type { Account, AccountStatus } from "../../entities/accounts/account";
import type { PostingPolicy } from "../../entities/accounts/posting_policy";
import { accountId } from "../../entities/identity/ids";
import { MINUTE } from "../../entities/time/instant";
import type { AccountCommandResult } from "../../use_cases/admin/account_command";
import type { AccountBreakdown } from "../../use_cases/get_analytics/output_data";
import { personInitials } from "../../entities/people/person";
import type { Instant } from "../../entities/time/instant";
import type { PersonListing } from "../../use_cases/list_people/output_data";
import { badgeOf, loadAccounts, TONES, type AccountBadge } from "./account_directory";
import { ADMIN } from "./admin_actor";
import { accountStatusChip, type Chip } from "./chips";
import { compact, exact } from "./format";
import { filled, formatClock } from "./form_values";
import { invalid, page, redirect, refused, type Outcome } from "./outcome";
import { parsePolicyForm, policyForm, type PolicyForm } from "./policy_form";
import { runUseCase } from "./presenter";
import type { AccountUseCases } from "./use_cases";

/** One choice of a select (the Owner select). */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

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
  /** The Owner select: "Unassigned" first, then every person; the current one selected. */
  readonly owners: readonly SelectOption[];
}

/** A person's section on the accounts page (GROKCHAT-16), with the cards of their accounts. */
export interface PersonGroup {
  readonly id: string;
  readonly name: string;
  readonly initials: string;
  /** 1 to 8, from the person's place in the name-ordered list. */
  readonly tone: number;
  /** "2 accounts" */
  readonly count: string;
  /** "Token set Oct 27, 2026" or "No token". */
  readonly token: string;
  readonly hasToken: boolean;
  readonly accounts: readonly AccountCard[];
}

export interface AccountsView {
  readonly people: readonly PersonGroup[];
  /** The accounts no person has: no bot may act on them. */
  readonly unassigned: readonly AccountCard[];
  /** Every account, for the empty state. */
  readonly total: number;
  readonly notice: string | null;
  /** What a Grok bot's `server_url` is: this Worker's `/mcp`. */
  readonly mcpUrl: string;
}

export const ACCOUNTS_PAGE = "/dashboard/accounts";

/** The kill switch sets only these; reconnecting clears the others. */
const SWITCHABLE = ["ACTIVE", "PAUSED"] as const;

export const plural = (count: number, one: string, many: string): string =>
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

/** Oct 27, 2026 */
export function tokenDate(at: Instant): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ownerOptions(people: readonly PersonListing[], owner: string): readonly SelectOption[] {
  return [
    { value: "", label: "Unassigned", selected: owner === "" },
    ...people.map(({ person }) => ({
      value: person.id,
      label: person.name,
      selected: person.id === owner,
    })),
  ];
}

interface CardContext {
  readonly accounts: readonly Account[];
  readonly people: readonly PersonListing[];
  readonly week: readonly AccountBreakdown[] | null;
}

function card(account: Account, context: CardContext): AccountCard {
  const { disclosure, status } = account;
  const numbers = context.week?.find((row) => row.accountId === account.id);
  const owner = context.people.find(({ accountIds }) => accountIds.includes(account.id));
  return {
    id: account.id,
    badge: badgeOf(context.accounts, account.id),
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
    owners: ownerOptions(context.people, owner?.person.id ?? ""),
  };
}

function group(listing: PersonListing, index: number, context: CardContext): PersonGroup {
  const { person } = listing;
  const accounts = context.accounts.filter((account) => listing.accountIds.includes(account.id));
  return {
    id: person.id,
    name: person.name,
    initials: personInitials(person.name),
    tone: (index % TONES) + 1,
    count: plural(accounts.length, "account", "accounts"),
    token: person.token === null ? "No token" : `Token set ${tokenDate(person.token.createdAt)}`,
    hasToken: person.token !== null,
    accounts: accounts.map((account) => card(account, context)),
  };
}

const toOutcome = (output: AccountCommandResult<string>): Outcome<never> =>
  output.ok ? redirect(ACCOUNTS_PAGE) : refused(output.code);

/**
 * The account manager (GROKCHAT-15): connect, kill switch, disclosure, policy; since GROKCHAT-16
 * grouped by person, each card with its Owner select.
 */
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
    const people = await runUseCase(this.useCases.listPeople, { actor: ADMIN }, (output) =>
      output.ok ? output.people : [],
    );
    const context = { accounts, people, week };
    const owned = new Set(people.flatMap(({ accountIds }) => accountIds));
    const connected = filled(query.connected);
    return page({
      people: people.map((listing, index) => group(listing, index, context)),
      unassigned: accounts
        .filter((account) => !owned.has(account.id))
        .map((account) => card(account, context)),
      total: accounts.length,
      notice: connected === null ? null : `Connected ${connected}. It starts paused.`,
      mcpUrl: `${query.origin}/mcp`,
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
