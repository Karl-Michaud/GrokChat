import type { AccountId } from "../../entities/identity/ids";
import type { BudgetMeter } from "../../use_cases/ports/budget_meter";
import type { Clock } from "../../use_cases/ports/clock";
import type { TokenProvider } from "../../use_cases/ports/token_provider";
import type { XTokenRefresher } from "../../use_cases/ports/x_token_refresher";
import type { XCallRecorder } from "../../use_cases/run_services/x_call_recorder";
import { RecordedXTokenRefresher, type Defer } from "../x_auth/recorded_oauth";
import { XTokenEndpoint } from "../x_auth/token_endpoint";
import type { XClientCredentials } from "../x_auth/x_oauth_config";
import { HttpXTokenRefresher } from "../x_auth/x_token_refresher_driver";
import { MeteredTransport } from "../x_http/metered_transport";
import type { HttpTransport } from "../x_http/transport";
import { XApiClient } from "../x_http/x_api_client";
import { HttpXMediaUploader, realWait, type Wait } from "../x_http/x_media_driver";
import { HttpXMetricsReader } from "../x_http/x_metrics_driver";
import { HttpXPublisher } from "../x_http/x_publisher_driver";
import { HttpXOwnTimelineReader } from "../x_http/x_timeline_driver";
import type { XUserDirectory } from "../x_http/x_user_directory";
import type { AccountXCalls, AccountXWiring } from "./account_services";

/** What the X drivers of one account's Durable Object share across its invocations. */
export interface HttpXWiringPorts {
  /** `FetchTransport` in production; fixtures in tests. Each invocation meters it. */
  readonly transport: HttpTransport;
  readonly credentials: XClientCredentials;
  /** Cost and audit for the token calls, which no run service records (plan §3.5, I5). */
  readonly recorder: XCallRecorder;
  readonly users: XUserDirectory;
  readonly clock: Clock;
  /** `ctx.waitUntil`: a refresh's record never stands between X's rotation and the store (A2). */
  readonly defer: Defer;
  readonly wait?: Wait;
}

/**
 * The fetch drivers from PR 4 as one account's Durable Object runs them (plan §3.5): per
 * invocation, one `MeteredTransport` around that invocation's meter is shared by the token
 * endpoint and the `XApiClient`, so every request X sees is one of its 50 external subrequests.
 * This factory names the drivers so the composition root stays a list of wirings (as `d1Stores`
 * does for D1).
 */
export class HttpXWiring implements AccountXWiring {
  constructor(private readonly ports: HttpXWiringPorts) {}

  refresher(account: AccountId, meter: BudgetMeter): XTokenRefresher {
    const { credentials, recorder, clock, defer } = this.ports;
    const endpoint = new XTokenEndpoint(this.metered(meter), credentials);
    const refresher = new HttpXTokenRefresher(endpoint, clock);
    return new RecordedXTokenRefresher(refresher, recorder, account, clock, defer);
  }

  calls(meter: BudgetMeter, tokens: TokenProvider): AccountXCalls {
    const { users, clock } = this.ports;
    const client = new XApiClient(this.metered(meter), tokens, meter);
    return {
      publisher: new HttpXPublisher(client),
      uploader: new HttpXMediaUploader(client, this.ports.wait ?? realWait),
      timeline: new HttpXOwnTimelineReader(client, users, clock),
      metrics: new HttpXMetricsReader(client, clock),
    };
  }

  private metered(meter: BudgetMeter): MeteredTransport {
    return new MeteredTransport(this.ports.transport, meter);
  }
}
