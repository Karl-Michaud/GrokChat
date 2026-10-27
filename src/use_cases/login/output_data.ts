import type { Refusal } from "../access/refusal";

/** Never carries the password. */
export type LoginOutputData = { readonly ok: true } | Refusal<"throttled" | "wrong_password">;
