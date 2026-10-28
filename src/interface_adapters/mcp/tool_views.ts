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
import type { ListMediaOutputData, MediaListing } from "../../use_cases/list_media/output_data";
import type { ListOwnAccountsOutputData } from "../../use_cases/list_own_accounts/output_data";
import type { StageMediaFromUrlOutputData } from "../../use_cases/stage_media_from_url/output_data";
import type {
  HashMismatch,
  UploadedMedia,
  UploadInProgress,
  UploadMediaOutputData,
} from "../../use_cases/upload_media/output_data";
import { MAX_PART_BYTES, MAX_UPLOAD_PARTS } from "../../entities/media/upload_parts";
import type { AccountStatus } from "../../entities/accounts/account";
import { disclosureComplete } from "../../entities/accounts/account";
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

/**
 * What a bot is told when a URL's host is refused (GROKCHAT-18): the allowed hosts (config, not a
 * secret), or plainly that none is, and where a file the owner has goes instead.
 */
export function hostRefusalMessage(allowedHosts: readonly string[]): string {
  const upload =
    "For a file the owner has, ask them to upload it on the GrokChat dashboard's Media page, then find its media_id with grokchat___list_media.";
  return allowedHosts.length === 0
    ? `No media host is allowed: GROKCHAT_MEDIA_HOSTS is empty, so every URL is refused. ${upload}`
    : `The URL's host is not allowed. Allowed hosts: ${allowedHosts.join(", ")}. ${upload}`;
}

const stagedView = either((staged: StageMediaFromUrlOutputData & { readonly ok: true }) => ({
  media_id: staged.mediaId,
  kind: staged.kind,
  size_bytes: staged.size,
}));

export const stageMediaView: ToolView<StageMediaFromUrlOutputData> = (output) =>
  !output.ok && output.code === "host_not_allowed"
    ? { ok: false, code: output.code, message: hostRefusalMessage(output.allowedHosts) }
    : stagedView(output);

/** What a bot is told for the upload refusals it can act on (GROKCHAT-20); the rest: the code. */
function uploadMessage(output: UploadMediaOutputData & { readonly ok: false }): string | null {
  if (output.code === "part_hash_mismatch" || output.code === "file_hash_mismatch") {
    const { expected, actual } = output as HashMismatch<typeof output.code>;
    return output.code === "part_hash_mismatch"
      ? `Part ${String(output.part)} decodes to bytes whose SHA-256 is ${actual}, not the part_sha256 you sent (${expected}). Resend only part ${String(output.part)}, with the same upload_id.`
      : `Every part arrived, but the file they make has SHA-256 ${actual}, not the sha256 you sent (${expected}). The upload was discarded: check the parts' order and the file's hash, then start again without upload_id.`;
  }
  return UPLOAD_MESSAGES[output.code] ?? null;
}

const UPLOAD_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  bad_base64:
    "data_base64 is not standard base64 (A-Z, a-z, 0-9, +, /, = padding at the end; line breaks are ignored). Resend this part.",
  part_too_large: `A part may hold at most ${String(MAX_PART_BYTES)} bytes once decoded: split the file into more parts.`,
  part_out_of_range: `part_index runs from 0 to part_count - 1, and part_count from 1 to ${String(MAX_UPLOAD_PARTS)}.`,
  upload_not_found: "No such upload for this account: start again without upload_id.",
  upload_expired:
    "The upload expired (an hour after its first part) and its parts were deleted: start again without upload_id.",
  upload_mismatch:
    "This upload_id was opened with another sha256 or part_count: send the same values on every part.",
};

const uploadedView = (output: UploadedMedia | UploadInProgress): JsonObject =>
  output.complete
    ? {
        complete: true,
        media_id: output.mediaId,
        kind: output.kind,
        size_bytes: output.size,
        upload_id: output.uploadId,
      }
    : { complete: false, upload_id: output.uploadId, missing_parts: [...output.missing] };

export const uploadMediaView: ToolView<UploadMediaOutputData> = (output) => {
  if (output.ok) {
    return { ok: true, body: uploadedView(output) };
  }
  const part = "part" in output ? output.part : null;
  const message = uploadMessage(output);
  return message === null
    ? { ok: false, code: output.code, part }
    : { ok: false, code: output.code, part, message };
};

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

/** A bot's view of an account's status: DISCONNECTED and NEEDS_RECONNECT both need the owner. */
const STATUS_WORDS: Readonly<Record<AccountStatus, string>> = {
  ACTIVE: "active",
  PAUSED: "paused",
  NEEDS_RECONNECT: "needs_reconnect",
  DISCONNECTED: "needs_reconnect",
};

export const listAccountsView: ToolView<ListOwnAccountsOutputData> = either((listed) => ({
  accounts: listed.accounts.map((account) => ({
    account_id: account.id,
    handle: account.handle,
    status: STATUS_WORDS[account.status],
    mode: account.policy.mode === "AUTO" ? "auto" : "review",
    disclosure_complete: disclosureComplete(account.disclosure),
  })),
}));

const iso = (at: number): string => new Date(at).toISOString();

function mediaJson({ media, used, expiresAt }: MediaListing): JsonObject {
  return {
    media_id: media.id,
    label: media.label,
    content_type: media.contentType,
    bytes: media.size,
    uploaded_at: iso(media.stagedAt),
    source: media.source.kind === "url" ? media.source.host : media.source.kind,
    used,
    expires_at: expiresAt === null ? null : iso(expiresAt),
  };
}

export const listMediaView: ToolView<ListMediaOutputData> = either((listed) => ({
  account_id: listed.accountId,
  media: listed.items.map(mediaJson),
}));
