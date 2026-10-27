/**
 * The dashboard's post commands end to end through main.ts in workerd (GROKCHAT-13, carried from
 * GROKCHAT-14): edit, cancel, reject, reschedule and delete on posts a bot created in D1, on the
 * production graph, with only X's HTTP faked. The delete goes through `AccountObjects` to the
 * account's Durable Object, which deletes the post on X.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { derivedStatus } from "../../src/entities/posts/derived_status";
import { postId } from "../../src/entities/identity/ids";
import { MINUTE } from "../../src/entities/time/instant";
import { CRONS } from "../../src/frameworks/cron/dispatch";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import type { Env } from "../../src/frameworks/env";
import worker from "../../src/main";
import { connectThroughDashboard, setUpAccount } from "./support/dashboard_flow";
import { freshStorage } from "./support/fresh_d1";
import { body, botEnv, connect } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";
import { Browser, webEnv } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

let x: XWire;
beforeEach(async () => {
  await freshStorage();
  x = stubX();
  x.me = { id: "x-cmd-1", username: "cmd_muse" };
});
afterEach(() => {
  vi.useRealTimers();
  x.restore();
});

async function publishTick(workerEnv: Env): Promise<void> {
  const controller = createScheduledController({ cron: CRONS.publish, scheduledTime: Date.now() });
  await worker.scheduled(controller, workerEnv);
}

/** The post's status as D1 holds it. */
async function statusOf(id: string): Promise<string | undefined> {
  const post = await d1Stores(env.DB).reader.get(postId(id));
  return post === null ? undefined : derivedStatus(post);
}

/** `YYYY-MM-DDTHH:MM` UTC, the dashboard's time field, at or before `at`. */
const minuteOf = (at: number): string => new Date(at).toISOString().slice(0, 16);

async function create(bot: Client, accountId: string, text: string): Promise<string> {
  const args = { account_id: accountId, text, idempotency_key: text };
  const created = body(await bot.callTool({ name: "create_post", arguments: args }));
  expect(created).toMatchObject({ status: "PENDING_REVIEW" });
  return String(created["post_id"]);
}

describe("the dashboard's post commands on D1, through main.ts", () => {
  it("edits, cancels, rejects, reschedules a missed post, publishes it and deletes it on X", async () => {
    const dashboardEnv = await webEnv();
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      dashboardEnv,
    );
    const account = await connectThroughDashboard(browser, x);
    await setUpAccount(browser, account);
    const bot = await connect(await botEnv([account.id], [], dashboardEnv));
    const [edited, rejected, missed] = [
      await create(bot, account.id, "first draft"),
      await create(bot, account.id, "not this one"),
      await create(bot, account.id, "late but wanted"),
    ];
    const page = (id: string) => `/dashboard/posts/${id}`;

    // Edit: the new text is stored in D1; then cancel it.
    await browser.page(page(edited));
    const edit = { text: ["second draft"], media: [""], publishAt: "" };
    expect((await browser.post(`${page(edited)}/edit`, edit)).status).toBe(303);
    const stored = await d1Stores(env.DB).reader.get(postId(edited));
    expect(stored?.parts.map((p) => p.text)).toStrictEqual(["second draft"]);
    expect((await browser.page(page(edited))).html).toContain("second draft");
    expect((await browser.post(`${page(edited)}/cancel`)).status).toBe(303);
    expect(await statusOf(edited)).toBe("CANCELLED");

    // Reject the second; approve the third, which then waits past its 30-minute grace.
    expect((await browser.post(`${page(rejected)}/reject`)).status).toBe(303);
    expect(await statusOf(rejected)).toBe("CANCELLED");
    expect((await browser.post(`${page(missed)}/approve`)).status).toBe(303);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31 * MINUTE });
    await publishTick(dashboardEnv);
    expect(await statusOf(missed)).toBe("MISSED");
    expect(x.emulator.posts.size).toBe(0);

    // Reschedule it to now: the next tick publishes it from the account's Durable Object.
    await browser.page(page(missed));
    const moved = await browser.post(`${page(missed)}/reschedule`, {
      publishAt: minuteOf(Date.now()),
    });
    expect(moved.status).toBe(303);
    expect(await statusOf(missed)).toBe("SCHEDULED");
    await publishTick(dashboardEnv);
    expect(await statusOf(missed)).toBe("PUBLISHED");
    const [sent, ...others] = x.emulator.posts.values();
    expect([sent?.text, others]).toStrictEqual(["late but wanted", []]);

    // Delete it: the Durable Object deletes it on X, and D1 records the part DELETED.
    await browser.page(page(missed));
    const before = x.calls().length;
    expect((await browser.post(`${page(missed)}/delete`)).status).toBe(303);
    expect(x.calls().slice(before)).toStrictEqual([`DELETE /2/tweets/${sent?.id ?? ""}`]);
    expect(x.emulator.posts.size).toBe(0);
    expect(await statusOf(missed)).toBe("DELETED");
    expect((await browser.page(page(missed))).html).toContain("DELETED");
    // Nothing else reached X: no send for the edited, cancelled or rejected posts.
    const sends = x.calls().filter((call) => call === "POST /2/tweets");
    expect(sends).toHaveLength(1);
  });
});
