import type { AccountPublisher } from "./durable_objects/account_publisher";

/**
 * The Worker's bindings, as declared in wrangler.jsonc. Secrets and vars (plan §3.6) are added
 * here, and parsed at the boundary, by the PRs that first read them.
 */
export interface Env {
  readonly DB: D1Database;
  readonly ACCOUNT: DurableObjectNamespace<AccountPublisher>;
  readonly MEDIA: R2Bucket;
}
