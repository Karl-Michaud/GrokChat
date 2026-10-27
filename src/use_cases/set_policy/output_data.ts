import type { PolicyRefusal } from "../../entities/accounts/posting_policy";
import type { AccountCommandResult } from "../admin/account_command";

export type SetPolicyOutputData = AccountCommandResult<PolicyRefusal>;
