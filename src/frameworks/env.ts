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
  readonly X_CLIENT_SECRET?: string;
  readonly GROKCHAT_BOT_CLIENTS?: string;
  /** Secret: comma-separated base64 AES-256 keys, newest first (plan §3.5 token vault). */
  readonly GROKCHAT_TOKEN_KEYS: string;
  readonly GROKCHAT_SESSION_SECRET?: string;
  readonly GROKCHAT_ADMIN_PASSWORD_HASH?: string;
  // Vars.
  /** Comma-separated host allowlist for `stage_media_from_url` (plan §3.5). */
  readonly GROKCHAT_MEDIA_HOSTS?: string;
}
