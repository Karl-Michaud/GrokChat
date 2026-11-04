import type { Refusal } from "../access/refusal";

export type GetMediaFileOutputData =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly contentType: string }
  | Refusal<"not_found" | "human_only" | "media_quota">;
