import type { StagedMedia } from "../../entities/content/staged_media";
import { mediaExpiresAt, mediaInUse } from "../../entities/media/media_cleanup";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { AccountRepository } from "../ports/account_repository";
import type { MediaCatalog } from "../ports/media_catalog";
import type { PostReader } from "../ports/post_reader";
import type { ListMediaInputBoundary } from "./input_boundary";
import type { ListMediaInputData } from "./input_data";
import type { ListMediaOutputBoundary } from "./output_boundary";
import type { MediaListing } from "./output_data";

/** The most a listing returns. */
export const MAX_MEDIA_LIST = 50;
/**
 * How many recent items are read to filter `unused` from. The cleanup deletes unused media after
 * two days and used media a week after its post, so an account rarely holds more.
 */
export const MEDIA_LIST_SCAN = 200;

export interface ListMediaPorts {
  readonly accounts: AccountRepository;
  readonly catalog: MediaCatalog;
  readonly reader: PostReader;
  readonly guard: AccessGuard;
}

/**
 * `list_media` and the dashboard's Media page (GROKCHAT-18): an account's staged media, newest
 * first, so a bot finds what the owner uploaded and passes its media_id to `create_post`.
 * Scope-checked like every account-addressed tool.
 */
export class ListMediaInteractor implements ListMediaInputBoundary {
  constructor(
    private readonly ports: ListMediaPorts,
    private readonly presenter: ListMediaOutputBoundary,
  ) {}

  async execute(input: ListMediaInputData): Promise<void> {
    const account = await this.ports.accounts.get(input.accountId);
    if (account === null) {
      this.presenter.present(refusal("not_found"));
      return;
    }
    const action = { actor: input.actor, action: "media.list", accountId: account.id, postId: null };
    if (!(await this.ports.guard.inScope(action))) {
      this.presenter.present(refusal("scope"));
      return;
    }
    const recent = await this.ports.catalog.recent(account.id, MEDIA_LIST_SCAN);
    const items: MediaListing[] = [];
    for (const media of recent) {
      const listing = await this.listing(media);
      if (input.status === "all" || !listing.used) {
        items.push(listing);
      }
    }
    const limit = Math.min(Math.max(1, input.limit), MAX_MEDIA_LIST);
    this.presenter.present({ ok: true, accountId: account.id, items: items.slice(0, limit) });
  }

  private async listing(media: StagedMedia): Promise<MediaListing> {
    const post = media.attachedTo === null ? null : await this.ports.reader.get(media.attachedTo);
    return { media, used: mediaInUse(post), expiresAt: mediaExpiresAt(media, post) };
  }
}
