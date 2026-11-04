import type { BotActor } from "../../entities/identity/actor";
import { botId } from "../../entities/identity/ids";
import type { AccountOwners } from "../../use_cases/ports/account_owners";
import type { PersonRepository } from "../../use_cases/ports/person_repository";
import { tokenSha256 } from "../crypto/bot_token_issuer";

/** Bot tokens are ≥ 32 random bytes (plan §3.5): 43 characters in base64url, 64 in hex. */
export const MIN_TOKEN_LENGTH = 43;

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** The token from `Authorization: Bearer …` (xAI always sends the scheme, U9), or null. */
export function bearerToken(header: string | null): string | null {
  const token = header === null ? undefined : BEARER.exec(header)?.[1];
  return token === undefined || token.length < MIN_TOKEN_LENGTH ? null : token;
}

/**
 * Bot auth (GROKCHAT-16): the SHA-256 of the presented token, looked up among the people in D1,
 * then that person's accounts, both read on every request (nothing is cached), so assigning or
 * unassigning an account, a rotation or a delete applies from the next call. The actor's scope is
 * exactly those accounts, and its id is the person's (`bot:<person id>` in the audit).
 *
 * The lookup is an indexed equality on the hash, not a constant-time scan: a timing difference
 * could at most tell a caller something about the stored SHA-256, which does not reveal a token
 * of 256 random bits.
 */
export class BotAuthenticator {
  constructor(
    private readonly people: PersonRepository,
    private readonly owners: AccountOwners,
  ) {}

  async authenticate(token: string): Promise<BotActor | null> {
    const person = await this.people.findByTokenHash(await tokenSha256(token));
    if (person === null) {
      return null;
    }
    const accountIds = await this.owners.accountsOf(person.id);
    return { kind: "bot", scope: { botId: botId(person.id), accountIds } };
  }
}
