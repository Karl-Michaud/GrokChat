import { TOKEN_STEP_CALLS } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { TokenProvider } from "../ports/token_provider";

/**
 * The token step a run takes before its first X call (plan §3.3 #4 (1), N1, A2), against the
 * invocation's real deadline: when a refresh is needed and its un-aborted worst case does not fit,
 * the provider refuses it (`refresh_does_not_fit`) and the run yields before any call to X. A
 * reconcile or metrics run is often the first to see a token inside the refresh margin, since it
 * also runs for accounts with nothing to publish. Only a usable token lets the run go on; a lost
 * one sends nothing (R18: no reconcile read).
 */
export class TokenStep {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly clock: Clock,
  ) {}

  async ready(account: AccountId, meter: BudgetMeter): Promise<boolean> {
    if (!meter.fits(TOKEN_STEP_CALLS, this.clock.now())) {
      return false;
    }
    const token = await this.tokens.accessToken(account, meter.remaining().deadline);
    return token.kind === "token";
  }
}
