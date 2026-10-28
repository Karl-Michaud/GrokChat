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
  const points = [...name];
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

/** Up to two letters for the avatar: the first of the first two words ("Karl Michaud" → KM). */
export function personInitials(name: string): string {
  const words = name.split(" ").filter((word) => word.length > 0);
  const [first = "", second = ""] = words;
  const letters =
    second === ""
      ? [...first].slice(0, 2).join("")
      : `${[...first][0] ?? ""}${[...second][0] ?? ""}`;
  return letters.toUpperCase();
}
