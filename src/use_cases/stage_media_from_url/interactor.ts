import { MAX_MEDIA_BYTES } from "../../entities/content/staged_media";
import { checkMediaUrl, urlHost } from "../../entities/media/media_url";
import type { AccessGuard } from "../access/access_guard";
import { refusal } from "../access/refusal";
import type { MediaIntake } from "../media/media_intake";
import type { AccountRepository } from "../ports/account_repository";
import type { FetchRefusal, MediaFetcher } from "../ports/media_fetcher";
import type { StageMediaFromUrlInputBoundary } from "./input_boundary";
import type { StageMediaFromUrlInputData } from "./input_data";
import type { StageMediaFromUrlOutputBoundary } from "./output_boundary";
import type { HostRefusal, StageMediaFromUrlOutputData } from "./output_data";

export const MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export interface StageMediaFromUrlPorts {
  readonly accounts: AccountRepository;
  readonly fetcher: MediaFetcher;
  readonly intake: MediaIntake;
  readonly guard: AccessGuard;
  /** `GROKCHAT_MEDIA_HOSTS` (plan §3.6). */
  readonly allowedHosts: readonly string[];
}

/** A bot stages media from an https URL on the host allowlist (plan §3.3 #3, §3.5, U18). */
export class StageMediaFromUrlInteractor implements StageMediaFromUrlInputBoundary {
  constructor(
    private readonly ports: StageMediaFromUrlPorts,
    private readonly presenter: StageMediaFromUrlOutputBoundary,
  ) {}

  async execute(input: StageMediaFromUrlInputData): Promise<void> {
    this.presenter.present(await this.stage(input));
  }

  private async stage(input: StageMediaFromUrlInputData): Promise<StageMediaFromUrlOutputData> {
    const account = await this.ports.accounts.get(input.accountId);
    if (account === null) {
      return refusal("not_found");
    }
    const action = {
      actor: input.actor,
      action: "media.stage",
      accountId: account.id,
      postId: null,
    };
    if (!(await this.ports.guard.inScope(action))) {
      return refusal("scope");
    }
    const url = checkMediaUrl(input.url, this.ports.allowedHosts);
    if (!url.allowed) {
      return this.refused(url.reason);
    }
    const fetched = await this.ports.fetcher.fetch(input.url, MAX_MEDIA_BYTES.GIF, MEDIA_TYPES);
    if (!fetched.ok) {
      return this.refused(fetched.reason);
    }
    const origin = { label: null, source: { kind: "url", host: urlHost(input.url) } } as const;
    const stored = await this.ports.intake.store(input.actor, account, fetched.bytes, origin);
    return stored.ok ? stored : refusal(stored.code);
  }

  /** A host refusal (the URL's or a redirect's) carries the allowlist; others only their code. */
  private refused(reason: FetchRefusal): StageMediaFromUrlOutputData {
    if (reason === "host_not_allowed") {
      const host: HostRefusal = { ...refusal(reason), allowedHosts: this.ports.allowedHosts };
      return host;
    }
    return refusal(reason);
  }
}
