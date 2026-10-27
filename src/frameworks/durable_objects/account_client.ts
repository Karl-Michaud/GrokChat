import type { AccountId, PostId, XPostId } from "../../entities/identity/ids";
import { redactCredentials } from "../../entities/security/redact";
import type { Instant } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";
import type {
  AccountMetricsCollector,
  MetricsSummary,
} from "../../use_cases/ports/account_metrics_collector";
import type { AccountPublisher, PublishSummary } from "../../use_cases/ports/account_publisher";
import type { AccountReconciler, ReconcileSummary } from "../../use_cases/ports/account_reconciler";
import type { AccountXGateway, DeleteOutcome } from "../../use_cases/ports/account_x_gateway";
import type { AccountPublisherObject } from "./account_publisher";

const NOT_PUBLISHED: PublishSummary = { ran: false, sent: 0, touched: [], appRateLimited: false };
const NOT_RECONCILED: ReconcileSummary = { ran: false, found: 0, notFound: 0 };
const NOT_COLLECTED: MetricsSummary = { ran: false, read: 0 };

/**
 * The Worker's side of the account Durable Objects: each call goes to `idFromName(accountId)`.
 * A rejected call (the object was reset or aborted mid-call) means "outcome unknown; recovered by
 * the next publish call", and is never retried from here (plan §3.5): a retry could send twice.
 */
export class AccountObjects
  implements AccountPublisher, AccountReconciler, AccountMetricsCollector, AccountXGateway
{
  constructor(private readonly namespace: DurableObjectNamespace<AccountPublisherObject>) {}

  publishDue(account: AccountId, now: Instant, deadline: Instant): Promise<PublishSummary> {
    return this.call("publishDue", NOT_PUBLISHED, () =>
      this.stub(account).publishDue(account, now, deadline),
    );
  }

  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary> {
    return this.call("publishNow", NOT_PUBLISHED, () =>
      this.stub(account).publishNow(account, post, deadline),
    );
  }

  reconcile(account: AccountId, now: Instant, deadline: Instant): Promise<ReconcileSummary> {
    return this.call("reconcile", NOT_RECONCILED, () =>
      this.stub(account).reconcile(account, now, deadline),
    );
  }

  collect(account: AccountId, now: Instant, deadline: Instant): Promise<MetricsSummary> {
    return this.call("collect", NOT_COLLECTED, () =>
      this.stub(account).collect(account, now, deadline),
    );
  }

  deletePost(account: AccountId, xPostIds: readonly XPostId[]): Promise<readonly DeleteOutcome[]> {
    return this.call("deletePost", [], () => this.stub(account).deletePost(account, xPostIds));
  }

  /** A connect that did not store its tokens fails loudly: the admin connects again. */
  async storeConnectedTokens(account: AccountId, tokens: TokenSet): Promise<void> {
    const result = await this.stub(account).storeConnectedTokens(account, tokens);
    if (!result.stored) {
      throw new Error(`the tokens for ${account} were not stored`);
    }
  }

  private stub(account: AccountId): DurableObjectStub<AccountPublisherObject> {
    return this.namespace.get(this.namespace.idFromName(account));
  }

  private async call<T>(method: string, fallback: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      console.error(`AccountObjects.${method} rejected: ${redactCredentials(String(error))}`);
      return fallback;
    }
  }
}
