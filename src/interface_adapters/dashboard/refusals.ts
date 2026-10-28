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
    invalid_name: { status: 400, message: "A name is 1 to 60 characters." },
    name_taken: { status: 409, message: "Someone already has that name." },
    name_mismatch: { status: 400, message: "Type the person's name exactly to delete them." },
    person_not_found: { status: 404, message: "That person does not exist." },
    not_media: {
      status: 400,
      message: "That file is not a PNG, JPEG, WebP or GIF (its contents were checked, not its name).",
    },
    too_large: { status: 400, message: "Too large: photos up to 5 MB, GIFs up to 15 MB." },
    media_quota: {
      status: 409,
      message: "Media storage is at its free-tier guard; wait for the cleanup or delete unused media.",
    },
    media_in_use: { status: 409, message: "A post still uses that media; it cannot be deleted." },
    invalid_label: { status: 400, message: "A label is at most 80 characters." },
    no_file: { status: 400, message: "Choose a file to upload." },
  }) as [string, RefusalView][],
);

/** The status and the message the dashboard shows for a use case's refusal code. */
export function refusalView(code: string): RefusalView {
  return REFUSALS.get(code) ?? { status: 400, message: `Refused: ${code}.` };
}
