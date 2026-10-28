export type RefusalStatus = 400 | 401 | 403 | 404 | 409 | 429 | 502;

export interface RefusalView {
  readonly status: RefusalStatus;
  readonly message: string;
}

const REFUSALS: ReadonlyMap<string, RefusalView> = new Map(
  Object.entries({
    not_found: { status: 404, message: "Not found." },
    account_not_found: { status: 404, message: "The account does not exist." },
    scope: { status: 403, message: "Outside your scope." },
    human_only: { status: 403, message: "Only the dashboard's owner may do this." },
    invalid_transition: { status: 409, message: "The post cannot do that in its current state." },
    version_conflict: { status: 409, message: "The post changed meanwhile; reload and try again." },
    not_deletable: { status: 409, message: "Only a published post can be deleted." },
    needs_reconnect: { status: 409, message: "Reconnect the account on X first." },
    different_x_user: {
      status: 409,
      message: "That X login is a different account from the one being reconnected.",
    },
    already_connected: { status: 409, message: "That X account is already connected." },
    confirmation_required: {
      status: 400,
      message: "Confirm that you checked X and the post is not there.",
    },
    oauth_state: {
      status: 400,
      message: "The connect link expired, was already used, or belongs to another session.",
    },
    oauth_failed: { status: 502, message: "X did not complete the connection." },
    throttled: { status: 429, message: "Too many failed logins; wait fifteen minutes." },
    wrong_password: { status: 401, message: "Wrong password." },
    daily_cap: { status: 400, message: "The daily cap must be a whole number of at least 1." },
    min_gap: { status: 400, message: "The minimum gap must be zero or more whole minutes." },
    quiet_hours: { status: 400, message: "Quiet hours need two different times." },
    tz: { status: 400, message: "Unknown time zone." },
    grace: { status: 400, message: "The grace must be zero or more whole minutes." },
    no_parts: { status: 400, message: "A post needs at least one part." },
    too_many_parts: { status: 400, message: "A thread has at most 25 parts." },
    link_policy: { status: 400, message: "The account's policy refuses links." },
  }) as [string, RefusalView][],
);

/** The status and the message the dashboard shows for a use case's refusal code. */
export function refusalView(code: string): RefusalView {
  return REFUSALS.get(code) ?? { status: 400, message: `Refused: ${code}.` };
}
