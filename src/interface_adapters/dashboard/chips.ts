import type { AccountStatus } from "../../entities/accounts/account";
import { activityKindOf, type ActivityKind } from "../../entities/analytics/activity_kind";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { PartStateKind } from "../../entities/posts/part_state";

/**
 * Status tones (dataviz: good, warning, serious, critical are reserved for state), plus info for
 * work in progress and neutral for the rest. A chip always carries its label and icon too.
 */
export type Tone = "good" | "warning" | "serious" | "critical" | "info" | "neutral";

export interface Chip {
  readonly label: string;
  readonly tone: Tone;
}

const POST_STATUS: Readonly<Record<DerivedStatus, Chip>> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_REVIEW: { label: "Needs review", tone: "warning" },
  SCHEDULED: { label: "Scheduled", tone: "info" },
  RESUMING: { label: "Resuming", tone: "info" },
  PUBLISHING: { label: "Publishing", tone: "info" },
  PUBLISHED: { label: "Published", tone: "good" },
  PARTIALLY_PUBLISHED: { label: "Partly published", tone: "serious" },
  UNKNOWN_OUTCOME: { label: "Outcome unknown", tone: "serious" },
  NOT_FOUND: { label: "Not found on X", tone: "critical" },
  FAILED: { label: "Failed", tone: "critical" },
  MISSED: { label: "Missed", tone: "serious" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  DELETED: { label: "Deleted", tone: "neutral" },
  DELETE_INCOMPLETE: { label: "Delete incomplete", tone: "critical" },
};

export function postStatusChip(status: DerivedStatus): Chip {
  return POST_STATUS[status];
}

const PART_STATE: Readonly<Record<PartStateKind, Chip>> = {
  PENDING: { label: "Waiting", tone: "neutral" },
  SENDING: { label: "Sending", tone: "info" },
  SENT: { label: "On X", tone: "good" },
  UNKNOWN: { label: "Outcome unknown", tone: "serious" },
  NOT_FOUND: { label: "Not found on X", tone: "critical" },
  REJECTED: { label: "Rejected by X", tone: "critical" },
  DELETED: { label: "Deleted", tone: "neutral" },
};

/** One part's state, as a chip on the post page. */
export function partStateChip(state: PartStateKind): Chip {
  return PART_STATE[state];
}

const ACCOUNT_STATUS: Readonly<Record<AccountStatus, Chip>> = {
  ACTIVE: { label: "Active", tone: "good" },
  PAUSED: { label: "Paused", tone: "warning" },
  NEEDS_RECONNECT: { label: "Reconnect needed", tone: "critical" },
  DISCONNECTED: { label: "Disconnected", tone: "critical" },
};

export function accountStatusChip(status: AccountStatus): Chip {
  return ACCOUNT_STATUS[status];
}

const ACTIONS: Readonly<Record<string, string>> = {
  "post.create": "Created a post",
  "post.edit": "Edited a post",
  "post.cancel": "Cancelled a post",
  "post.approve": "Approved a post",
  "post.reject": "Rejected a post",
  "post.reschedule": "Rescheduled a post",
  "post.delete": "Deleted a post",
  "x.create": "Published on X",
  "x.delete": "Deleted on X",
  "x.media_upload": "Uploaded media to X",
  "x.read": "Read post metrics",
  "x.user_read": "Read follower count",
  "x.oauth": "Signed in to X",
  "account.connect": "Connected an account",
  "account.connect_begin": "Started connecting an account",
  "account.active": "Resumed an account",
  "account.paused": "Paused an account",
  "account.disclosure": "Updated the disclosure",
  "account.policy": "Updated the posting policy",
  "media.stage": "Staged media",
  "media.upload": "Uploaded media",
  "media.bot_upload": "Bot uploaded media",
  "media.delete": "Deleted media",
  "media.list": "Listed media",
  "media.view": "Viewed media",
  "session.login": "Logged in",
};

const REFUSED = "refused.";

/** "Created a post", "Refused: Edited a post"; an action not listed shows as its name. */
export function actionLabel(action: string): string {
  if (action.startsWith(REFUSED)) {
    return `Refused: ${actionLabel(action.slice(REFUSED.length))}`;
  }
  return ACTIONS[action] ?? action;
}

const KIND_TONES: Readonly<Record<ActivityKind, Tone>> = {
  posts: "info",
  publishing: "good",
  reads: "neutral",
  accounts: "info",
  refusals: "critical",
  media: "neutral",
  sessions: "neutral",
};

export function actionChip(action: string): Chip {
  const kind = activityKindOf(action);
  return { label: actionLabel(action), tone: kind === null ? "neutral" : KIND_TONES[kind] };
}
