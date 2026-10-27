/** What a secret is replaced with. */
export const REDACTED = "[redacted]";

const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Removes every known secret (longest first, so a secret inside another goes too) and any bearer
 * credential from a string before it reaches the audit log, an error or a presenter (I6, m10).
 */
export function redact(text: string, secrets: readonly string[]): string {
  const ordered = secrets.filter((secret) => secret.length > 0).sort((a, b) => b.length - a.length);
  const replaced = ordered.reduce((current, secret) => current.split(secret).join(REDACTED), text);
  return replaced.replace(BEARER, `$1 ${REDACTED}`);
}
