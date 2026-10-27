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
  readonly idempotency_key: string;
}

export interface CreateThreadArgs {
  readonly account_id: string;
  readonly parts: readonly PartArgs[];
  readonly publish_at?: string | undefined;
  readonly idempotency_key: string;
}

export interface StageMediaArgs {
  readonly account_id: string;
  readonly url: string;
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

export interface ComparePostsArgs extends AccountWindowArgs {
  readonly sort_by: MetricName;
}

/** Every tool's arguments, by tool name. */
export interface ToolArgs {
  readonly create_post: CreatePostArgs;
  readonly create_thread: CreateThreadArgs;
  readonly stage_media_from_url: StageMediaArgs;
  readonly edit_post: EditPostArgs;
  readonly cancel_post: PostArgs;
  readonly delete_post: PostArgs;
  readonly get_post: PostArgs;
  readonly list_backlog: ListBacklogArgs;
  readonly get_post_metrics: PostArgs;
  readonly get_account_metrics: AccountWindowArgs;
  readonly compare_posts: ComparePostsArgs;
  readonly get_personality: AccountArgs;
  readonly get_policy: AccountArgs;
}

export type ToolName = keyof ToolArgs;
