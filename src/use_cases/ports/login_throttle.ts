import type { Instant } from "../../entities/time/instant";

/** Failed dashboard logins per key (IP, and a global key), rev 4 M8. */
export interface LoginThrottle {
  allow(key: string, now: Instant): Promise<boolean>;
  recordFailure(key: string, now: Instant): Promise<void>;
}
