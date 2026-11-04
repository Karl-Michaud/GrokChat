import type { LockResult, Locks, PublishLock, TokenLock } from "../../use_cases/ports/locks";

/** No lock at all: the negative control that proves the concurrency tests can fail. */
export class NoLocks implements Locks {
  readonly publish: PublishLock = {
    run: async <T>(fn: () => Promise<T>): Promise<LockResult<T>> => ({
      acquired: true,
      value: await fn(),
    }),
  };
  readonly token: TokenLock = { run: <T>(fn: () => Promise<T>): Promise<T> => fn() };
}
