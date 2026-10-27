import type { AccountPublisherObject } from "./durable_objects/account_publisher";

/**
 * The Worker's bindings, as declared in wrangler.jsonc. Secrets and vars (plan §3.6) are added
 * here, and parsed at the boundary, by the PRs that first read them.
 */
export interface Env {
  readonly DB: D1Database;
  readonly ACCOUNT: DurableObjectNamespace<AccountPublisherObject>;
  readonly MEDIA: R2Bucket;
  /** Secret: comma-separated base64 AES-256 keys, newest first (plan §3.5 token vault). */
  readonly GROKCHAT_TOKEN_KEYS: string;
}
