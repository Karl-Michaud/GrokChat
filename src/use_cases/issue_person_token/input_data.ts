import type { Actor } from "../../entities/identity/actor";
import type { PersonId } from "../../entities/identity/ids";
import type { Instant } from "../../entities/time/instant";

/**
 * The token the form was shown with: when it was set, or null for none. A token is issued only
 * while the person's token is still that one, so a reload that re-sends the form after the token
 * changed never rotates it again (GROKCHAT-18). `null` here (no expectation sent) never issues.
 */
export interface ExpectedToken {
  readonly createdAt: Instant | null;
}

/** A new token for a person: generate, or rotate (the old one stops working). */
export interface IssuePersonTokenInputData {
  readonly actor: Actor;
  readonly personId: PersonId;
  readonly expected: ExpectedToken | null;
}
