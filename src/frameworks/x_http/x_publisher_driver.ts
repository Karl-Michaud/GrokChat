import { xPostId, type AccountId, type XMediaId, type XPostId } from "../../entities/identity/ids";
import type { XResult } from "../../entities/x/x_failure";
import type { XPublisher } from "../../use_cases/ports/x_publisher";
import { field, text } from "./json_fields";
import type { XApiClient } from "./x_api_client";

/** A 2xx whose body X did not shape as documented: X may have acted, so the outcome is unknown. */
const MALFORMED: XResult<never> = { ok: false, failure: { kind: "no_response" } };

/**
 * `POST /2/tweets` (201 → `data.id`) and `DELETE /2/tweets/:id` (200 → `data.deleted`), with the
 * account's user token (docs.x.com create-post, delete-post; U4).
 */
export class HttpXPublisher implements XPublisher {
  constructor(private readonly client: XApiClient) {}

  async create(
    account: AccountId,
    postText: string,
    media: readonly XMediaId[],
    inReplyTo: XPostId | null,
  ): Promise<XResult<XPostId>> {
    const result = await this.client.call(account, {
      method: "POST",
      path: "/2/tweets",
      json: {
        text: postText,
        ...(media.length > 0 ? { media: { media_ids: media } } : {}),
        ...(inReplyTo === null ? {} : { reply: { in_reply_to_tweet_id: inReplyTo } }),
      },
    });
    if (!result.ok) {
      return result;
    }
    const id = text(field(field(result.value, "data"), "id"));
    return id === null ? MALFORMED : { ok: true, value: xPostId(id) };
  }

  async delete(account: AccountId, xPost: XPostId): Promise<XResult<null>> {
    const result = await this.client.call(account, {
      method: "DELETE",
      path: `/2/tweets/${encodeURIComponent(xPost)}`,
    });
    if (!result.ok) {
      return result;
    }
    return field(field(result.value, "data"), "deleted") === true
      ? { ok: true, value: null }
      : { ok: false, failure: { kind: "content_refused", status: 200, detail: "not deleted" } };
  }
}
