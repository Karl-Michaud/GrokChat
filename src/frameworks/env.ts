import type { AccountPublisher } from "./durable_objects/account_publisher";

/**
 * The Worker's bindings, as declared in wrangler.jsonc. Secrets and vars (plan §3.6) are added
 * here, and parsed at the boundary, by the PRs that first read them.
 */
export interface Env {
  readonly DB: D1Database;
  readonly ACCOUNT: DurableObjectNamespace<AccountPublisher>;
  readonly MEDIA: R2Bucket;
  // Secrets (`wrangler secret put`). Optional: a missing one fails closed where it is read.
  readonly X_CLIENT_SECRET?: string;
  readonly GROKCHAT_BOT_CLIENTS?: string;
  readonly GROKCHAT_TOKEN_KEYS?: string;
  readonly GROKCHAT_SESSION_SECRET?: string;
  readonly GROKCHAT_ADMIN_PASSWORD_HASH?: string;
  // Vars.
  /** Comma-separated host allowlist for `stage_media_from_url` (plan §3.5). */
  readonly GROKCHAT_MEDIA_HOSTS?: string;
}
