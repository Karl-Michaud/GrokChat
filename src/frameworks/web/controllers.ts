import type { AccountsController } from "../../interface_adapters/dashboard/accounts_controller";
import type { OAuthController } from "../../interface_adapters/dashboard/oauth_controller";
import type { PersonalitiesController } from "../../interface_adapters/dashboard/personalities_controller";
import type { PostCommandsController } from "../../interface_adapters/dashboard/post_commands_controller";
import type { PostPagesController } from "../../interface_adapters/dashboard/post_pages_controller";
import type { ReportsController } from "../../interface_adapters/dashboard/reports_controller";
import type { SessionController } from "../../interface_adapters/dashboard/session_controller";
import type { PasswordVerifier } from "../../use_cases/ports/password_verifier";

/** The dashboard's controllers, built by the composition root (main.ts). */
export interface WebControllers {
  /** The login needs the verifier for this Worker's password hash secret. */
  session(verifier: PasswordVerifier): SessionController;
  readonly postPages: PostPagesController;
  readonly postCommands: PostCommandsController;
  readonly accounts: AccountsController;
  readonly oauth: OAuthController;
  readonly personalities: PersonalitiesController;
  readonly reports: ReportsController;
}
