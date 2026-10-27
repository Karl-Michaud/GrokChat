import { ALLOWED, refuse, type Decision } from "../decision";
import { MINUTE, type Millis } from "../time/instant";
import { isValidTimeZone } from "../time/zoned_time";

export type PublishMode = "AUTO" | "REVIEW";

/** Whether a post may carry a scheme URL (`https://…`), which X bills at $0.20 (U4). */
export type LinkPolicy = "ALLOW" | "REFUSE";

/** Local minutes of the day, `[startMinute, endMinute)`, wrapping past midnight when start > end. */
export interface QuietHours {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface PostingPolicy {
  readonly mode: PublishMode;
  readonly dailyCap: number;
  readonly minGap: Millis;
  readonly quietHours: QuietHours | null;
  readonly tz: string;
  readonly linkPolicy: LinkPolicy;
  readonly grace: Millis;
}

export type PolicyRefusal = "daily_cap" | "min_gap" | "quiet_hours" | "tz" | "grace";

/** A new account's policy: auto-publish, ten posts a day, no scheme URLs (they cost $0.20). */
export const DEFAULT_POLICY: PostingPolicy = {
  mode: "AUTO",
  dailyCap: 10,
  minGap: 30 * MINUTE,
  quietHours: null,
  tz: "UTC",
  linkPolicy: "REFUSE",
  grace: 30 * MINUTE,
};

const MINUTES_PER_DAY = 24 * 60;

function isMinuteOfDay(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY;
}

function validQuietHours(quiet: QuietHours | null): boolean {
  return (
    quiet === null ||
    (isMinuteOfDay(quiet.startMinute) &&
      isMinuteOfDay(quiet.endMinute) &&
      quiet.startMinute !== quiet.endMinute)
  );
}

export function validatePolicy(policy: PostingPolicy): Decision<PolicyRefusal> {
  if (!Number.isInteger(policy.dailyCap) || policy.dailyCap < 1) {
    return refuse("daily_cap");
  }
  if (!Number.isInteger(policy.minGap) || policy.minGap < 0) {
    return refuse("min_gap");
  }
  if (!validQuietHours(policy.quietHours)) {
    return refuse("quiet_hours");
  }
  if (!isValidTimeZone(policy.tz)) {
    return refuse("tz");
  }
  if (!Number.isInteger(policy.grace) || policy.grace < 0) {
    return refuse("grace");
  }
  return ALLOWED;
}

/** True when the local minute of the day falls inside the quiet hours (equal ends: never). */
export function inQuietHours(quiet: QuietHours, minute: number): boolean {
  if (quiet.startMinute <= quiet.endMinute) {
    return minute >= quiet.startMinute && minute < quiet.endMinute;
  }
  return minute >= quiet.startMinute || minute < quiet.endMinute;
}
