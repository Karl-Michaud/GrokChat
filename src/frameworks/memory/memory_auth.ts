import type { Instant } from "../../entities/time/instant";
import type { LoginThrottle } from "../../use_cases/ports/login_throttle";
import type { OAuthState, OAuthStateStore } from "../../use_cases/ports/oauth_state_store";
import type { PkceGenerator, PkcePair } from "../../use_cases/ports/pkce_generator";
import type { ConnectedXUser, XAccountConnector } from "../../use_cases/ports/x_account_connector";
import { LOGIN_FAILURES, LOGIN_WINDOW } from "../runtime/login_limits";

export class MemoryOAuthStateStore implements OAuthStateStore {
  readonly records = new Map<string, OAuthState>();

  put(record: OAuthState): Promise<void> {
    this.records.set(record.state, record);
    return Promise.resolve();
  }

  take(state: string, sessionId: string, now: Instant): Promise<string | null> {
    const record = this.records.get(state);
    this.records.delete(state);
    const valid = record?.sessionId === sessionId && now < record.expiresAt;
    return Promise.resolve(valid ? record.verifier : null);
  }
}

export class MemoryLoginThrottle implements LoginThrottle {
  readonly failures = new Map<string, Instant[]>();

  allow(key: string, now: Instant): Promise<boolean> {
    const recent = (this.failures.get(key) ?? []).filter((at) => now - at < LOGIN_WINDOW);
    return Promise.resolve(recent.length < LOGIN_FAILURES);
  }

  recordFailure(key: string, now: Instant): Promise<void> {
    this.failures.set(key, [...(this.failures.get(key) ?? []), now]);
    return Promise.resolve();
  }
}

export class SequentialPkce implements PkceGenerator {
  private next = 0;

  create(): Promise<PkcePair> {
    this.next += 1;
    return Promise.resolve({
      verifier: `verifier-${String(this.next)}`,
      challenge: `challenge-${String(this.next)}`,
    });
  }
}

/** Exchanges a code for the user it was issued to, once, and only with the matching verifier. */
export class StubXAccountConnector implements XAccountConnector {
  readonly codes = new Map<string, { readonly verifier: string; readonly user: ConnectedXUser }>();

  authorizeUrl(state: string, codeChallenge: string): string {
    return `https://x.com/i/oauth2/authorize?state=${state}&code_challenge=${codeChallenge}`;
  }

  complete(code: string, verifier: string): Promise<ConnectedXUser | null> {
    const issued = this.codes.get(code);
    this.codes.delete(code);
    return Promise.resolve(issued?.verifier === verifier ? issued.user : null);
  }
}
