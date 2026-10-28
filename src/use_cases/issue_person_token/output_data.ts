import type { Account } from "../../entities/accounts/account";
import type { Person } from "../../entities/people/person";
import type { Refusal } from "../access/refusal";
/**
 * The token, exactly once: the presenter shows it and nothing keeps it. `accounts` are the
 * person's, for the setup prompt.
 */
export type IssuePersonTokenOutputData =
  | {
      readonly ok: true;
      readonly person: Person;
      readonly token: string;
      readonly rotated: boolean;
      readonly accounts: readonly Account[];
    }
  | Refusal<"human_only" | "not_found">;
