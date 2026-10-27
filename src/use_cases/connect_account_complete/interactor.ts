import type { Account } from "../../entities/accounts/account";
import { DEFAULT_POLICY } from "../../entities/accounts/posting_policy";
import { accountId, type AccountId, type PersonalityId } from "../../entities/identity/ids";
import type { AccessGuard } from "../access/access_guard";
import type { ActionAudit } from "../access/action_audit";
import { refusal, type Refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { AccountXGateway } from "../ports/account_x_gateway";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id_generator";
import type { OAuthStateStore } from "../ports/oauth_state_store";
import type { PersonalityRepository } from "../ports/personality_repository";
import type { ConnectedXUser, XAccountConnector } from "../ports/x_account_connector";
import type { ConnectAccountCompleteInputBoundary } from "./input_boundary";
import type { ConnectAccountCompleteInputData } from "./input_data";
import type { ConnectAccountCompleteOutputBoundary } from "./output_boundary";
import type {
  ConnectAccountCompleteOutputData,
  ConnectAccountCompleteRefusalCode,
} from "./output_data";

export interface ConnectAccountCompletePorts {
  readonly states: OAuthStateStore;
  readonly connector: XAccountConnector;
  readonly accounts: AccountRepository;
  readonly personalities: PersonalityRepository;
  readonly gateway: AccountXGateway;
  readonly guard: AccessGuard;
  readonly audit: ActionAudit;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type Planned = Account | Refusal<ConnectAccountCompleteRefusalCode>;

/**
 * The OAuth callback (plan §3.3 #10, rev 4 M7): the state must be this session's and unused; a
 * reconnect must be the same X user and clears DISCONNECTED or NEEDS_RECONNECT to PAUSED; a new
 * account starts PAUSED, undisclosed. Tokens go straight to the account's DO (A1).
 */
export class ConnectAccountCompleteInteractor implements ConnectAccountCompleteInputBoundary {
  constructor(
    private readonly ports: ConnectAccountCompletePorts,
    private readonly presenter: ConnectAccountCompleteOutputBoundary,
  ) {}

  async execute(input: ConnectAccountCompleteInputData): Promise<void> {
    this.presenter.present(await this.complete(input));
  }

  private async complete(
    input: ConnectAccountCompleteInputData,
  ): Promise<ConnectAccountCompleteOutputData> {
    const action = {
      actor: input.actor,
      action: "account.connect",
      accountId: input.reconnect,
      postId: null,
    };
    if (!(await this.ports.guard.humanOnly(action))) {
      return refusal("human_only");
    }
    const verifier = await this.ports.states.take(
      input.state,
      input.sessionId,
      this.ports.clock.now(),
    );
    if (verifier === null) {
      return refusal("oauth_state");
    }
    const user = await this.ports.connector.complete(input.code, verifier);
    if (user === null) {
      return refusal("oauth_failed");
    }
    const account =
      input.reconnect === null
        ? await this.newAccount(user, input.personalityId)
        : await this.reconnected(user, input.reconnect);
    if ("ok" in account) {
      return account;
    }
    await this.ports.gateway.storeConnectedTokens(account.id, user.tokens);
    await this.ports.accounts.save(account);
    await this.ports.audit.done({ ...action, accountId: account.id }, `@${account.handle}`);
    return { ok: true, accountId: account.id, handle: account.handle, status: account.status };
  }

  private async reconnected(user: ConnectedXUser, id: AccountId): Promise<Planned> {
    const account = await this.ports.accounts.get(id);
    if (account === null) {
      return refusal("not_found");
    }
    if (account.xUserId !== user.xUserId) {
      return refusal("different_x_user");
    }
    const status = account.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
    return { ...account, handle: user.handle, status };
  }

  private async newAccount(
    user: ConnectedXUser,
    personality: PersonalityId | null,
  ): Promise<Planned> {
    if ((await this.ports.accounts.findByXUserId(user.xUserId)) !== null) {
      return refusal("already_connected");
    }
    if (personality === null) {
      return refusal("personality_required");
    }
    const found = await this.ports.personalities.get(personality);
    if (found === null) {
      return refusal("personality_not_found");
    }
    return {
      id: accountId(this.ports.ids.newId()),
      xUserId: user.xUserId,
      handle: user.handle,
      personalityId: found.id,
      status: "PAUSED",
      disclosure: { bioConfirmed: false, automatedLabelConfirmed: false },
      policy: DEFAULT_POLICY,
      isAppOwner: false,
    };
  }
}
