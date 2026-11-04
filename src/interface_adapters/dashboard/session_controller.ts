import { ADMIN } from "./admin_actor";
import { redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import type { SessionUseCases } from "./use_cases";

export const HOME_PAGE = "/dashboard/analytics";

/** The login form (plan §3.5, R12). The route issues the session cookie on a redirect. */
export class SessionController {
  constructor(private readonly useCases: SessionUseCases) {}

  login(form: { readonly password: string; readonly clientKey: string }): Promise<Outcome<never>> {
    return runUseCase(this.useCases.login, { actor: ADMIN, ...form }, (output) =>
      output.ok ? redirect(HOME_PAGE) : refused(output.code),
    );
  }
}
