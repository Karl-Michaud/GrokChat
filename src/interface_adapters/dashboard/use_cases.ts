import type { ApprovePostInputData } from "../../use_cases/approve_post/input_data";
import type { ApprovePostOutputData } from "../../use_cases/approve_post/output_data";
import type { CancelPostInputData } from "../../use_cases/cancel_post/input_data";
import type { CancelPostOutputData } from "../../use_cases/cancel_post/output_data";
import type { ConfirmDisclosureInputData } from "../../use_cases/confirm_disclosure/input_data";
import type { ConfirmDisclosureOutputData } from "../../use_cases/confirm_disclosure/output_data";
import type { ConnectAccountBeginInputData } from "../../use_cases/connect_account_begin/input_data";
import type { ConnectAccountBeginOutputData } from "../../use_cases/connect_account_begin/output_data";
import type { ConnectAccountCompleteInputData } from "../../use_cases/connect_account_complete/input_data";
import type { ConnectAccountCompleteOutputData } from "../../use_cases/connect_account_complete/output_data";
import type { DeletePostInputData } from "../../use_cases/delete_post/input_data";
import type { DeletePostOutputData } from "../../use_cases/delete_post/output_data";
import type { EditPostInputData } from "../../use_cases/edit_post/input_data";
import type { EditPostOutputData } from "../../use_cases/edit_post/output_data";
import type { GetAnalyticsInputData } from "../../use_cases/get_analytics/input_data";
import type { GetAnalyticsOutputData } from "../../use_cases/get_analytics/output_data";
import type { GetMediaUsageInputData } from "../../use_cases/get_media_usage/input_data";
import type { GetMediaUsageOutputData } from "../../use_cases/get_media_usage/output_data";
import type { GetPostInsightsInputData } from "../../use_cases/get_post_insights/input_data";
import type { GetPostInsightsOutputData } from "../../use_cases/get_post_insights/output_data";
import type { ListAccountsInputData } from "../../use_cases/list_accounts/input_data";
import type { ListAccountsOutputData } from "../../use_cases/list_accounts/output_data";
import type { ListActivityInputData } from "../../use_cases/list_activity/input_data";
import type { ListActivityOutputData } from "../../use_cases/list_activity/output_data";
import type { ListPostsInputData } from "../../use_cases/list_posts/input_data";
import type { ListPostsOutputData } from "../../use_cases/list_posts/output_data";
import type { LoginInputData } from "../../use_cases/login/input_data";
import type { LoginOutputData } from "../../use_cases/login/output_data";
import type { RejectPostInputData } from "../../use_cases/reject_post/input_data";
import type { RejectPostOutputData } from "../../use_cases/reject_post/output_data";
import type { ReschedulePostInputData } from "../../use_cases/reschedule_post/input_data";
import type { ReschedulePostOutputData } from "../../use_cases/reschedule_post/output_data";
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

export interface AnalyticsSource {
  readonly analytics: UseCaseFactory<GetAnalyticsInputData, GetAnalyticsOutputData>;
}

export interface AnalyticsUseCases extends AccountDirectory, AnalyticsSource {
  readonly mediaUsage: UseCaseFactory<GetMediaUsageInputData, GetMediaUsageOutputData>;
}

export interface PostPageUseCases extends AccountDirectory {
  readonly listPosts: UseCaseFactory<ListPostsInputData, ListPostsOutputData>;
  readonly insights: UseCaseFactory<GetPostInsightsInputData, GetPostInsightsOutputData>;
}

export interface PostCommandUseCases {
  readonly editPost: UseCaseFactory<EditPostInputData, EditPostOutputData>;
  readonly approvePost: UseCaseFactory<ApprovePostInputData, ApprovePostOutputData>;
  readonly rejectPost: UseCaseFactory<RejectPostInputData, RejectPostOutputData>;
  readonly cancelPost: UseCaseFactory<CancelPostInputData, CancelPostOutputData>;
  readonly deletePost: UseCaseFactory<DeletePostInputData, DeletePostOutputData>;
  readonly reschedulePost: UseCaseFactory<ReschedulePostInputData, ReschedulePostOutputData>;
}

export interface AccountUseCases extends AccountDirectory, AnalyticsSource {
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

export interface ActivityUseCases extends AccountDirectory {
  readonly activity: UseCaseFactory<ListActivityInputData, ListActivityOutputData>;
}
