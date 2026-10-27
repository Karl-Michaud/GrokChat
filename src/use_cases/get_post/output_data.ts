import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

export type GetPostOutputData =
  { readonly ok: true; readonly post: PostView } | Refusal<"not_found" | "scope">;
