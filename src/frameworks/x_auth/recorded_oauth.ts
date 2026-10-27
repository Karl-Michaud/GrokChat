import type { AccountId } from "../../entities/identity/ids";
import type { RefreshResult } from "../../entities/x/refresh_outcome";
import type { AuditLog } from "../../use_cases/ports/audit_log";
import type { Clock } from "../../use_cases/ports/clock";
import type { ConnectedXUser, XAccountConnector } from "../../use_cases/ports/x_account_connector";
import type { XTokenRefresher } from "../../use_cases/ports/x_token_refresher";
import type { XCallRecorder } from "../../use_cases/run_services/x_call_recorder";

/**
 * Runs a record after the result is handed back. The refresh is under `Locks.token` and its
 * rotated token must be persisted first (A2): a slow or failing audit write must never stand
 * between X's rotation and the store. In the DO this is `ctx.waitUntil`.
 */
export type Defer = (work: Promise<unknown>) => void;

/**
 * Cost and audit for one account's refresh calls (I5): an `oauth` entry ($0, U1) and an
 * `x.oauth` audit line naming the outcome, never a token. Built per account, inside its DO.
 */
export class RecordedXTokenRefresher implements XTokenRefresher {
  constructor(
    private readonly inner: XTokenRefresher,
    private readonly recorder: XCallRecorder,
    private readonly account: AccountId,
    private readonly clock: Clock,
    private readonly defer: Defer,
  ) {}

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const result = await this.inner.refresh(refreshToken);
    const record = this.recorder.record({
      account: { id: this.account },
      operation: { kind: "oauth" },
      billed: true,
      outcome: `refresh ${result.kind}`,
      postId: null,
      at: this.clock.now(),
    });
    this.defer(record.catch(() => undefined));
    return result;
  }
}

/**
 * Audit for the code exchange (I5). The account does not exist yet when a new one connects, so
 * there is no account to charge: the call is audited with no account, and the interactor's own
 * `account.connect` line names the account once it is saved.
 */
export class AuditedXAccountConnector implements XAccountConnector {
  constructor(
    private readonly inner: XAccountConnector,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  authorizeUrl(state: string, codeChallenge: string): string {
    return this.inner.authorizeUrl(state, codeChallenge);
  }

  async complete(code: string, verifier: string): Promise<ConnectedXUser | null> {
    const user = await this.inner.complete(code, verifier);
    await this.audit.append({
      at: this.clock.now(),
      actor: "system:x",
      action: "x.oauth",
      accountId: null,
      postId: null,
      detail: user === null ? "connect failed" : `connected @${user.handle} (${user.xUserId})`,
    });
    return user;
  }
}
