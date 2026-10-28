import { accountId } from "../../entities/identity/ids";
import { ACCOUNTS_PAGE } from "./accounts_controller";
import { ADMIN } from "./admin_actor";
import { filled } from "./form_values";
import { invalid, redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import type { OAuthUseCases } from "./use_cases";

/** What the owner chose on the accounts page before going to X: reconnect one, or a new one. */
export interface ConnectIntent {
  readonly reconnect: string | null;
}

export interface Callback {
  readonly sessionId: string;
  /** The query's `code`, `state` and `error`, as X sent them. */
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  readonly intent: ConnectIntent;
}

/** X's OAuth 2.0 connect flow behind the admin session (plan §3.5, R11). */
export class OAuthController {
  constructor(private readonly useCases: OAuthUseCases) {}

  begin(sessionId: string): Promise<Outcome<never>> {
    return runUseCase(this.useCases.connectBegin, { actor: ADMIN, sessionId }, (output) =>
      output.ok ? redirect(output.authorizeUrl) : refused(output.code),
    );
  }

  /** The callback never echoes the code, the state or X's error text. */
  complete(callback: Callback): Promise<Outcome<never>> {
    const code = filled(callback.code);
    const state = filled(callback.state);
    if (filled(callback.error) !== null) {
      return Promise.resolve(invalid("The connection was cancelled or refused on X."));
    }
    if (code === null || state === null) {
      return Promise.resolve(invalid("The callback is missing its code or its state."));
    }
    const reconnect = filled(callback.intent.reconnect);
    const input = {
      actor: ADMIN,
      sessionId: callback.sessionId,
      state,
      code,
      // Stryker disable next-line ConditionalExpression: the id brands are identity casts, so null maps to null either way.
      reconnect: reconnect === null ? null : accountId(reconnect),
    };
    return runUseCase(this.useCases.connectComplete, input, (output) =>
      output.ok
        ? redirect(`${ACCOUNTS_PAGE}?connected=${encodeURIComponent(`@${output.handle}`)}`)
        : refused(output.code),
    );
  }
}
