import type { BotActor } from "../../entities/identity/actor";
import { accountId, botId } from "../../entities/identity/ids";
import type { BotClientEntry } from "../../interface_adapters/schemas/bot_clients_schema";

/** Bot tokens are ≥ 32 random bytes (plan §3.5): 43 characters in base64url, 64 in hex. */
export const MIN_TOKEN_LENGTH = 43;

const BEARER = /^Bearer\s+(\S+)\s*$/i;

/** The token from `Authorization: Bearer …` (xAI always sends the scheme, U9), or null. */
export function bearerToken(header: string | null): string | null {
  const token = header === null ? undefined : BEARER.exec(header)?.[1];
  return token === undefined || token.length < MIN_TOKEN_LENGTH ? null : token;
}

function hexBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

interface Client {
  readonly entry: BotClientEntry;
  readonly digest: Uint8Array;
}

/**
 * Bot auth (plan §3.5): the SHA-256 of the presented token is compared with **every** entry's
 * hash with `crypto.subtle.timingSafeEqual`, with no early exit, so the time taken does not say
 * which entry (if any) matched. The actor's scope is exactly the entry's account ids: an account
 * not listed is refused by every interactor (fail closed).
 */
export class BotAuthenticator {
  private readonly clients: readonly Client[];

  constructor(entries: readonly BotClientEntry[]) {
    this.clients = entries.map((entry) => ({ entry, digest: hexBytes(entry.tokenSha256) }));
  }

  async authenticate(token: string): Promise<BotActor | null> {
    const presented = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    );
    let match: BotClientEntry | null = null;
    for (const client of this.clients) {
      const equal = crypto.subtle.timingSafeEqual(presented, client.digest);
      match = equal ? client.entry : match;
    }
    return match === null ? null : actorOf(match);
  }
}

function actorOf(entry: BotClientEntry): BotActor {
  return {
    kind: "bot",
    scope: { botId: botId(entry.id), accountIds: entry.accounts.map(accountId) },
  };
}
