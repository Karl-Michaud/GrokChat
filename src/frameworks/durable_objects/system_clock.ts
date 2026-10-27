import type { Instant } from "../../entities/time/instant";
import type { Clock } from "../../use_cases/ports/clock";
import type { DeadlineTimer, DeadlineWait } from "../memory/memory_locks";

/**
 * The Workers clock. Inside a request it advances only across I/O (a timer counts), which is all
 * the code needs. Its deadline waits are real timers, so a lock waiter gives up on time.
 */
export class SystemClock implements Clock, DeadlineTimer {
  now(): Instant {
    return Date.now();
  }

  after(deadline: Instant): DeadlineWait {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const passed = new Promise<void>((resolve) => {
      const check = (): void => {
        const left = deadline - Date.now();
        if (left < 0) {
          resolve();
        } else {
          timer = setTimeout(check, left + 1);
        }
      };
      check();
    });
    return {
      passed,
      cancel: () => {
        if (timer !== null) {
          clearTimeout(timer);
        }
      },
    };
  }
}
