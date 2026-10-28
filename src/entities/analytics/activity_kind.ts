/** How the activity page groups the audit log's actions (GROKCHAT-15). */
export type ActivityKind =
  "posts" | "publishing" | "reads" | "accounts" | "refusals" | "media" | "sessions";

export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  "posts",
  "publishing",
  "reads",
  "accounts",
  "refusals",
  "media",
  "sessions",
];

/**
 * Each kind as action names (an entry ending in `.` is a prefix). Every action the use cases and
 * the X recorder write falls in exactly one kind (tested over the recorded names).
 */
export const ACTIVITY_ACTIONS: Readonly<Record<ActivityKind, readonly string[]>> = {
  posts: ["post."],
  publishing: ["x.create", "x.delete", "x.media_upload"],
  reads: ["x.read", "x.user_read"],
  accounts: ["account.", "x.oauth"],
  refusals: ["refused."],
  media: ["media."],
  sessions: ["session."],
};

export function actionMatches(action: string, pattern: string): boolean {
  return pattern.endsWith(".") ? action.startsWith(pattern) : action === pattern;
}

/** The kind an action belongs to; null for an action no kind lists. */
export function activityKindOf(action: string): ActivityKind | null {
  return (
    ACTIVITY_KINDS.find((kind) =>
      ACTIVITY_ACTIONS[kind].some((pattern) => actionMatches(action, pattern)),
    ) ?? null
  );
}

/** Who did it, from the audit's actor label (`bot:…`, `human:…`, `system:…`). */
export type ActorKind = "bot" | "human" | "system";

export const ACTOR_KINDS: readonly ActorKind[] = ["bot", "human", "system"];

export function actorKindOf(actor: string): ActorKind | null {
  return ACTOR_KINDS.find((kind) => actor.startsWith(`${kind}:`)) ?? null;
}
