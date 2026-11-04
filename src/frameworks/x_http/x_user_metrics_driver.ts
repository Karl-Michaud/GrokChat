import type { AccountId } from "../../entities/identity/ids";
import type { UserPublicMetrics } from "../../entities/metrics/follower_snapshot";
import type { XResult } from "../../entities/x/x_failure";
import type { XUserMetricsReader } from "../../use_cases/ports/x_user_metrics_reader";
import { count, field } from "./json_fields";
import type { XApiClient } from "./x_api_client";
import type { XUserDirectory } from "./x_user_directory";

function publicMetrics(body: unknown): UserPublicMetrics | null {
  const metrics = field(field(body, "data"), "public_metrics");
  const followers = count(field(metrics, "followers_count"));
  if (followers === null) {
    return null;
  }
  return {
    followers,
    following: count(field(metrics, "following_count")) ?? 0,
    posts: count(field(metrics, "tweet_count")) ?? 0,
    listed: count(field(metrics, "listed_count")) ?? 0,
  };
}

/**
 * `GET /2/users/:id?user.fields=public_metrics` (docs.x.com get-users-by-id), the account's own
 * user: one User read, $0.010 (GROKCHAT-15). An account with no known X user is not sent; a 2xx
 * body with no follower count reached X, so it is a `no_response`, never a retry for free.
 */
export class HttpXUserMetricsReader implements XUserMetricsReader {
  constructor(
    private readonly client: XApiClient,
    private readonly users: XUserDirectory,
  ) {}

  async read(account: AccountId): Promise<XResult<UserPublicMetrics>> {
    const user = await this.users.xUserIdOf(account);
    if (user === null) {
      return { ok: false, failure: { kind: "not_sent" } };
    }
    const result = await this.client.call(account, {
      method: "GET",
      path: `/2/users/${encodeURIComponent(user)}`,
      query: { "user.fields": "public_metrics" },
    });
    if (!result.ok) {
      return result;
    }
    const metrics = publicMetrics(result.value);
    return metrics === null
      ? { ok: false, failure: { kind: "no_response" } }
      : { ok: true, value: metrics };
  }
}
