import type { AccountMetricsCollector } from "../../use_cases/ports/account_metrics_collector";
import type { AccountPublisher } from "../../use_cases/ports/account_publisher";
import type { AccountReconciler } from "../../use_cases/ports/account_reconciler";
import type { AccountXGateway } from "../../use_cases/ports/account_x_gateway";
import type { TokenProvider } from "../../use_cases/ports/token_provider";
import type { XMediaUploader } from "../../use_cases/ports/x_media_uploader";
import type { XMetricsReader } from "../../use_cases/ports/x_metrics_reader";
import type { XOwnTimelineReader } from "../../use_cases/ports/x_own_timeline_reader";
import type { XPublisher } from "../../use_cases/ports/x_publisher";
import type { XTokenRefresher } from "../../use_cases/ports/x_token_refresher";

/** The X drivers an account's Durable Object calls; tokens are fetched inside it (A1). */
export interface AccountXPorts {
  readonly publisher: XPublisher;
  readonly uploader: XMediaUploader;
  readonly timeline: XOwnTimelineReader;
  readonly metrics: XMetricsReader;
  readonly refresher: XTokenRefresher;
}

/**
 * The use cases an account's Durable Object hosts (plan §3.5), as the composition root builds them
 * (`buildAccountServices` in main.ts, m6). Each publish, reconcile and metrics call gets its own
 * invocation budget, as each DO invocation has its own (U16).
 */
export interface AccountServices {
  readonly publisher: AccountPublisher;
  readonly reconciler: AccountReconciler;
  readonly collector: AccountMetricsCollector;
  readonly gateway: AccountXGateway;
  /** The provider the publish code takes tokens from, under the token lock. */
  readonly tokens: TokenProvider;
}
