/** Test data for the pure layers: a default for every entity, overridable field by field. */
import type { Account } from "../../../src/entities/accounts/account";
import { DEFAULT_POLICY, type PostingPolicy } from "../../../src/entities/accounts/posting_policy";
import type { Personality } from "../../../src/entities/content/personality";
import type { StagedMedia } from "../../../src/entities/content/staged_media";
import type { Actor } from "../../../src/entities/identity/actor";
import {
  accountId,
  botId,
  personalityId,
  postId,
  stagedMediaId,
  xPostId,
  xUserId,
  type AccountId,
  type StagedMediaId,
} from "../../../src/entities/identity/ids";
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
    personalityId: personalityId("pers-1"),
    status: "ACTIVE",
    disclosure: { bioConfirmed: true, automatedLabelConfirmed: true },
    policy: aPolicy(),
    isAppOwner: false,
    ...overrides,
  };
}

export function aPersonality(overrides: Partial<Personality> = {}): Personality {
  return {
    id: personalityId("pers-1"),
    name: "Muse",
    voiceGuide: "warm",
    topics: ["music"],
    dos: ["be kind"],
    donts: ["no politics"],
    examples: ["hello"],
    version: 3,
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
    provenance: { botId: null, personalityVersion: 3, policySnapshot: aPolicy() },
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
