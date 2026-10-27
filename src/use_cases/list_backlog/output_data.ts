import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

export type ListBacklogOutputData =
  { readonly ok: true; readonly posts: readonly PostView[] } | Refusal<"scope">;
