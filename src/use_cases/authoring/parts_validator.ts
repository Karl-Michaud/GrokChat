import type { Account } from "../../entities/accounts/account";
import { MAX_THREAD_PARTS, validatePart, type PartRefusal } from "../../entities/content/post_part";
import type { StagedMedia } from "../../entities/content/staged_media";
import type { PostId, StagedMediaId } from "../../entities/identity/ids";
import { PENDING } from "../../entities/posts/part_state";
import type { PostPart } from "../../entities/posts/post";
import { hasSchemeUrl } from "../../entities/text/post_text";
import type { MediaRepository } from "../ports/media_repository";

export interface PartInput {
  readonly text: string;
  readonly media: readonly StagedMediaId[];
}

export type PartsRefusalCode =
  | "no_parts"
  | "too_many_parts"
  | "media_not_found"
  | "media_not_owned"
  | "media_reused"
  | "link_policy"
  | `part_${PartRefusal}`;

export type PartsCheck =
  | {
      readonly ok: true;
      readonly parts: readonly PostPart[];
      readonly media: readonly StagedMedia[];
    }
  | { readonly ok: false; readonly code: PartsRefusalCode; readonly part: number | null };

const refused = (code: PartsRefusalCode, part: number | null = null): PartsCheck => ({
  ok: false,
  code,
  part,
});

/**
 * Checks a create or an edit (plan §3.3 #1): 1–25 parts, each valid (U13), media that exists,
 * belongs to the account and is not attached to another post, and the account's link policy.
 */
export class PartsValidator {
  constructor(private readonly media: MediaRepository) {}

  async check(
    account: Account,
    inputs: readonly PartInput[],
    post: PostId | null,
  ): Promise<PartsCheck> {
    if (inputs.length === 0 || inputs.length > MAX_THREAD_PARTS) {
      return refused(inputs.length === 0 ? "no_parts" : "too_many_parts");
    }
    const loaded: StagedMedia[] = [];
    for (const [index, input] of inputs.entries()) {
      const media = await this.loadMedia(account, input.media, loaded, post);
      if (typeof media === "string") {
        return refused(media, index);
      }
      const decision = validatePart(
        input.text,
        media.map((item) => item.kind),
      );
      if (!decision.allowed) {
        return refused(`part_${decision.reason}`, index);
      }
      if (account.policy.linkPolicy === "REFUSE" && hasSchemeUrl(input.text)) {
        return refused("link_policy", index);
      }
      loaded.push(...media);
    }
    return {
      ok: true,
      parts: inputs.map(({ text, media }) => ({ text, media, state: PENDING })),
      media: loaded,
    };
  }

  private async loadMedia(
    account: Account,
    ids: readonly StagedMediaId[],
    earlier: readonly StagedMedia[],
    post: PostId | null,
  ): Promise<readonly StagedMedia[] | PartsRefusalCode> {
    const found: StagedMedia[] = [];
    for (const id of ids) {
      const media = await this.media.get(id);
      if (media === null) {
        return "media_not_found";
      }
      if (media.ownerAccountId !== account.id) {
        return "media_not_owned";
      }
      const reused = [...earlier, ...found].some((item) => item.id === id);
      if (reused || (media.attachedTo !== null && media.attachedTo !== post)) {
        return "media_reused";
      }
      found.push(media);
    }
    return found;
  }
}
