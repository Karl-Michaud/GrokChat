import type { Refusal } from "../access/refusal";

export type ConnectAccountBeginOutputData =
  { readonly ok: true; readonly authorizeUrl: string } | Refusal<"human_only">;
