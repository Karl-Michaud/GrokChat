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
    description: `Post one text (≤ 280 weighted characters) on your account's X profile, now or at publish_at. Attach up to 4 photos or 1 GIF by media_ids: from grokchat___upload_media for an image you made in your workspace, from grokchat___stage_media_from_url for a Grok image link (imgen.x.ai), or from grokchat___list_media for a file the owner uploaded on the dashboard's Media page. To reply, pass in_reply_to: the id or URL (https://x.com/<handle>/status/<id>) of a post this account already published through GrokChat. Reply only to your own account's posts: X refuses API replies under other people's posts, so any other target is refused with \`reply_target_not_own\`; draft a reply to someone else's post for the owner to post by hand instead. idempotency_key is required: retrying with the same key and content returns the same post instead of posting twice. Check limits first with grokchat___get_policy. Returns post_id and status (PUBLISHED, SCHEDULED, PENDING_REVIEW, …). ${REFUSALS}`,
  },
  create_thread: {
    ...WRITE,
    description: `Post a thread: parts are sent in order, each a reply to the one before; with in_reply_to (as in grokchat___create_post: only a post this account already published, never someone else's) the first part replies to that post, so the whole thread hangs under it (each part ≤ 280 weighted characters, up to 25 parts, media as in grokchat___create_post). idempotency_key is required, as for grokchat___create_post. ${REFUSALS}`,
  },
  stage_media_from_url: {
    ...WRITE,
    description: `Fetch a PNG, JPEG, WebP or GIF from an https URL on the allowed hosts and keep it for a post: for an image you generate with Grok, pass its imgen.x.ai link as it is (links expire after a few hours, so stage it right away). Returns media_id to pass in media_ids to grokchat___create_post or grokchat___create_thread. A host refusal (\`host_not_allowed\`) lists the allowed hosts in \`message\`. ${REFUSALS}`,
  },
  upload_media: {
    ...WRITE,
    description: `Upload a PNG, JPEG, WebP or GIF you made in your own workspace (a meme, a mascot) and keep it for a post: your sandbox has no network, so the bytes travel in this call. In your sandbox: compress a big image to JPEG first (photos ≤ 5 MB, GIFs ≤ 15 MB), compute the whole file's SHA-256 (hex) as sha256, base64 the file (standard alphabet with = padding) and cut the base64 into parts of at most 200,000 characters (cut at a multiple of 4 characters; each part decodes on its own). For each part send data_base64, part_sha256 (the SHA-256 hex of that part's decoded bytes), part_index (from 0), part_count and the same sha256 and account_id; label is optional (what to call it, ≤ 80 characters). A file of one part needs no part_index or part_count. The first part of several returns upload_id: pass it on every later part. Each answer lists missing_parts; the last one returns complete: true and media_id, to pass in media_ids to grokchat___create_post or grokchat___create_thread. \`part_hash_mismatch\` names the part whose bytes arrived garbled: resend only that part (resending a part is always safe). \`file_hash_mismatch\` means the parts did not make your file: start again without upload_id. Unfinished uploads expire after an hour. For a Grok image link (imgen.x.ai) use grokchat___stage_media_from_url instead. ${REFUSALS}`,
  },
  list_media: {
    ...READ,
    description: `An account's staged media, newest first: each item's media_id (pass it in media_ids to grokchat___create_post or grokchat___create_thread), label (what the owner called it on the dashboard, or a bot on grokchat___upload_media), content_type, bytes, uploaded_at, source (\`dashboard\` for an owner's upload, \`bot_upload\` for a file sent with grokchat___upload_media, else the URL's host), used (a post holds it) and expires_at (when unused media is deleted). status \`unused\` (the default) or \`all\`; limit 1 to 50 (default 20). When the owner says they uploaded a file, call it and use the matching media_id. ${REFUSALS}`,
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
    description: `One post: status, publish time, the X post it replies to (in_reply_to, null for an original post), and each part's text, state and X id. ${REFUSALS}`,
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
  list_accounts: {
    ...READ,
    description: `Your accounts: each one's account_id (every account-addressed tool takes it), handle, status (active, paused, or needs_reconnect: publishing refused until the owner reconnects it), mode (auto publishes at once, review waits for the owner's approval) and disclosure_complete. Call it first, and again whenever the owner says an account was added: the same token reaches every account assigned to you. ${REFUSALS}`,
  },
  get_policy: {
    ...READ,
    description: `An account's status, disclosure and posting policy: auto or review, daily cap, minimum gap, quiet hours, time zone and link policy (REFUSE: no https:// links). ${REFUSALS}`,
  },
};

export const TOOL_NAMES = Object.keys(TOOL_CATALOG) as readonly ToolName[];
