/**
 * What each tool tells a bot (plan §3.4). Grok shows our tools as `grokchat___<tool>` (U9), so the
 * descriptions name other tools that way. Every refusal comes back with `isError: true` and an
 * `error` code; times are ISO 8601 with an offset or `Z`.
 */
import type { ToolName } from "./tool_args";

export interface ToolInfo {
  readonly description: string;
  /** True for tools that change nothing (MCP `readOnlyHint`). */
  readonly readOnly: boolean;
  /** True for tools that remove something from X (MCP `destructiveHint`). */
  readonly destructive: boolean;
}

const WRITE: Pick<ToolInfo, "readOnly" | "destructive"> = { readOnly: false, destructive: false };
const READ: Pick<ToolInfo, "readOnly" | "destructive"> = { readOnly: true, destructive: false };

const REFUSALS =
  "A refusal returns isError with an `error` code (for example `scope` when the account is not yours).";

export const TOOL_CATALOG: Readonly<Record<ToolName, ToolInfo>> = {
  create_post: {
    ...WRITE,
    description: `Post one text (≤ 280 weighted characters) on your account's X profile, now or at publish_at. Attach up to 4 photos or 1 GIF by media_ids from grokchat___stage_media_from_url. idempotency_key is required: retrying with the same key and content returns the same post instead of posting twice. Check limits first with grokchat___get_policy. Returns post_id and status (PUBLISHED, SCHEDULED, PENDING_REVIEW, …). ${REFUSALS}`,
  },
  create_thread: {
    ...WRITE,
    description: `Post a thread: parts are sent in order, each a reply to the one before (each part ≤ 280 weighted characters, up to 25 parts, media as in grokchat___create_post). idempotency_key is required, as for grokchat___create_post. ${REFUSALS}`,
  },
  stage_media_from_url: {
    ...WRITE,
    description: `Fetch a PNG, JPEG, WebP or GIF from an https URL on the allowed hosts and keep it for a post. Returns media_id to pass in media_ids to grokchat___create_post or grokchat___create_thread. ${REFUSALS}`,
  },
  edit_post: {
    ...WRITE,
    description: `Change a post that has not started publishing: new parts (replacing all of them) and/or a new publish_at. Refused once any part was sent. ${REFUSALS}`,
  },
  cancel_post: {
    ...WRITE,
    description: `Cancel a post that has not started publishing; a thread that is part sent stops where it is. Nothing already on X is removed (use grokchat___delete_post for that). ${REFUSALS}`,
  },
  delete_post: {
    readOnly: false,
    destructive: true,
    description: `Delete a published post (every sent part of a thread, last first) from X. If a delete fails the post shows DELETE_INCOMPLETE and can be deleted again. ${REFUSALS}`,
  },
  get_post: {
    ...READ,
    description: `One post: status, publish time, and each part's text, state and X id. ${REFUSALS}`,
  },
  list_backlog: {
    ...READ,
    description: `Your posts, optionally for one account_id, some statuses, and a publish window [from, to). ${REFUSALS}`,
  },
  get_post_metrics: {
    ...READ,
    description: `The latest metrics of each sent part of a post (impressions, likes, reposts, replies, quotes, bookmarks). ${REFUSALS}`,
  },
  get_account_metrics: {
    ...READ,
    description: `An account's metric totals over the posts read in [from, to), with the series behind them. ${REFUSALS}`,
  },
  compare_posts: {
    ...READ,
    description: `An account's posts in [from, to), best first by sort_by, to see what works. ${REFUSALS}`,
  },
  get_policy: {
    ...READ,
    description: `An account's status, disclosure and posting policy: auto or review, daily cap, minimum gap, quiet hours, time zone and link policy (REFUSE: no https:// links). ${REFUSALS}`,
  },
};

export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as readonly ToolName[];
