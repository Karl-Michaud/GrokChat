import type { Account } from "../../entities/accounts/account";
import { MAX_LABEL_LENGTH } from "../../entities/media/media_label";
import { accountId, stagedMediaId } from "../../entities/identity/ids";
import type { MediaListing } from "../../use_cases/list_media/output_data";
import type { PersonListing } from "../../use_cases/list_people/output_data";
import {
  accountOptions,
  badgeOf,
  loadAccounts,
  type AccountBadge,
  type AccountOption,
} from "./account_directory";
import { ADMIN } from "./admin_actor";
import type { Chip } from "./chips";
import { dateTimeLabel, dayLabel, fileSize } from "./format";
import { filled } from "./form_values";
import { href } from "./links";
import { invalid, page, redirect, refused, type Outcome } from "./outcome";
import { runUseCase } from "./presenter";
import type { MediaUseCases } from "./use_cases";

export const MEDIA_PAGE = "/dashboard/media";
/** Items shown per account on the page. */
export const MEDIA_PER_ACCOUNT = 24;
/** What the file input offers; the server sniffs the bytes whatever the browser sends. */
export const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

const TYPE_NAMES: Readonly<Record<string, string>> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
};

export interface MediaItemView {
  readonly id: string;
  /** The label, or "Untitled". */
  readonly label: string;
  readonly labelled: boolean;
  /** The same-origin, session-only route the thumbnail is served from. */
  readonly fileUrl: string;
  readonly type: string;
  readonly size: string;
  readonly uploaded: string;
  /** "Dashboard upload" or the URL's host. */
  readonly source: string;
  readonly status: Chip;
  /** When the cleanup deletes it, in words; null while a waiting post holds it. */
  readonly expires: string | null;
  /** Unused media may be deleted; a live post's may not. */
  readonly canDelete: boolean;
}

export interface MediaSection {
  readonly badge: AccountBadge;
  /** The person it belongs to, or "Unassigned". */
  readonly owner: string;
  readonly items: readonly MediaItemView[];
}

export interface UploadOption {
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

/** The upload form's account select: one group per person, then Unassigned. */
export interface UploadGroup {
  readonly label: string;
  readonly options: readonly UploadOption[];
}

export interface MediaPageView {
  readonly groups: readonly UploadGroup[];
  readonly accounts: readonly AccountOption[];
  /** The sections with media, in the upload select's order. */
  readonly sections: readonly MediaSection[];
  /** Accounts in view with nothing staged. */
  readonly emptyAccounts: number;
  /** Just uploaded: its media_id, to copy for a bot. */
  readonly uploaded: string | null;
  readonly accept: string;
  readonly maxLabel: number;
  readonly filtered: boolean;
}

export interface MediaQuery {
  readonly account: string | null;
  readonly uploaded: string | null;
}

export interface UploadForm {
  readonly account: string;
  readonly label: string;
  /** The file's bytes, or null when no file was chosen. */
  readonly bytes: Uint8Array | null;
}

export interface MediaFileView {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

function itemView(listing: MediaListing): MediaItemView {
  const { media, used, expiresAt } = listing;
  return {
    id: media.id,
    label: media.label ?? "Untitled",
    labelled: media.label !== null,
    fileUrl: `${MEDIA_PAGE}/${encodeURIComponent(media.id)}/file`,
    type: TYPE_NAMES[media.contentType] ?? media.contentType,
    size: fileSize(media.size),
    uploaded: dateTimeLabel(media.stagedAt),
    source: media.source.kind === "dashboard" ? "Dashboard upload" : media.source.host,
    status: used ? { label: "Used", tone: "good" } : { label: "Unused", tone: "neutral" },
    expires:
      expiresAt === null
        ? null
        : `${used ? "Kept until" : "Deleted if unused on"} ${dayLabel(expiresAt)}`,
    canDelete: !used,
  };
}

/** The accounts in the select's order: each person's (people by name), then the unassigned. */
function ordered(
  accounts: readonly Account[],
  people: readonly PersonListing[],
): readonly { readonly account: Account; readonly owner: string | null }[] {
  const owned = people.flatMap(({ person, accountIds }) =>
    accounts
      .filter((account) => accountIds.includes(account.id))
      .map((account) => ({ account, owner: person.name })),
  );
  const assigned = new Set(owned.map(({ account }) => account.id));
  const rest = accounts
    .filter((account) => !assigned.has(account.id))
    .map((account) => ({ account, owner: null }));
  return [...owned, ...rest];
}

function groupsOf(
  rows: ReturnType<typeof ordered>,
  all: readonly Account[],
  selected: string | null,
): readonly UploadGroup[] {
  const groups: { label: string; options: UploadOption[] }[] = [];
  for (const { account, owner } of rows) {
    const label = owner ?? "Unassigned";
    const option = {
      value: account.id,
      label: badgeOf(all, account.id).handle,
      selected: account.id === selected,
    };
    const last = groups.at(-1);
    if (last?.label === label) {
      last.options.push(option);
    } else {
      groups.push({ label, options: [option] });
    }
  }
  return groups;
}

/**
 * The Media page (GROKCHAT-18): upload a file for one account, see each account's recent media
 * with a thumbnail, its media_id to copy for a bot, and delete what no post uses.
 */
export class MediaController {
  constructor(private readonly useCases: MediaUseCases) {}

  async media(query: MediaQuery): Promise<Outcome<MediaPageView>> {
    const accounts = await loadAccounts(this.useCases);
    const people = await runUseCase(this.useCases.listPeople, { actor: ADMIN }, (output) =>
      output.ok ? output.people : [],
    );
    const filter = filled(query.account);
    if (filter !== null && !accounts.some((account) => account.id === filter)) {
      return invalid("Unknown account.");
    }
    const rows = ordered(accounts, people);
    const inView = rows.filter(({ account }) => filter === null || account.id === filter);
    const sections: MediaSection[] = [];
    for (const { account, owner } of inView) {
      const items = await this.listed(account);
      if (items.length > 0) {
        sections.push({
          badge: badgeOf(accounts, account.id),
          owner: owner ?? "Unassigned",
          items,
        });
      }
    }
    return page({
      groups: groupsOf(rows, accounts, filter),
      accounts: accountOptions(accounts, filter),
      sections,
      emptyAccounts: inView.length - sections.length,
      uploaded: filled(query.uploaded),
      accept: MEDIA_ACCEPT,
      maxLabel: MAX_LABEL_LENGTH,
      filtered: filter !== null,
    });
  }

  private listed(account: Account): Promise<readonly MediaItemView[]> {
    const input = {
      actor: ADMIN,
      accountId: account.id,
      status: "all" as const,
      limit: MEDIA_PER_ACCOUNT,
    };
    return runUseCase(this.useCases.listMedia, input, (output) =>
      output.ok ? output.items.map(itemView) : [],
    );
  }

  upload(form: UploadForm): Promise<Outcome<never>> {
    if (form.bytes === null || form.bytes.length === 0) {
      return Promise.resolve(refused("no_file"));
    }
    const input = {
      actor: ADMIN,
      accountId: accountId(form.account),
      label: form.label,
      bytes: form.bytes,
    };
    return runUseCase(this.useCases.upload, input, (output) =>
      output.ok
        ? redirect(href(MEDIA_PAGE, { account: form.account, uploaded: output.mediaId }))
        : refused(output.code),
    );
  }

  remove(id: string): Promise<Outcome<never>> {
    return runUseCase(
      this.useCases.deleteMedia,
      { actor: ADMIN, mediaId: stagedMediaId(id) },
      (output) =>
        output.ok
          ? redirect(href(MEDIA_PAGE, { account: output.accountId }))
          : refused(output.code),
    );
  }

  file(id: string): Promise<Outcome<MediaFileView>> {
    return runUseCase(
      this.useCases.mediaFile,
      { actor: ADMIN, mediaId: stagedMediaId(id) },
      (output) =>
        output.ok
          ? page({ bytes: output.bytes, contentType: output.contentType })
          : refused(output.code),
    );
  }
}
