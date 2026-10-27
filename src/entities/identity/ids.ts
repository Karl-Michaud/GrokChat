/** Branded identifiers (plan §3.1): a plain string at run time, a distinct type at compile time. */
declare const brand: unique symbol;

type Branded<Name extends string> = string & { readonly [brand]: Name };

export type AccountId = Branded<"AccountId">;
export type PersonalityId = Branded<"PersonalityId">;
export type PostId = Branded<"PostId">;
export type BotId = Branded<"BotId">;
export type XUserId = Branded<"XUserId">;
export type XPostId = Branded<"XPostId">;
export type XMediaId = Branded<"XMediaId">;
export type StagedMediaId = Branded<"StagedMediaId">;
export type IdempotencyKey = Branded<"IdempotencyKey">;

export const accountId = (value: string): AccountId => value as AccountId;
export const personalityId = (value: string): PersonalityId => value as PersonalityId;
export const postId = (value: string): PostId => value as PostId;
export const botId = (value: string): BotId => value as BotId;
export const xUserId = (value: string): XUserId => value as XUserId;
export const xPostId = (value: string): XPostId => value as XPostId;
export const xMediaId = (value: string): XMediaId => value as XMediaId;
export const stagedMediaId = (value: string): StagedMediaId => value as StagedMediaId;
export const idempotencyKey = (value: string): IdempotencyKey => value as IdempotencyKey;
