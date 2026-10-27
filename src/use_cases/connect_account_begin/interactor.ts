import { MINUTE } from "../../entities/time/instant";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id_generator";
import type { OAuthStateStore } from "../ports/oauth_state_store";
import type { PkceGenerator } from "../ports/pkce_generator";
import type { XAccountConnector } from "../ports/x_account_connector";
import type { ConnectAccountBeginInputBoundary } from "./input_boundary";
import type { ConnectAccountBeginInputData } from "./input_data";
import type { ConnectAccountBeginOutputBoundary } from "./output_boundary";

/** How long the owner has to finish on X. */
export const OAUTH_STATE_TTL = 10 * MINUTE;

export interface ConnectAccountBeginPorts {
  readonly states: OAuthStateStore;
  readonly pkce: PkceGenerator;
  readonly connector: XAccountConnector;
  readonly guard: AccessGuard;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

/** Starts X's OAuth 2.0 PKCE flow, with a single-use state bound to the admin session. */
export class ConnectAccountBeginInteractor implements ConnectAccountBeginInputBoundary {
  constructor(
    private readonly ports: ConnectAccountBeginPorts,
    private readonly presenter: ConnectAccountBeginOutputBoundary,
  ) {}

  async execute(input: ConnectAccountBeginInputData): Promise<void> {
    const action = {
      actor: input.actor,
      action: "account.connect_begin",
      accountId: null,
      postId: null,
    };
    if (!(await this.ports.guard.humanOnly(action))) {
      this.presenter.present(refusal("human_only"));
      return;
    }
    const state = this.ports.ids.newId();
    const pair = await this.ports.pkce.create();
    await this.ports.states.put({
      state,
      verifier: pair.verifier,
      sessionId: input.sessionId,
      expiresAt: this.ports.clock.now() + OAUTH_STATE_TTL,
    });
    this.presenter.present({
      ok: true,
      authorizeUrl: this.ports.connector.authorizeUrl(state, pair.challenge),
    });
  }
}
