import type { AuditListInputData } from "../../use_cases/audit_list/input_data";
import type { AuditListOutputData } from "../../use_cases/audit_list/output_data";
import type { CancelPostInputData } from "../../use_cases/cancel_post/input_data";
import type { CancelPostOutputData } from "../../use_cases/cancel_post/output_data";
import type { ConfirmDisclosureInputData } from "../../use_cases/confirm_disclosure/input_data";
import type { ConfirmDisclosureOutputData } from "../../use_cases/confirm_disclosure/output_data";
import type { ConnectAccountBeginInputData } from "../../use_cases/connect_account_begin/input_data";
import type { ConnectAccountBeginOutputData } from "../../use_cases/connect_account_begin/output_data";
import type { ConnectAccountCompleteInputData } from "../../use_cases/connect_account_complete/input_data";
import type { ConnectAccountCompleteOutputData } from "../../use_cases/connect_account_complete/output_data";
import type { CostTotalsInputData } from "../../use_cases/cost_totals/input_data";
import type { CostTotalsOutputData } from "../../use_cases/cost_totals/output_data";
import type { DeletePostInputData } from "../../use_cases/delete_post/input_data";
import type { DeletePostOutputData } from "../../use_cases/delete_post/output_data";
import type { EditPostInputData } from "../../use_cases/edit_post/input_data";
import type { EditPostOutputData } from "../../use_cases/edit_post/output_data";
import type { GetAccountMetricsInputData } from "../../use_cases/get_account_metrics/input_data";
import type { GetAccountMetricsOutputData } from "../../use_cases/get_account_metrics/output_data";
import type { GetCalendarInputData } from "../../use_cases/get_calendar/input_data";
import type { GetCalendarOutputData } from "../../use_cases/get_calendar/output_data";
import type { GetMediaUsageInputData } from "../../use_cases/get_media_usage/input_data";
import type { GetMediaUsageOutputData } from "../../use_cases/get_media_usage/output_data";
import type { GetPostInputData } from "../../use_cases/get_post/input_data";
import type { GetPostOutputData } from "../../use_cases/get_post/output_data";
import type { GetPostMetricsInputData } from "../../use_cases/get_post_metrics/input_data";
import type { GetPostMetricsOutputData } from "../../use_cases/get_post_metrics/output_data";
import type { ListAccountsInputData } from "../../use_cases/list_accounts/input_data";
import type { ListAccountsOutputData } from "../../use_cases/list_accounts/output_data";
import type { ListBacklogInputData } from "../../use_cases/list_backlog/input_data";
import type { ListBacklogOutputData } from "../../use_cases/list_backlog/output_data";
import type { ListPersonalitiesInputData } from "../../use_cases/list_personalities/input_data";
import type { ListPersonalitiesOutputData } from "../../use_cases/list_personalities/output_data";
import type { LoginInputData } from "../../use_cases/login/input_data";
import type { LoginOutputData } from "../../use_cases/login/output_data";
import type { ApprovePostInputData } from "../../use_cases/approve_post/input_data";
import type { ApprovePostOutputData } from "../../use_cases/approve_post/output_data";
import type { RejectPostInputData } from "../../use_cases/reject_post/input_data";
import type { RejectPostOutputData } from "../../use_cases/reject_post/output_data";
import type { ReschedulePostInputData } from "../../use_cases/reschedule_post/input_data";
import type { ReschedulePostOutputData } from "../../use_cases/reschedule_post/output_data";
import type { SavePersonalityInputData } from "../../use_cases/save_personality/input_data";
import type { SavePersonalityOutputData } from "../../use_cases/save_personality/output_data";
import type { SetAccountStatusInputData } from "../../use_cases/set_account_status/input_data";
import type { SetAccountStatusOutputData } from "../../use_cases/set_account_status/output_data";
import type { SetPolicyInputData } from "../../use_cases/set_policy/input_data";
import type { SetPolicyOutputData } from "../../use_cases/set_policy/output_data";
import type { UseCaseFactory } from "./presenter";

/**
 * The use cases each dashboard controller drives, as factories the composition root supplies
 * (one small interface per controller: ISP). Each builds the interactor around the presenter the
 * controller made for the request.
 */

export interface SessionUseCases {
  readonly login: UseCaseFactory<LoginInputData, LoginOutputData>;
}

export interface AccountDirectory {
  readonly listAccounts: UseCaseFactory<ListAccountsInputData, ListAccountsOutputData>;
}

export interface PostPageUseCases extends AccountDirectory {
  readonly listBacklog: UseCaseFactory<ListBacklogInputData, ListBacklogOutputData>;
  readonly getCalendar: UseCaseFactory<GetCalendarInputData, GetCalendarOutputData>;
  readonly getPost: UseCaseFactory<GetPostInputData, GetPostOutputData>;
  readonly getPostMetrics: UseCaseFactory<GetPostMetricsInputData, GetPostMetricsOutputData>;
}

export interface PostCommandUseCases {
  readonly editPost: UseCaseFactory<EditPostInputData, EditPostOutputData>;
  readonly approvePost: UseCaseFactory<ApprovePostInputData, ApprovePostOutputData>;
  readonly rejectPost: UseCaseFactory<RejectPostInputData, RejectPostOutputData>;
  readonly cancelPost: UseCaseFactory<CancelPostInputData, CancelPostOutputData>;
  readonly deletePost: UseCaseFactory<DeletePostInputData, DeletePostOutputData>;
  readonly reschedulePost: UseCaseFactory<ReschedulePostInputData, ReschedulePostOutputData>;
}

export interface AccountUseCases extends AccountDirectory {
  readonly listPersonalities: UseCaseFactory<
    ListPersonalitiesInputData,
    ListPersonalitiesOutputData
  >;
  readonly setAccountStatus: UseCaseFactory<SetAccountStatusInputData, SetAccountStatusOutputData>;
  readonly confirmDisclosure: UseCaseFactory<
    ConfirmDisclosureInputData,
    ConfirmDisclosureOutputData
  >;
  readonly setPolicy: UseCaseFactory<SetPolicyInputData, SetPolicyOutputData>;
}

export interface OAuthUseCases {
  readonly connectBegin: UseCaseFactory<
    ConnectAccountBeginInputData,
    ConnectAccountBeginOutputData
  >;
  readonly connectComplete: UseCaseFactory<
    ConnectAccountCompleteInputData,
    ConnectAccountCompleteOutputData
  >;
}

export interface PersonalityUseCases {
  readonly listPersonalities: UseCaseFactory<
    ListPersonalitiesInputData,
    ListPersonalitiesOutputData
  >;
  readonly savePersonality: UseCaseFactory<SavePersonalityInputData, SavePersonalityOutputData>;
}

export interface ReportUseCases extends AccountDirectory {
  readonly accountMetrics: UseCaseFactory<GetAccountMetricsInputData, GetAccountMetricsOutputData>;
  readonly costTotals: UseCaseFactory<CostTotalsInputData, CostTotalsOutputData>;
  readonly mediaUsage: UseCaseFactory<GetMediaUsageInputData, GetMediaUsageOutputData>;
  readonly auditList: UseCaseFactory<AuditListInputData, AuditListOutputData>;
}
