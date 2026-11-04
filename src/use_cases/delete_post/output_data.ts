import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

export type DeletePostOutputData =
  | {
      readonly ok: true;
      readonly post: PostView;
      readonly deleted: number;
      /** A delete failed: the post shows "delete incomplete" and can be deleted again. */
      readonly incomplete: boolean;
    }
  | Refusal<"not_found" | "scope" | "not_deletable" | "version_conflict">;
