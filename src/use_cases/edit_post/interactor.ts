import type { StagedMedia } from "../../entities/content/staged_media";
import type { Post } from "../../entities/posts/post";
import type { PostEvent } from "../../entities/posts/post_event";
import { refusal, type Refusal } from "../access/refusal";
import type { MediaAttachments } from "../authoring/media_attachments";
import type { PostCommand } from "../authoring/post_command";
import type { PartsRefusalCode, PartsValidator } from "../authoring/parts_validator";
import type { AccountRepository } from "../ports/account_repository";
import type { EditPostInputBoundary } from "./input_boundary";
import type { EditPostInputData } from "./input_data";
import type { EditPostOutputBoundary } from "./output_boundary";

type EditCode = PartsRefusalCode | "account_not_found";

export interface EditPostPorts {
  readonly command: PostCommand;
  readonly accounts: AccountRepository;
  readonly validator: PartsValidator;
  readonly attachments: MediaAttachments;
}

/** Edit a post that has not started: new parts (validated as at create) and/or a new time. */
export class EditPostInteractor implements EditPostInputBoundary {
  constructor(
    private readonly ports: EditPostPorts,
    private readonly presenter: EditPostOutputBoundary,
  ) {}

  async execute(input: EditPostInputData): Promise<void> {
    let media: readonly StagedMedia[] | null = null;
    const result = await this.ports.command.run<EditCode>({
      actor: input.actor,
      postId: input.postId,
      action: "post.edit",
      humanOnly: false,
      event: async (post) => {
        const planned = await this.plan(post, input);
        if ("ok" in planned) {
          return planned;
        }
        media = planned.media;
        return planned.event;
      },
      after: (post) =>
        media === null ? Promise.resolve() : this.ports.attachments.replace(post.id, media),
    });
    this.presenter.present(result);
  }

  private async plan(
    post: Post,
    input: EditPostInputData,
  ): Promise<
    { readonly event: PostEvent; readonly media: readonly StagedMedia[] | null } | Refusal<EditCode>
  > {
    const publishAt = input.publishAt ?? post.publishAt;
    if (input.parts === null) {
      return { event: { kind: "edit", parts: post.parts, publishAt }, media: null };
    }
    const account = await this.ports.accounts.get(post.accountId);
    if (account === null) {
      return refusal("account_not_found");
    }
    const checked = await this.ports.validator.check(account, input.parts, post.id);
    if (!checked.ok) {
      return refusal(checked.code);
    }
    return { event: { kind: "edit", parts: checked.parts, publishAt }, media: checked.media };
  }
}
