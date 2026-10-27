/** X's OAuth 2.0 endpoints and the scopes GrokChat asks for (U1, `docs/spikes/spike-x-oauth/`). */
export const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const SCOPES = ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"];

/** The X app's confidential-client credentials and the Worker's callback (plan §3.5, §3.6). */
export interface XOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** The callback route behind the admin session (plan §3.5 "OAuth connect"). */
export const CALLBACK_PATH = "/oauth/x/callback";

/** The secret and var names this config is read from (plan §3.6). */
export interface XOAuthEnv {
  readonly X_CLIENT_ID?: string;
  readonly X_CLIENT_SECRET?: string;
  readonly GROKCHAT_PUBLIC_ORIGIN?: string;
}

/**
 * Parses the config at the boundary and fails loudly by name (never by value) when a secret is
 * missing or the origin is not an https origin.
 */
export function xOAuthConfig(env: XOAuthEnv): XOAuthConfig {
  const read = (name: keyof XOAuthEnv): string => env[name] ?? "";
  const names = ["X_CLIENT_ID", "X_CLIENT_SECRET", "GROKCHAT_PUBLIC_ORIGIN"] as const;
  const missing = names.filter((name) => read(name) === "");
  if (missing.length > 0) {
    throw new Error(`missing configuration: ${missing.join(", ")}`);
  }
  const publicOrigin = read("GROKCHAT_PUBLIC_ORIGIN");
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.origin !== publicOrigin) {
    throw new Error("GROKCHAT_PUBLIC_ORIGIN must be an https origin, without a path");
  }
  return {
    clientId: read("X_CLIENT_ID"),
    clientSecret: read("X_CLIENT_SECRET"),
    redirectUri: `${origin.origin}${CALLBACK_PATH}`,
  };
}
