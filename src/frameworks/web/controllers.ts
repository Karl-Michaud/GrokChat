import type { AccountsController } from "../../interface_adapters/dashboard/accounts_controller";
import type { ActivityController } from "../../interface_adapters/dashboard/activity_controller";
import type { AnalyticsController } from "../../interface_adapters/dashboard/analytics_controller";
import type { PeopleController } from "../../interface_adapters/dashboard/people_controller";
import type { OAuthController } from "../../interface_adapters/dashboard/oauth_controller";
import type { PostCommandsController } from "../../interface_adapters/dashboard/post_commands_controller";
import type { PostsController } from "../../interface_adapters/dashboard/posts_controller";
import type { SessionController } from "../../interface_adapters/dashboard/session_controller";
import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";

/** The dashboard's controllers, built by the composition root (main.ts). */
export interface WebControllers {
  /** The login needs the verifier for this Worker's password hash secret. */
  session(verifier: PasswordVerifier): SessionController;
  readonly analytics: AnalyticsController;
  readonly posts: PostsController;
  readonly postCommands: PostCommandsController;
  readonly accounts: AccountsController;
  readonly people: PeopleController;
  readonly oauth: OAuthController;
  readonly activity: ActivityController;
}
