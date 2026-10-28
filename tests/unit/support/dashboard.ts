/**
 * The dashboard's use-case factories over the in-memory world, wired the way main.ts wires them.
 */
import type {
  AccountUseCases,
  ActivityUseCases,
  AnalyticsUseCases,
  MediaUseCases,
  OAuthUseCases,
  PeopleUseCases,
  PostCommandUseCases,
  PostPageUseCases,
  SessionUseCases,
} from "../../../src/interface_adapters/dashboard/use_cases";
import { AssignAccountInteractor } from "../../../src/use_cases/assign_account/interactor";
import type { AssignAccountOutputBoundary as AssignAccountOutput } from "../../../src/use_cases/assign_account/output_boundary";
import { CreatePersonInteractor } from "../../../src/use_cases/create_person/interactor";
import type { CreatePersonOutputBoundary as CreatePersonOutput } from "../../../src/use_cases/create_person/output_boundary";
import { DeletePersonInteractor } from "../../../src/use_cases/delete_person/interactor";
import type { DeletePersonOutputBoundary as DeletePersonOutput } from "../../../src/use_cases/delete_person/output_boundary";
import { IssuePersonTokenInteractor } from "../../../src/use_cases/issue_person_token/interactor";
import type { IssuePersonTokenOutputBoundary as IssueTokenOutput } from "../../../src/use_cases/issue_person_token/output_boundary";
import { ListPeopleInteractor } from "../../../src/use_cases/list_people/interactor";
import type { ListPeopleOutputBoundary as ListPeopleOutput } from "../../../src/use_cases/list_people/output_boundary";
import { RenamePersonInteractor } from "../../../src/use_cases/rename_person/interactor";
import type { RenamePersonOutputBoundary as RenamePersonOutput } from "../../../src/use_cases/rename_person/output_boundary";
import { ApprovePostInteractor } from "../../../src/use_cases/approve_post/interactor";
import { CancelPostInteractor } from "../../../src/use_cases/cancel_post/interactor";
import { ConfirmDisclosureInteractor } from "../../../src/use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../../src/use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "../../../src/use_cases/connect_account_complete/interactor";
import { DeletePostInteractor } from "../../../src/use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../../src/use_cases/edit_post/interactor";
import { GetAnalyticsInteractor } from "../../../src/use_cases/get_analytics/interactor";
import { GetPostInsightsInteractor } from "../../../src/use_cases/get_post_insights/interactor";
import { ListActivityInteractor } from "../../../src/use_cases/list_activity/interactor";
import { ListPostsInteractor } from "../../../src/use_cases/list_posts/interactor";
import { GetMediaUsageInteractor } from "../../../src/use_cases/get_media_usage/interactor";
import { ListAccountsInteractor } from "../../../src/use_cases/list_accounts/interactor";
import { LoginInteractor } from "../../../src/use_cases/login/interactor";
import type { PasswordVerifier } from "../../../src/use_cases/ports/password_verifier";
import { RejectPostInteractor } from "../../../src/use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "../../../src/use_cases/reschedule_post/interactor";
import { SetAccountStatusInteractor } from "../../../src/use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "../../../src/use_cases/set_policy/interactor";
import { DeleteMediaInteractor } from "../../../src/use_cases/delete_media/interactor";
import type { DeleteMediaOutputBoundary } from "../../../src/use_cases/delete_media/output_boundary";
import { GetMediaFileInteractor } from "../../../src/use_cases/get_media_file/interactor";
import type { GetMediaFileOutputBoundary } from "../../../src/use_cases/get_media_file/output_boundary";
import { ListMediaInteractor } from "../../../src/use_cases/list_media/interactor";
import type { ListMediaOutputBoundary } from "../../../src/use_cases/list_media/output_boundary";
import { StageMediaUploadInteractor } from "../../../src/use_cases/stage_media_upload/interactor";
import type { StageMediaUploadOutputBoundary } from "../../../src/use_cases/stage_media_upload/output_boundary";
import type { Post } from "../../../src/entities/posts/post";
import type { UseCaseFactory } from "../../../src/interface_adapters/dashboard/presenter";
import { PostCommandsController } from "../../../src/interface_adapters/dashboard/post_commands_controller";
import { PostsController } from "../../../src/interface_adapters/dashboard/posts_controller";
import { makeWorld, type World } from "./world";

export type DashboardUseCases = SessionUseCases &
  PostPageUseCases &
  PostCommandUseCases &
  AccountUseCases &
  OAuthUseCases &
  AnalyticsUseCases &
  ActivityUseCases &
  PeopleUseCases &
  MediaUseCases;

/** Accepts exactly this password. */
export const fixedPassword = (password: string): PasswordVerifier => ({
  verify: (given) => Promise.resolve(given === password),
});

export function dashboardUseCases(
  world: World,
  verifier: PasswordVerifier = fixedPassword("pw"),
): DashboardUseCases {
  const { reader, guard, command, accountCommand, clock } = world;
  return {
    login: (p) =>
      new LoginInteractor(
        { throttle: world.throttle, verifier, audit: world.actionAudit, clock },
        p,
      ),
    listAccounts: (p) => new ListAccountsInteractor(world.accounts, guard, p),
    listPosts: (p) => new ListPostsInteractor({ reader, metrics: world.metrics, guard }, p),
    insights: (p) =>
      new GetPostInsightsInteractor(
        { reader, metrics: world.metrics, activity: world.activity, guard },
        p,
      ),
    analytics: (p) =>
      new GetAnalyticsInteractor(
        {
          accounts: world.accounts,
          reader,
          metrics: world.metrics,
          followers: world.followers,
          costs: world.costs,
          guard,
          clock,
        },
        p,
      ),
    activity: (p) => new ListActivityInteractor(world.activity, guard, p),
    editPost: (p) =>
      new EditPostInteractor(
        {
          command,
          accounts: world.accounts,
          validator: world.validator,
          attachments: world.attachments,
        },
        p,
      ),
    approvePost: (p) => new ApprovePostInteractor(command, clock, p),
    rejectPost: (p) => new RejectPostInteractor(command, p),
    cancelPost: (p) => new CancelPostInteractor(command, p),
    deletePost: (p) =>
      new DeletePostInteractor(
        { reader, gateway: world.gateway, steps: world.steps, guard, audit: world.actionAudit },
        p,
      ),
    reschedulePost: (p) => new ReschedulePostInteractor(command, clock, p),
    setAccountStatus: (p) => new SetAccountStatusInteractor(accountCommand, p),
    confirmDisclosure: (p) => new ConfirmDisclosureInteractor(accountCommand, p),
    setPolicy: (p) => new SetPolicyInteractor(accountCommand, p),
    connectBegin: (p) =>
      new ConnectAccountBeginInteractor(
        {
          states: world.states,
          pkce: world.pkce,
          connector: world.connector,
          guard,
          ids: world.ids,
          clock,
        },
        p,
      ),
    connectComplete: (p) =>
      new ConnectAccountCompleteInteractor(
        {
          states: world.states,
          connector: world.connector,
          accounts: world.accounts,
          gateway: world.gateway,
          guard,
          audit: world.actionAudit,
          ids: world.ids,
          clock,
        },
        p,
      ),
    mediaUsage: (p) => new GetMediaUsageInteractor(world.usage, guard, clock, p),
    ...peopleUseCases(world),
    ...mediaUseCases(world),
  };
}

/** GROKCHAT-18: the Media page's use cases over the in-memory world, as main.ts wires them. */
function mediaUseCases(world: World) {
  const deleting = { ...world, audit: world.actionAudit };
  return {
    listMedia: (p: ListMediaOutputBoundary) => new ListMediaInteractor(world, p),
    upload: (p: StageMediaUploadOutputBoundary) =>
      new StageMediaUploadInteractor(world.accounts, world.intake, world.guard, p),
    deleteMedia: (p: DeleteMediaOutputBoundary) => new DeleteMediaInteractor(deleting, p),
    mediaFile: (p: GetMediaFileOutputBoundary) => new GetMediaFileInteractor(world, p),
  };
}

/** GROKCHAT-16: the people use cases over the in-memory world, as main.ts wires them. */
function peopleUseCases(world: World) {
  const ports = { ...world, audit: world.actionAudit };
  return {
    listPeople: (p: ListPeopleOutput) => new ListPeopleInteractor(world, p),
    createPerson: (p: CreatePersonOutput) => new CreatePersonInteractor(ports, p),
    renamePerson: (p: RenamePersonOutput) => new RenamePersonInteractor(ports, p),
    deletePerson: (p: DeletePersonOutput) => new DeletePersonInteractor(ports, p),
    assignAccount: (p: AssignAccountOutput) => new AssignAccountInteractor(ports, p),
    issueToken: (p: IssueTokenOutput) => new IssuePersonTokenInteractor(ports, p),
  };
}

/** A use case that presents this output whatever it is asked. */
export function presenting<Output>(output: Output): UseCaseFactory<unknown, Output> {
  return (presenter) => ({
    execute: () => {
      presenter.present(output);
      return Promise.resolve();
    },
  });
}

/** A world with the default account, these posts, and the post controllers. */
export async function setupPosts(posts: readonly Post[] = []) {
  const world = makeWorld();
  await world.seedAccount();
  for (const post of posts) {
    await world.writer.add(post);
  }
  const useCases = dashboardUseCases(world);
  return {
    world,
    useCases,
    pages: new PostsController(useCases, world.clock),
    commands: new PostCommandsController(useCases),
  };
}
