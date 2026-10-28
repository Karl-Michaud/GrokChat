import type { PostId } from "../../entities/identity/ids";
import type { DerivedStatus } from "../../entities/posts/derived_status";
import type { PartsRefusalCode } from "../authoring/parts_validator";

export type CreatePostRefusalCode =
  | "not_found"
  | "scope"
  | "idempotency_key_required"
  | "idempotency_mismatch"
  | "publish_at_past"
  | PartsRefusalCode;

export type CreatePostOutputData =
  | {
      readonly ok: true;
      readonly postId: PostId;
      readonly status: DerivedStatus;
      /** The estimate in micro-dollars: $0.015 a part, $0.20 with a scheme URL (U4). */
      readonly estimatedCostMicros: number;
      /** True when an earlier create with the same key and request is returned. */
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly code: CreatePostRefusalCode; readonly part: number | null };
