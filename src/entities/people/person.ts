import type { AccountId, PersonId } from "../identity/ids";
import type { Instant } from "../time/instant";

/**
 * A person's bot token, as GrokChat keeps it (GROKCHAT-16): only the SHA-256 of the token, never
 * the token, and when it was generated (a rotation replaces both).
 */
export interface PersonToken {
  /** Lower-case hex, 64 characters. */
  readonly sha256: string;
  readonly createdAt: Instant;
}

/**
 * Someone who runs one Grok bot for their accounts (GROKCHAT-16). The person holds the token, so
 * assigning another account to the person widens the same token's scope: no reissue.
 */
export interface Person {
  readonly id: PersonId;
  readonly name: string;
  readonly createdAt: Instant;
  readonly token: PersonToken | null;
}

/** Which person an account belongs to: at most one each. */
export interface AccountOwnership {
  readonly accountId: AccountId;
  readonly personId: PersonId;
}

export const MAX_PERSON_NAME = 60;

/**
 * A person's name as stored: trimmed, inner whitespace collapsed to one space, 1 to 60 characters
 * (counted as code points), no control character. Null when the input cannot be a name.
 */
export function personName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  const points = Array.from(name);
  const control = points.some((point) => {
    const code = point.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
  return points.length === 0 || points.length > MAX_PERSON_NAME || control ? null : name;
}

/**
 * The key two names are compared under: ASCII letters folded to lower case and nothing else, as
 * SQLite's NOCASE collation on `people.name` folds them, so every repository agrees on clashes.
 */
export function nameKey(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

/**
 * Up to two letters for the avatar of a stored name (single-spaced): the first of its first two
 * words ("Karl Michaud" → KM), else its first two ("karl" → KA).
 */
export function personInitials(name: string): string {
  const [first = "", second = ""] = name.split(" ");
  const head = (word: string, count: number): string => Array.from(word).slice(0, count).join("");
  const letters = second === "" ? head(first, 2) : `${head(first, 1)}${head(second, 1)}`;
  return letters.toUpperCase();
}
