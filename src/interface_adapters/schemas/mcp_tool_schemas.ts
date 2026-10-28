/**
 * The MCP tools' input schemas (plan §3.4: zod at the boundary only). They check shape and size;
 * the use cases check meaning (weighted length, media ownership, scope) and refuse with codes.
 */
import { z } from "zod";
import { MAX_PHOTOS, MAX_THREAD_PARTS } from "../../entities/content/post_part";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import { METRIC_NAMES } from "../../entities/metrics/metrics_snapshot";
import type { ToolArgs, ToolName } from "../mcp/tool_args";

/** Long enough for any id GrokChat hands out, short enough to refuse junk. */
const id = z.string().min(1).max(128);
/** 280 weighted characters can be longer raw (a URL counts as 23), so this is only a size cap. */
const text = z.string().max(4_000);
const mediaIds = z.array(id).max(MAX_PHOTOS).optional();
/** An X post id or a post URL; the use case checks which (`reply_target_invalid`). */
const replyTarget = z.string().min(1).max(512).optional();
/** A time without an offset is ambiguous and refused (m5). */
const time = z.iso.datetime({ offset: true });

const DERIVED_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "SCHEDULED",
  "RESUMING",
  "PUBLISHING",
  "CANCELLED",
  "MISSED",
  "PUBLISHED",
  "PARTIALLY_PUBLISHED",
  "UNKNOWN_OUTCOME",
  "NOT_FOUND",
  "FAILED",
  "DELETED",
  "DELETE_INCOMPLETE",
] as const satisfies readonly DerivedStatus[];

/** Fails to compile if a derived status is missing from the list above. */
type Missing = Exclude<DerivedStatus, (typeof DERIVED_STATUSES)[number]>;
export const EVERY_STATUS_LISTED: Missing extends never ? true : never = true;

const part = z.object({ text, media_ids: mediaIds });
const parts = z.array(part).min(1).max(MAX_THREAD_PARTS);
const postOnly = z.object({ post_id: id });
const accountOnly = z.object({ account_id: id });
const accountWindow = z.object({ account_id: id, from: time, to: time });

export const TOOL_SCHEMAS = {
  create_post: z.object({
    account_id: id,
    text,
    media_ids: mediaIds,
    publish_at: time.optional(),
    in_reply_to: replyTarget,
    idempotency_key: id,
  }),
  create_thread: z.object({
    account_id: id,
    parts,
    publish_at: time.optional(),
    in_reply_to: replyTarget,
    idempotency_key: id,
  }),
  stage_media_from_url: z.object({ account_id: id, url: z.string().min(1).max(2_048) }),
  edit_post: z.object({ post_id: id, parts: parts.optional(), publish_at: time.optional() }),
  cancel_post: postOnly,
  delete_post: postOnly,
  get_post: postOnly,
  list_backlog: z.object({
    account_id: id.optional(),
    statuses: z.array(z.enum(DERIVED_STATUSES)).optional(),
    from: time.optional(),
    to: time.optional(),
  }),
  get_post_metrics: postOnly,
  get_account_metrics: accountWindow,
  compare_posts: accountWindow.extend({
    sort_by: z.enum(METRIC_NAMES),
  }),
  get_policy: accountOnly,
  list_accounts: z.object({}),
} satisfies { readonly [K in ToolName]: z.ZodType<ToolArgs[K]> };
