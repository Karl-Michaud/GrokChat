/**
 * The tools' arguments as plain values, after the boundary schemas
 * (`interface_adapters/schemas/mcp_tool_schemas.ts`) have checked them. Names are the wire names.
 * Account-addressed tools take `account_id`; post-addressed tools only `post_id` (plan §3.4).
 */
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { MetricName } from "../../entities/metrics/metrics_snapshot";

export interface PartArgs {
  readonly text: string;
  readonly media_ids?: readonly string[] | undefined;
}

export interface CreatePostArgs {
  readonly account_id: string;
  readonly text: string;
  readonly media_ids?: readonly string[] | undefined;
  /** ISO 8601 with an offset or `Z`; absent: publish now. */
  readonly publish_at?: string | undefined;
  /** The X post to reply to: its id or its URL; absent: an original post. */
  readonly in_reply_to?: string | undefined;
  readonly idempotency_key: string;
}

export interface CreateThreadArgs {
  readonly account_id: string;
  readonly parts: readonly PartArgs[];
  readonly publish_at?: string | undefined;
  /** As for `create_post`: part 1 replies to this post, the rest chain under it. */
  readonly in_reply_to?: string | undefined;
  readonly idempotency_key: string;
}

export interface StageMediaArgs {
  readonly account_id: string;
  readonly url: string;
}

/**
 * upload_media (GROKCHAT-20): a file the bot made, whole or in parts. Hashes are SHA-256 hex;
 * `part_index` is from 0 (default 0) of `part_count` (default 1).
 */
export interface UploadMediaArgs {
  readonly account_id: string;
  readonly label?: string | undefined;
  readonly sha256: string;
  readonly data_base64: string;
  readonly part_sha256: string;
  readonly upload_id?: string | undefined;
  readonly part_index?: number | undefined;
  readonly part_count?: number | undefined;
}

export interface EditPostArgs {
  readonly post_id: string;
  readonly parts?: readonly PartArgs[] | undefined;
  readonly publish_at?: string | undefined;
}

export interface PostArgs {
  readonly post_id: string;
}

export interface ListBacklogArgs {
  readonly account_id?: string | undefined;
  readonly statuses?: readonly DerivedStatus[] | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface AccountArgs {
  readonly account_id: string;
}

export interface AccountWindowArgs {
  readonly account_id: string;
  readonly from: string;
  readonly to: string;
}

/** list_media (GROKCHAT-18): `unused` by default, at most 50. */
export interface ListMediaArgs {
  readonly account_id: string;
  readonly status?: "unused" | "all" | undefined;
  readonly limit?: number | undefined;
}

/** A tool that takes no argument (list_accounts): the caller is the whole input. */
export type NoArgs = Readonly<Record<string, never>>;

export interface ComparePostsArgs extends AccountWindowArgs {
  readonly sort_by: MetricName;
}

/** Every tool's arguments, by tool name. */
export interface ToolArgs {
  readonly create_post: CreatePostArgs;
  readonly create_thread: CreateThreadArgs;
  readonly stage_media_from_url: StageMediaArgs;
  readonly upload_media: UploadMediaArgs;
  readonly edit_post: EditPostArgs;
  readonly cancel_post: PostArgs;
  readonly delete_post: PostArgs;
  readonly get_post: PostArgs;
  readonly list_backlog: ListBacklogArgs;
  readonly get_post_metrics: PostArgs;
  readonly get_account_metrics: AccountWindowArgs;
  readonly compare_posts: ComparePostsArgs;
  readonly get_policy: AccountArgs;
  readonly list_accounts: NoArgs;
  readonly list_media: ListMediaArgs;
}

export type ToolName = keyof ToolArgs;
