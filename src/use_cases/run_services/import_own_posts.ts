import type { Account } from "../../entities/accounts/account";
import { IMPORT_PAGE_COST } from "../../entities/budget/budget";
import type { AccountId } from "../../entities/identity/ids";
import { importDue, importSince, type ImportedPost } from "../../entities/posts/imported_post";
import type { Instant } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";
import type { AccountRepository } from "../ports/account_repository";
import type { BudgetMeter } from "../ports/budget_meter";
import type { Clock } from "../ports/clock";
import type { ImportedPostStore } from "../ports/imported_posts";
import type { SingleFlight } from "../ports/single_flight";
import type { XOwnTimelineReader, XPostSummary, XPostsPage } from "../ports/x_own_timeline_reader";
import type { TokenStep } from "./token_step";
import type { XCallRecorder } from "./x_call_recorder";

/** At most this many pages (100 posts each) per import; older posts past them are skipped. */
export const IMPORT_PAGES = 5;

export interface ImportOwnPostsPorts {
  readonly accounts: AccountRepository;
  readonly imported: ImportedPostStore;
  readonly timeline: XOwnTimelineReader;
  readonly tokenStep: TokenStep;
  readonly recorder: XCallRecorder;
  readonly flights: SingleFlight;
  readonly clock: Clock;
}

/** Only an account with tokens is read: a lost or revoked one is skipped until reconnected. */
const CONNECTED: readonly Account["status"][] = ["ACTIVE", "PAUSED"];

/** A page read: how many posts were new, when they were made, and the next page. */
interface PageRead {
  readonly added: number;
  readonly made: readonly Instant[];
  readonly next: string | null;
}

/**
 * The import of posts made outside GrokChat (GROKCHAT-19), inside the account's Durable Object,
 * single-flight: at most every `IMPORT_INTERVAL`, the account's own timeline is read from the
 * second after the newest post seen, and the posts GrokChat did not publish are stored, so their
 * metrics are read like its own. Every page is billed per post returned and recorded like any X
 * call. A run the budget cuts short is not finished, so the next tick takes it again; a failed
 * read finishes the run without moving the cursor, so it is read again after the interval.
 */
export class ImportOwnPosts {
  constructor(private readonly ports: ImportOwnPostsPorts) {}

  /** How many new posts were stored; 0 when the import was not due or could not run. */
  async import(account: AccountId, meter: BudgetMeter): Promise<number> {
    const flight = await this.ports.flights.tryRun(`import:${account}`, () =>
      this.run(account, meter),
    );
    return flight.ran ? flight.value : 0;
  }

  private async run(id: AccountId, meter: BudgetMeter): Promise<number> {
    const { accounts, imported, tokenStep, clock } = this.ports;
    const account = await accounts.get(id);
    const now = clock.now();
    if (account === null || !CONNECTED.includes(account.status)) {
      return 0;
    }
    const cursor = await imported.cursor(id);
    if (!importDue(cursor.lastRunAt, now) || !meter.fits(IMPORT_PAGE_COST, now)) {
      return 0;
    }
    if (!(await tokenStep.ready(id, meter))) {
      return 0;
    }
    const since = importSince(cursor.newestCreatedAt, now);
    let token: string | null = null;
    let added = 0;
    const made: Instant[] = [];
    for (let page = 0; page < IMPORT_PAGES; page += 1) {
      if (!meter.fits(IMPORT_PAGE_COST, clock.now())) {
        return added;
      }
      const step = await this.store(account, await this.ports.timeline.page(id, since, token));
      if (step === null) {
        // The pages after it were never read: the cursor stays, so the next import reads them.
        await imported.finish(id, now, null);
        return added;
      }
      added += step.added;
      made.push(...step.made);
      token = step.next;
      if (token === null) {
        break;
      }
    }
    await imported.finish(id, now, made.length === 0 ? null : Math.max(...made));
    return added;
  }

  /** The page's new posts stored and the read recorded; null when the read failed. */
  private async store(account: Account, result: XResult<XPostsPage>): Promise<PageRead | null> {
    const { recorder, imported, clock } = this.ports;
    const at = clock.now();
    const found = result.ok ? result.value.posts : [];
    const added = await imported.add(found.map((post) => toImported(account, post, at)));
    await recorder.record({
      account,
      operation: { kind: "read", resources: found.length },
      billed: result.ok,
      outcome: result.ok
        ? `imported ${String(added)} of ${String(found.length)}`
        : `import failed: ${result.failure.kind}`,
      postId: null,
      at,
    });
    return result.ok
      ? { added, made: found.map((post) => post.createdAt), next: result.value.next }
      : null;
  }
}

function toImported(account: Account, post: XPostSummary, at: Instant): ImportedPost {
  return {
    xPostId: post.id,
    accountId: account.id,
    text: post.text,
    createdAt: post.createdAt,
    inReplyTo: post.inReplyTo,
    importedAt: at,
  };
}
