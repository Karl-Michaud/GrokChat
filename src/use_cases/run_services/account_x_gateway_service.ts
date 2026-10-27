import type { AccountId, XPostId } from "../../entities/identity/ids";
import type { TokenSet } from "../../entities/x/token_set";
import type { AccountXGateway, DeleteOutcome } from "../ports/account_x_gateway";
import type { Clock } from "../ports/clock";
import type { Locks } from "../ports/locks";
import type { TokenStore } from "../ports/token_store";
import type { XPublisher } from "../ports/x_publisher";
import type { XCallRecorder } from "./x_call_recorder";

export interface AccountXGatewayPorts {
  readonly publisher: XPublisher;
  readonly store: TokenStore;
  readonly locks: Locks;
  readonly recorder: XCallRecorder;
  readonly clock: Clock;
}

/** The `AccountXGateway` as it runs inside the account's Durable Object (A1). */
export class AccountXGatewayService implements AccountXGateway {
  constructor(private readonly ports: AccountXGatewayPorts) {}

  async deletePost(id: AccountId, xPostIds: readonly XPostId[]): Promise<readonly DeleteOutcome[]> {
    const outcomes: DeleteOutcome[] = [];
    for (const xPostId of xPostIds) {
      const result = await this.ports.publisher.delete(id, xPostId);
      await this.ports.recorder.record({
        account: { id },
        operation: { kind: "delete" },
        billed: result.ok,
        outcome: result.ok ? `deleted ${xPostId}` : `failed: ${result.failure.kind}`,
        postId: null,
        at: this.ports.clock.now(),
      });
      outcomes.push({ xPostId, deleted: result.ok });
      if (!result.ok) {
        break;
      }
    }
    return outcomes;
  }

  /** A (re)connect: the new tokens replace the old ones and clear any REFRESHING marker. */
  storeConnectedTokens(account: AccountId, tokens: TokenSet): Promise<void> {
    return this.ports.locks.token.run(() => this.ports.store.commitRotated(account, tokens));
  }
}
