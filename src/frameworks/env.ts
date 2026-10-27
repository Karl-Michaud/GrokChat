import type { AccountPublisherObject } from "./durable_objects/account_publisher";

/**
 * The Worker's bindings, as declared in wrangler.jsonc. Secrets and vars (plan §3.6) are added
 * here, and parsed at the boundary, by the PRs that first read them.
 */
export interface Env {
  readonly DB: D1Database;
  readonly ACCOUNT: DurableObjectNamespace<AccountPublisherObject>;
  readonly MEDIA: R2Bucket;
  // Secrets (`wrangler secret put`). Optional ones fail closed where they are read.
  /**
   * The X app's OAuth 2.0 client (plan §3.6): parsed by x_auth/x_oauth_config.ts, for the connect
   * flow (`xOAuthConfig`) and the account DO's token refresh (`xClientCredentials`).
   */
  readonly X_CLIENT_ID?: string;
  readonly X_CLIENT_SECRET?: string;
  readonly GROKCHAT_BOT_CLIENTS?: string;
  /** Secret: comma-separated base64 AES-256 keys, newest first (plan §3.5 token vault). */
  readonly GROKCHAT_TOKEN_KEYS: string;
  /** Dashboard (PR 7): parsed by web/config.ts; the dashboard answers 503 until configured. */
  readonly GROKCHAT_SESSION_SECRET?: string;
  readonly GROKCHAT_ADMIN_PASSWORD_HASH?: string;
  // Vars.
  /** The Worker's public https origin: the dashboard's Origin check and the OAuth callback. */
  readonly GROKCHAT_PUBLIC_ORIGIN?: string;
  /** Comma-separated host allowlist for `stage_media_from_url` (plan §3.5). */
  readonly GROKCHAT_MEDIA_HOSTS?: string;
}
