import { ALLOWED, refuse, type Decision } from "../decision";
import type { AccountId, BotId } from "./ids";

/** The accounts a bot may act on (plan §3.1; the bot-clients secret, §3.5). */
export interface BotScope {
  readonly botId: BotId;
  readonly accountIds: readonly AccountId[];
}

export interface BotActor {
  readonly kind: "bot";
  readonly scope: BotScope;
}

export interface HumanActor {
  readonly kind: "human";
  readonly name: string;
}

export interface SystemActor {
  readonly kind: "system";
  readonly job: string;
}

export type Actor = BotActor | HumanActor | SystemActor;

/**
 * Called by every interactor after it loads the resource: a bot may act only on the accounts in
 * its scope; humans (the dashboard) and the system (cron) may act on every account.
 */
export function authorize(actor: Actor, account: AccountId): Decision<"scope"> {
  if (actor.kind !== "bot" || actor.scope.accountIds.includes(account)) {
    return ALLOWED;
  }
  return refuse("scope");
}

export function isHuman(actor: Actor): actor is HumanActor {
  return actor.kind === "human";
}

/** The name an actor is recorded under in the audit log. */
export function actorLabel(actor: Actor): string {
  switch (actor.kind) {
    case "bot":
      return `bot:${actor.scope.botId}`;
    case "human":
      return `human:${actor.name}`;
    case "system":
      return `system:${actor.job}`;
  }
}
