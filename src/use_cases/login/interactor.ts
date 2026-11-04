import type { ActionAudit } from "../access/action_audit";
import { refusal } from "../access/refusal";
import type { Clock } from "../ports/clock";
import type { LoginThrottle } from "../ports/login_throttle";
import type { PasswordVerifier } from "../ports/password_verifier";
import type { LoginInputBoundary } from "./input_boundary";
import type { LoginInputData } from "./input_data";
import type { LoginOutputBoundary } from "./output_boundary";

/** Every failure also counts against this key, so spreading guesses over many IPs is throttled too. */
export const GLOBAL_LOGIN_KEY = "global";

export interface LoginPorts {
  readonly throttle: LoginThrottle;
  readonly verifier: PasswordVerifier;
  readonly audit: ActionAudit;
  readonly clock: Clock;
}

/**
 * The dashboard login (plan §3.5, R12): a throttled key is refused before the password is hashed
 * (so a flood costs no PBKDF2 CPU); a wrong password counts a failure against both keys.
 */
export class LoginInteractor implements LoginInputBoundary {
  constructor(
    private readonly ports: LoginPorts,
    private readonly presenter: LoginOutputBoundary,
  ) {}

  async execute(input: LoginInputData): Promise<void> {
    const action = { actor: input.actor, action: "session.login", accountId: null, postId: null };
    const now = this.ports.clock.now();
    const keys = [`ip:${input.clientKey}`, GLOBAL_LOGIN_KEY];
    for (const key of keys) {
      if (!(await this.ports.throttle.allow(key, now))) {
        await this.ports.audit.refused(action, "throttled");
        this.presenter.present(refusal("throttled"));
        return;
      }
    }
    if (!(await this.ports.verifier.verify(input.password))) {
      for (const key of keys) {
        await this.ports.throttle.recordFailure(key, now);
      }
      await this.ports.audit.refused(action, "wrong_password");
      this.presenter.present(refusal("wrong_password"));
      return;
    }
    await this.ports.audit.done(action);
    this.presenter.present({ ok: true });
  }
}
