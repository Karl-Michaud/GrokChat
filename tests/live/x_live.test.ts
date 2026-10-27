/**
 * The `live` smoke suite against real X (plan §6, §7.1 PR 4). Never run in CI or by `npm run
 * check`: it is skipped unless GROKCHAT_LIVE=1, and only the owner runs it, on the test account,
 * under an X spending limit (about $0.05 a run: two creates, two reads, two deletes).
 *
 *   GROKCHAT_LIVE=1 X_LIVE_ACCESS_TOKEN=… X_LIVE_USER_ID=… npm run test:live
 *
 * The access token is a user token of the test account (scopes as U1), read from the environment
 * and never printed. What it settles: the field-parameter name (`tweet.fields`), X's timeline
 * order under `start_time`, the duplicate-content 403 body, both media flows, and U4's open
 * question (is a bare domain made clickable: one read of `entities.urls`).
 */
import { describe, expect, it } from "vitest";
import { invocationBudget } from "../../src/entities/budget/budget";
import { accountId, xPostId, xUserId, type XPostId } from "../../src/entities/identity/ids";
import { MINUTE } from "../../src/entities/time/instant";
import { mapXOutcome } from "../../src/entities/x/x_outcome";
import { MemoryBudgetMeter } from "../../src/frameworks/memory/memory_budget";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import { MeteredTransport } from "../../src/frameworks/x_http/metered_transport";
import { FetchTransport } from "../../src/frameworks/x_http/transport";
import { XApiClient } from "../../src/frameworks/x_http/x_api_client";
import { HttpXMediaUploader } from "../../src/frameworks/x_http/x_media_driver";
import { HttpXMetricsReader } from "../../src/frameworks/x_http/x_metrics_driver";
import { HttpXPublisher } from "../../src/frameworks/x_http/x_publisher_driver";
import { HttpXOwnTimelineReader } from "../../src/frameworks/x_http/x_timeline_driver";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { anAccount } from "../unit/support/builders";

const LIVE = process.env["GROKCHAT_LIVE"] === "1";
const ACCOUNT = accountId("live-test-account");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
const GIF = "R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";
const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

function wire() {
  const accessToken = process.env["X_LIVE_ACCESS_TOKEN"] ?? "";
  const userId = process.env["X_LIVE_USER_ID"] ?? "";
  const clock = { now: () => Date.now() };
  const meter = new MemoryBudgetMeter(invocationBudget(clock.now() + 10 * MINUTE));
  const client = new XApiClient(
    new MeteredTransport(new FetchTransport(), meter),
    { accessToken: () => Promise.resolve({ kind: "token", accessToken }) },
    meter,
  );
  const accounts = new MemoryAccountRepository();
  accounts.rows.set(ACCOUNT, anAccount({ id: ACCOUNT, xUserId: xUserId(userId) }));
  return {
    client,
    publisher: new HttpXPublisher(client),
    media: new HttpXMediaUploader(client),
    metrics: new HttpXMetricsReader(client, clock),
    timeline: new HttpXOwnTimelineReader(client, new AccountXUserDirectory(accounts), clock),
  };
}

describe.skipIf(!LIVE)("live X (owner only, GROKCHAT_LIVE=1)", () => {
  const x = LIVE ? wire() : null;
  const made: XPostId[] = [];
  const stamp = new Date().toISOString();
  const since = Date.now() - MINUTE;

  it("creates a plain post and a bare-domain post", async () => {
    for (const text of [`GrokChat live smoke ${stamp}`, `GrokChat trymusechat.com ${stamp}`]) {
      const result = await x?.publisher.create(ACCOUNT, text, [], null);
      expect(result?.ok).toBe(true);
      if (result?.ok === true) {
        made.push(result.value);
      }
    }
  });

  it("a duplicate is refused as content, not as auth", async () => {
    const result = await x?.publisher.create(ACCOUNT, `GrokChat live smoke ${stamp}`, [], null);
    expect(result?.ok === false && mapXOutcome(result.failure, Date.now()).kind).toBe("rejected");
  });

  it("the timeline returns both, oldest first after since", async () => {
    const result = await x?.timeline.recent(ACCOUNT, since, 5);
    expect(result?.ok).toBe(true);
    const ids = result?.ok === true ? result.value.map((post) => post.id) : [];
    expect(ids.filter((id) => made.includes(id))).toStrictEqual(made);
  });

  it("reads metrics, and whether X linked the bare domain (U4)", async () => {
    const result = await x?.metrics.read(ACCOUNT, made);
    expect(result?.ok === true && result.value.length).toBe(made.length);
    const raw = await x?.client.call(ACCOUNT, {
      method: "GET",
      path: "/2/tweets",
      query: { ids: String(made[1]), "tweet.fields": "entities" },
    });
    const urls = JSON.stringify(raw?.ok === true ? raw.value : null).includes('"urls"');
    console.info(`U4: bare domain clickable (entities.urls present): ${String(urls)}`);
  });

  it("uploads a photo (simple) and a GIF (chunked)", async () => {
    expect((await x?.media.upload(ACCOUNT, bytes(PNG), "PHOTO"))?.ok).toBe(true);
    expect((await x?.media.upload(ACCOUNT, bytes(GIF), "GIF"))?.ok).toBe(true);
  });

  it("deletes what it made", async () => {
    for (const id of made) {
      expect(await x?.publisher.delete(ACCOUNT, xPostId(id))).toStrictEqual({
        ok: true,
        value: null,
      });
    }
  });
});
