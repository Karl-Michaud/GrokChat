/**
 * One view per tool (plan §3.4): how each use case's output data is shown to a bot. Refusals keep
 * the use case's code; the presenter adds `isError` and redacts every string.
 */
import type { CommandResult } from "../../use_cases/authoring/post_command";
import type { ComparePostsOutputData } from "../../use_cases/compare_posts/output_data";
import type { CreatePostOutputData } from "../../use_cases/create_post/output_data";
import type { DeletePostOutputData } from "../../use_cases/delete_post/output_data";
import type { GetAccountMetricsOutputData } from "../../use_cases/get_account_metrics/output_data";
import type { GetPolicyOutputData } from "../../use_cases/get_policy/output_data";
import type { GetPostMetricsOutputData } from "../../use_cases/get_post_metrics/output_data";
import type { GetPostOutputData } from "../../use_cases/get_post/output_data";
import type { ListBacklogOutputData } from "../../use_cases/list_backlog/output_data";
import type { StageMediaFromUrlOutputData } from "../../use_cases/stage_media_from_url/output_data";
import { disclosureJson, policyJson, postJson, snapshotJson } from "./json_views";
import type { ToolOutcome, ToolView } from "./tool_presenter";
import type { JsonObject } from "./tool_result";

const MICROS_PER_DOLLAR = 1_000_000;

interface Failure {
  readonly ok: false;
  readonly code: string;
  readonly part?: number | null;
}

/** The common shape: a refusal keeps its code (and part), a success is mapped by `body`. */
function either<Success extends { readonly ok: true }>(
  body: (success: Success) => JsonObject,
): ToolView<Success | Failure> {
  return (output): ToolOutcome =>
    output.ok
      ? { ok: true, body: body(output) }
      : { ok: false, code: output.code, part: output.part ?? null };
}

export const createPostView: ToolView<CreatePostOutputData> = either((created) => ({
  post_id: created.postId,
  status: created.status,
  estimated_cost_usd: created.estimatedCostMicros / MICROS_PER_DOLLAR,
  duplicate: created.duplicate,
}));

export const stageMediaView: ToolView<StageMediaFromUrlOutputData> = either((staged) => ({
  media_id: staged.mediaId,
  kind: staged.kind,
  size_bytes: staged.size,
}));

/** edit_post and cancel_post: the post as it now stands. */
export const postCommandView: ToolView<CommandResult<string>> = either((done) => ({
  post: postJson(done.post),
}));

export const deletePostView: ToolView<DeletePostOutputData> = either((done) => ({
  post: postJson(done.post),
  deleted: done.deleted,
  incomplete: done.incomplete,
}));

export const getPostView: ToolView<GetPostOutputData> = either((found) => ({
  post: postJson(found.post),
}));

export const listBacklogView: ToolView<ListBacklogOutputData> = either((listed) => ({
  posts: listed.posts.map(postJson),
}));

export const postMetricsView: ToolView<GetPostMetricsOutputData> = either((found) => ({
  post_id: found.postId,
  parts: found.parts.map(snapshotJson),
}));

export const accountMetricsView: ToolView<GetAccountMetricsOutputData> = either((found) => ({
  account_id: found.accountId,
  posts: found.posts,
  totals: { ...found.totals },
  series: found.series.map(snapshotJson),
}));

export const comparePostsView: ToolView<ComparePostsOutputData> = either((found) => ({
  ranked: found.ranked.map(snapshotJson),
}));

export const policyView: ToolView<GetPolicyOutputData> = either((found) => ({
  account_id: found.accountId,
  handle: found.handle,
  status: found.status,
  disclosure: disclosureJson(found.disclosure),
  policy: policyJson(found.policy),
}));
