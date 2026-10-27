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
  /** Dashboard (PR 7): secrets, then a var; parsed by web/config.ts, absent until configured. */
  readonly GROKCHAT_SESSION_SECRET?: string;
  readonly GROKCHAT_ADMIN_PASSWORD_HASH?: string;
  readonly GROKCHAT_PUBLIC_ORIGIN?: string;
  /** Secrets: the X app's OAuth 2.0 client (plan §3.6); parsed by x_auth/x_oauth_config.ts. */
  readonly X_CLIENT_ID?: string;
  readonly X_CLIENT_SECRET?: string;
}
