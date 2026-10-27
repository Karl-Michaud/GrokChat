import type { Clock } from "../../use_cases/ports/clock";
import type { IdGenerator } from "../../use_cases/ports/id_generator";
import type { PkceGenerator, PkcePair } from "../../use_cases/ports/pkce_generator";
import { randomToken, toBase64Url } from "./base64url";

/** 128 random bits per id: unguessable, so an OAuth state or a post id cannot be guessed. */
export class RandomIds implements IdGenerator {
  newId(): string {
    return randomToken(16);
  }
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** RFC 7636: a 43-character verifier from 32 random bytes and its S256 challenge (U1). */
export class WebCryptoPkce implements PkceGenerator {
  async create(): Promise<PkcePair> {
    const verifier = randomToken(32);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
  }
}
