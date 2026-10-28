/** Test data for the pure layers: a default for every entity, overridable field by field. */
import type { Person } from "../../../src/entities/people/person";
import type { Account } from "../../../src/entities/accounts/account";
import { DEFAULT_POLICY, type PostingPolicy } from "../../../src/entities/accounts/posting_policy";
import type { StagedMedia } from "../../../src/entities/content/staged_media";
import type { Actor } from "../../../src/entities/identity/actor";
import {
  accountId,
  botId,
  personId,
  postId,
  stagedMediaId,
  xPostId,
  xUserId,
  type AccountId,
  type StagedMediaId,
} from "../../../src/entities/identity/ids";
import type { FollowerSnapshot } from "../../../src/entities/metrics/follower_snapshot";
import type { MetricsSnapshot } from "../../../src/entities/metrics/metrics_snapshot";
import { PENDING, type PartState } from "../../../src/entities/posts/part_state";
import type { Post, PostPart } from "../../../src/entities/posts/post";

/** Tuesday 2026-10-27 12:00:00 UTC. */
export const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);

export const ACCOUNT = accountId("acc-1");
export const OTHER_ACCOUNT = accountId("acc-2");
export const BOT = botId("bot-1");

export const botActor = (accounts: readonly AccountId[] = [ACCOUNT]): Actor => ({
  kind: "bot",
  scope: { botId: BOT, accountIds: accounts },
});
export const HUMAN: Actor = { kind: "human", name: "owner" };
export const SYSTEM: Actor = { kind: "system", job: "cron" };

export function aPolicy(overrides: Partial<PostingPolicy> = {}): PostingPolicy {
  return { ...DEFAULT_POLICY, linkPolicy: "ALLOW", ...overrides };
}

export function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: ACCOUNT,
    xUserId: xUserId("x-user-1"),
    handle: "musechat_one",
    status: "ACTIVE",
    disclosure: { bioConfirmed: true, automatedLabelConfirmed: true },
    policy: aPolicy(),
    isAppOwner: false,
    ...overrides,
  };
}

export function part(
  text: string,
  state: PartState = PENDING,
  media: readonly StagedMediaId[] = [],
): PostPart {
  return { text, media, state };
}

export const sentState = (id: string, at = T0): PartState => ({
  kind: "SENT",
  xPostId: xPostId(id),
  at,
});
export const sendingState = (at = T0): PartState => ({ kind: "SENDING", attemptAt: at });
export const unknownState = (checks = 0, at = T0): PartState => ({
  kind: "UNKNOWN",
  attemptAt: at,
  checks,
});

export function aPost(overrides: Partial<Post> = {}): Post {
  return {
    id: postId("post-1"),
    accountId: ACCOUNT,
    parts: [part("hello world")],
    lifecycle: "SCHEDULED",
    publishAt: T0,
    resumeAt: null,
    idempotencyKey: null,
    requestHash: "hash-1",
    createdBy: HUMAN,
    provenance: { botId: null, policySnapshot: aPolicy() },
    version: 1,
    ...overrides,
  };
}

export function aMedia(overrides: Partial<StagedMedia> = {}): StagedMedia {
  return {
    id: stagedMediaId("media-1"),
    ownerAccountId: ACCOUNT,
    kind: "PHOTO",
    contentType: "image/png",
    size: 1000,
    storageKey: "key-1",
    sha256: "abc",
    stagedAt: T0,
    attachedTo: null,
    ...overrides,
  };
}

/** A metrics read of `id` at `at`, with every count set from `impressions` (GROKCHAT-15). */
export function aSnapshot(
  id: string,
  at: number,
  impressions: number,
  overrides: Partial<MetricsSnapshot> = {},
): MetricsSnapshot {
  return {
    xPostId: xPostId(id),
    accountId: ACCOUNT,
    takenAt: at,
    impressions,
    likes: Math.floor(impressions / 10),
    reposts: Math.floor(impressions / 50),
    replies: Math.floor(impressions / 100),
    quotes: 0,
    bookmarks: Math.floor(impressions / 25),
    urlLinkClicks: null,
    userProfileClicks: null,
    ...overrides,
  };
}

/** A recorded follower snapshot (GROKCHAT-15). */
export function aFollowerSnapshot(
  at: number,
  followers: number,
  account: AccountId = ACCOUNT,
): FollowerSnapshot {
  return {
    accountId: account,
    day: new Date(at).toISOString().slice(0, 10),
    takenAt: at,
    followers,
    following: 1,
    posts: 2,
    listed: 0,
  };
}

export const PERSON = personId("person-1");

export function aPerson(overrides: Partial<Person> = {}): Person {
  return { id: PERSON, name: "Karl", createdAt: T0, token: null, ...overrides };
}
