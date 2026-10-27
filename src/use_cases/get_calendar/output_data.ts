import type { Refusal } from "../access/refusal";
import type { PostView } from "../views/post_view";

/** Posts by publish time across every account (the dashboard calendar). */
export type GetCalendarOutputData =
  { readonly ok: true; readonly posts: readonly PostView[] } | Refusal<"human_only">;
