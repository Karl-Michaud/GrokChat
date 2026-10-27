/**
 * The dashboard's use-case factories over the in-memory world, wired the way main.ts wires them.
 */
import type {
  AccountUseCases,
  OAuthUseCases,
  PersonalityUseCases,
  PostCommandUseCases,
  PostPageUseCases,
  ReportUseCases,
  SessionUseCases,
} from "../../../src/interface_adapters/dashboard/use_cases";
import { ApprovePostInteractor } from "../../../src/use_cases/approve_post/interactor";
import { AuditListInteractor } from "../../../src/use_cases/audit_list/interactor";
import { CancelPostInteractor } from "../../../src/use_cases/cancel_post/interactor";
import { ConfirmDisclosureInteractor } from "../../../src/use_cases/confirm_disclosure/interactor";
import { ConnectAccountBeginInteractor } from "../../../src/use_cases/connect_account_begin/interactor";
import { ConnectAccountCompleteInteractor } from "../../../src/use_cases/connect_account_complete/interactor";
import { CostTotalsInteractor } from "../../../src/use_cases/cost_totals/interactor";
import { DeletePostInteractor } from "../../../src/use_cases/delete_post/interactor";
import { EditPostInteractor } from "../../../src/use_cases/edit_post/interactor";
import { GetAccountMetricsInteractor } from "../../../src/use_cases/get_account_metrics/interactor";
import { GetCalendarInteractor } from "../../../src/use_cases/get_calendar/interactor";
import { GetMediaUsageInteractor } from "../../../src/use_cases/get_media_usage/interactor";
import { GetPostInteractor } from "../../../src/use_cases/get_post/interactor";
import { GetPostMetricsInteractor } from "../../../src/use_cases/get_post_metrics/interactor";
import { ListAccountsInteractor } from "../../../src/use_cases/list_accounts/interactor";
import { ListBacklogInteractor } from "../../../src/use_cases/list_backlog/interactor";
import { ListPersonalitiesInteractor } from "../../../src/use_cases/list_personalities/interactor";
import { LoginInteractor } from "../../../src/use_cases/login/interactor";
import type { PasswordVerifier } from "../../../src/use_cases/ports/password_verifier";
import { RejectPostInteractor } from "../../../src/use_cases/reject_post/interactor";
import { ReschedulePostInteractor } from "../../../src/use_cases/reschedule_post/interactor";
import { SavePersonalityInteractor } from "../../../src/use_cases/save_personality/interactor";
import { SetAccountStatusInteractor } from "../../../src/use_cases/set_account_status/interactor";
import { SetPolicyInteractor } from "../../../src/use_cases/set_policy/interactor";
import type { Post } from "../../../src/entities/posts/post";
import type { UseCaseFactory } from "../../../src/interface_adapters/dashboard/presenter";
import { PostCommandsController } from "../../../src/interface_adapters/dashboard/post_commands_controller";
import { PostPagesController } from "../../../src/interface_adapters/dashboard/post_pages_controller";
import { makeWorld, type World } from "./world";

export type DashboardUseCases = SessionUseCases &
  PostPageUseCases &
  PostCommandUseCases &
  AccountUseCases &
  OAuthUseCases &
  PersonalityUseCases &
  ReportUseCases;

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
    listBacklog: (p) => new ListBacklogInteractor(reader, guard, p),
    getCalendar: (p) => new GetCalendarInteractor(reader, guard, p),
    getPost: (p) => new GetPostInteractor(reader, guard, p),
    getPostMetrics: (p) => new GetPostMetricsInteractor(reader, world.metrics, guard, p),
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
    listPersonalities: (p) => new ListPersonalitiesInteractor(world.personalities, guard, p),
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
          personalities: world.personalities,
          gateway: world.gateway,
          guard,
          audit: world.actionAudit,
          ids: world.ids,
          clock,
        },
        p,
      ),
    savePersonality: (p) =>
      new SavePersonalityInteractor(world.personalities, world.ids, guard, world.actionAudit, p),
    accountMetrics: (p) => new GetAccountMetricsInteractor(world.metrics, guard, p),
    costTotals: (p) => new CostTotalsInteractor(world.costs, guard, p),
    mediaUsage: (p) => new GetMediaUsageInteractor(world.usage, guard, clock, p),
    auditList: (p) => new AuditListInteractor(world.audit, guard, p),
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
    pages: new PostPagesController(useCases, world.clock),
    commands: new PostCommandsController(useCases),
  };
}
