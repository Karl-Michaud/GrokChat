import { DurableObject } from "cloudflare:workers";
import type { AccountId, PostId, XPostId } from "../../entities/identity/ids";
import { redactCredentials } from "../../entities/security/redact";
import type { Instant } from "../../entities/time/instant";
import type { TokenSet } from "../../entities/x/token_set";
import type { MetricsSummary } from "../../use_cases/ports/account_metrics_collector";
import type { PublishSummary } from "../../use_cases/ports/account_publisher";
import type { ReconcileSummary } from "../../use_cases/ports/account_reconciler";
import type { DeleteOutcome } from "../../use_cases/ports/account_x_gateway";
import type { Env } from "../env";
import type { AccountServices } from "./account_services";

const NOT_PUBLISHED: PublishSummary = { ran: false, sent: 0, touched: [], appRateLimited: false };
const NOT_RECONCILED: ReconcileSummary = { ran: false, found: 0, notFound: 0 };
const NOT_COLLECTED: MetricsSummary = { ran: false, read: 0, followers: 0 };
const NOT_STORED: { readonly stored: boolean } = { stored: false };

/** The storage key of the one account this object serves. */
const BOUND_ACCOUNT = "account";

export class WrongAccountError extends Error {
  override readonly name = "WrongAccountError";
}

/**
 * The account's Durable Object (plan §3.5), one per account (`idFromName(accountId)`). It hosts the
 * publish, recovery, reconcile, metrics, delete and token code for its account; the two ordered
 * promise-chain mutexes live in the services it builds (`Locks`), never `blockConcurrencyWhile`,
 * whose 30 s reset is too short for an X call plus D1 writes.
 *
 * Every method catches and maps its errors, because an uncaught throw resets the object: a
 * publish that throws mid-part leaves its post PUBLISHING, and the next publish call's recovery,
 * under the publish lock, resolves it (R17). The subclass in main.ts supplies the services.
 */
export abstract class AccountPublisherObject extends DurableObject<Env> {
  private built: AccountServices | null = null;
  private binding: Promise<AccountId> | null = null;

  protected abstract build(): AccountServices;

  protected services(): AccountServices {
    this.built ??= this.build();
    return this.built;
  }

  publishDue(account: AccountId, now: Instant, deadline: Instant): Promise<PublishSummary> {
    return this.guarded("publishDue", account, NOT_PUBLISHED, (services) =>
      services.publisher.publishDue(account, now, deadline),
    );
  }

  publishNow(account: AccountId, post: PostId, deadline: Instant): Promise<PublishSummary> {
    return this.guarded("publishNow", account, NOT_PUBLISHED, (services) =>
      services.publisher.publishNow(account, post, deadline),
    );
  }

  reconcile(account: AccountId, now: Instant, deadline: Instant): Promise<ReconcileSummary> {
    return this.guarded("reconcile", account, NOT_RECONCILED, (services) =>
      services.reconciler.reconcile(account, now, deadline),
    );
  }

  collect(account: AccountId, now: Instant, deadline: Instant): Promise<MetricsSummary> {
    return this.guarded("collect", account, NOT_COLLECTED, (services) =>
      services.collector.collect(account, now, deadline),
    );
  }

  /** On a failure nothing is confirmed deleted: each part stays SENT ("delete incomplete"). */
  deletePost(account: AccountId, xPostIds: readonly XPostId[]): Promise<readonly DeleteOutcome[]> {
    return this.guarded("deletePost", account, [], (services) =>
      services.gateway.deletePost(account, xPostIds),
    );
  }

  /** `stored: false` tells the Worker the connect did not complete; the tokens never come back. */
  storeConnectedTokens(
    account: AccountId,
    tokens: TokenSet,
  ): Promise<{ readonly stored: boolean }> {
    return this.guarded("storeConnectedTokens", account, NOT_STORED, async (services) => {
      await services.gateway.storeConnectedTokens(account, tokens);
      return { stored: true };
    });
  }

  private async guarded<T>(
    method: string,
    account: AccountId,
    fallback: T,
    run: (services: AccountServices) => Promise<T>,
  ): Promise<T> {
    try {
      await this.bind(account);
      return await run(this.services());
    } catch (error: unknown) {
      console.error(`AccountPublisher.${method} failed: ${redactCredentials(String(error))}`);
      return fallback;
    }
  }

  /**
   * One object, one account: the first account it serves is recorded, and a call for another is
   * refused, so no Worker bug can run two accounts' publishes under one lock or one under two.
   * Concurrent first calls share one lookup, so the first of them decides.
   */
  private async bind(account: AccountId): Promise<void> {
    this.binding ??= this.recordBinding(account);
    const bound = await this.binding;
    if (bound !== account) {
      throw new WrongAccountError(`this object serves ${bound}, not ${account}`);
    }
  }

  private async recordBinding(account: AccountId): Promise<AccountId> {
    const stored = await this.ctx.storage.get<AccountId>(BOUND_ACCOUNT);
    if (stored !== undefined) {
      return stored;
    }
    await this.ctx.storage.put(BOUND_ACCOUNT, account);
    return account;
  }
}
