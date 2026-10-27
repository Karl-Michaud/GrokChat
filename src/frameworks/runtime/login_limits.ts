import { MINUTE } from "../../entities/time/instant";

/** Five failed logins per key in fifteen minutes (rev 4 M8), for the D1 throttle and its stub. */
export const LOGIN_FAILURES = 5;
export const LOGIN_WINDOW = 15 * MINUTE;
