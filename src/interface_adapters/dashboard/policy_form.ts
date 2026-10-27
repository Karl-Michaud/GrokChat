import type {
  LinkPolicy,
  PostingPolicy,
  PublishMode,
  QuietHours,
} from "../../entities/accounts/posting_policy";
import { MINUTE } from "../../entities/time/instant";
import { filled, formatClock, parseClock, parseMinutes, parseWhole } from "./form_values";

/** The policy form's fields, as the page shows them and the browser sends them back. */
export interface PolicyForm {
  readonly mode: string;
  readonly dailyCap: string;
  readonly minGapMinutes: string;
  readonly quietStart: string;
  readonly quietEnd: string;
  readonly tz: string;
  readonly linkPolicy: string;
  readonly graceMinutes: string;
}

export function policyForm(policy: PostingPolicy): PolicyForm {
  return {
    mode: policy.mode,
    dailyCap: String(policy.dailyCap),
    minGapMinutes: String(policy.minGap / MINUTE),
    quietStart: policy.quietHours === null ? "" : formatClock(policy.quietHours.startMinute),
    quietEnd: policy.quietHours === null ? "" : formatClock(policy.quietHours.endMinute),
    tz: policy.tz,
    linkPolicy: policy.linkPolicy,
    graceMinutes: String(policy.grace / MINUTE),
  };
}

const MODES: readonly PublishMode[] = ["AUTO", "REVIEW"];
const LINK_POLICIES: readonly LinkPolicy[] = ["ALLOW", "REFUSE"];

function quietHours(form: PolicyForm): QuietHours | null | "invalid" {
  const start = filled(form.quietStart);
  const end = filled(form.quietEnd);
  if (start === null && end === null) {
    return null;
  }
  if (start === null || end === null) {
    return "invalid";
  }
  const startMinute = parseClock(start);
  const endMinute = parseClock(end);
  return startMinute === null || endMinute === null ? "invalid" : { startMinute, endMinute };
}

/**
 * The form as a policy, or the message for the first field that is not even of the right shape;
 * the ranges (cap ≥ 1, distinct quiet hours, a known time zone) are the use case's to refuse.
 */
export function parsePolicyForm(form: PolicyForm): PostingPolicy | { readonly message: string } {
  const mode = MODES.find((value) => value === form.mode);
  const linkPolicy = LINK_POLICIES.find((value) => value === form.linkPolicy);
  const dailyCap = parseWhole(form.dailyCap);
  const minGap = parseMinutes(form.minGapMinutes);
  const grace = parseMinutes(form.graceMinutes);
  const quiet = quietHours(form);
  if (mode === undefined || linkPolicy === undefined) {
    return { message: "Choose a mode and a link policy." };
  }
  if (dailyCap === null || minGap === null || grace === null) {
    return { message: "The cap, the gap and the grace must be whole numbers." };
  }
  if (quiet === "invalid") {
    return { message: "Quiet hours must be two HH:MM times, or both empty." };
  }
  return { mode, dailyCap, minGap, quietHours: quiet, tz: form.tz.trim(), linkPolicy, grace };
}
