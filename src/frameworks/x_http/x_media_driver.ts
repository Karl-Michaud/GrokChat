import type { MediaKind } from "../../entities/content/staged_media";
import { xMediaId, type AccountId, type XMediaId } from "../../entities/identity/ids";
import { SECOND, type Millis } from "../../entities/time/instant";
import type { XResult } from "../../entities/x/x_failure";
import type { XMediaUploader } from "../../use_cases/ports/x_media_uploader";
import { count, field, text } from "./json_fields";
import type { XApiClient } from "./x_api_client";

/** docs.x.com: keep each APPEND chunk at or below 5 MB. */
export const CHUNK_BYTES = 5 * 1024 * 1024;
/** STATUS polls after FINALIZE before giving up (the part budget counts six, plan A4). */
export const MAX_STATUS_POLLS = 6;
/** A media request may carry 5 MB, so it gets the plan's full 20 s (§3.5). */
export const MEDIA_TIMEOUT: Millis = 20 * SECOND;
/** X's `check_after_secs`, bounded so one poll never waits long. */
const MIN_WAIT: Millis = SECOND;
const MAX_WAIT: Millis = 5 * SECOND;

/** Waits between STATUS polls; tests pass a stub that does not sleep. */
export type Wait = (millis: Millis) => Promise<void>;

export const realWait: Wait = (millis) =>
  new Promise((resolve) => {
    setTimeout(resolve, millis);
  });

const MALFORMED: XResult<never> = { ok: false, failure: { kind: "no_response" } };

type Processing = "done" | "pending" | "failed";

function processing(body: unknown): { state: Processing; wait: Millis } {
  const info = field(field(body, "data"), "processing_info");
  const state = text(field(info, "state"));
  const after = (count(field(info, "check_after_secs")) ?? 1) * SECOND;
  const wait = Math.min(MAX_WAIT, Math.max(MIN_WAIT, after));
  if (info === null || state === "succeeded") {
    return { state: "done", wait };
  }
  return { state: state === "failed" ? "failed" : "pending", wait };
}

const mediaIdOf = (body: unknown): string | null => text(field(field(body, "data"), "id"));

const blob = (bytes: Uint8Array): Blob => new Blob([new Uint8Array(bytes)]);

/**
 * Photos by the one-shot `POST /2/media/upload` (multipart, `tweet_image`); GIFs chunked:
 * `initialize` → `append` (≤ 5 MB segments) → `finalize` → `STATUS` polls (docs.x.com media).
 */
export class HttpXMediaUploader implements XMediaUploader {
  constructor(
    private readonly client: XApiClient,
    private readonly wait: Wait = realWait,
  ) {}

  upload(account: AccountId, bytes: Uint8Array, kind: MediaKind): Promise<XResult<XMediaId>> {
    return kind === "PHOTO" ? this.simple(account, bytes) : this.chunked(account, bytes);
  }

  private async simple(account: AccountId, bytes: Uint8Array): Promise<XResult<XMediaId>> {
    const form = new FormData();
    form.append("media", blob(bytes), "media");
    form.append("media_category", "tweet_image");
    const result = await this.client.call(account, {
      method: "POST",
      path: "/2/media/upload",
      form,
      timeout: MEDIA_TIMEOUT,
    });
    if (!result.ok) {
      return result;
    }
    const id = mediaIdOf(result.value);
    return id === null ? MALFORMED : { ok: true, value: xMediaId(id) };
  }

  private async chunked(account: AccountId, bytes: Uint8Array): Promise<XResult<XMediaId>> {
    const init = await this.client.call(account, {
      method: "POST",
      path: "/2/media/upload/initialize",
      json: { media_type: "image/gif", total_bytes: bytes.length, media_category: "tweet_gif" },
    });
    if (!init.ok) {
      return init;
    }
    const id = mediaIdOf(init.value);
    if (id === null) {
      return MALFORMED;
    }
    const appended = await this.appendAll(account, id, bytes);
    return appended.ok ? this.finalize(account, id) : appended;
  }

  private async appendAll(
    account: AccountId,
    id: string,
    bytes: Uint8Array,
  ): Promise<XResult<null>> {
    for (let index = 0; index * CHUNK_BYTES < bytes.length; index += 1) {
      const form = new FormData();
      form.append("segment_index", String(index));
      form.append("media", blob(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)));
      const result = await this.client.call(account, {
        method: "POST",
        path: `/2/media/upload/${encodeURIComponent(id)}/append`,
        form,
        timeout: MEDIA_TIMEOUT,
      });
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true, value: null };
  }

  private async finalize(account: AccountId, id: string): Promise<XResult<XMediaId>> {
    let result = await this.client.call(account, {
      method: "POST",
      path: `/2/media/upload/${encodeURIComponent(id)}/finalize`,
    });
    for (let poll = 0; ; poll += 1) {
      if (!result.ok) {
        return result;
      }
      const { state, wait } = processing(result.value);
      if (state !== "pending") {
        return state === "done" ? { ok: true, value: xMediaId(id) } : processingFailed;
      }
      if (poll === MAX_STATUS_POLLS) {
        return { ok: false, failure: { kind: "not_sent" } };
      }
      await this.wait(wait);
      result = await this.client.call(account, {
        method: "GET",
        path: "/2/media/upload",
        query: { command: "STATUS", media_id: id },
      });
    }
  }
}

const processingFailed: XResult<never> = {
  ok: false,
  failure: { kind: "content_refused", status: 200, detail: "media processing failed" },
};
