import type { Instant } from "../../entities/time/instant";

export type LockResult<T> =
  { readonly acquired: true; readonly value: T } | { readonly acquired: false };

/** Waits for the lock until `deadline` (null: no limit), then runs `fn` holding it. */
export interface PublishLock {
  run<T>(fn: () => Promise<T>, deadline: Instant | null): Promise<LockResult<T>>;
}

export interface TokenLock {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Two non-reentrant async mutexes inside the account's Durable Object, always taken publish then
 * token; `token` covers only load → refresh → persist (plan §3.2, A1).
 */
export interface Locks {
  readonly publish: PublishLock;
  readonly token: TokenLock;
}
