/**
 * The owner's first steps on the dashboard, through main.ts (shared by the end-to-end tests):
 * connect the X user `x.me` through X's OAuth, then confirm the disclosure, set REVIEW mode and
 * activate the account.
 */
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { Account } from "../../../src/entities/accounts/account";
import { xUserId } from "../../../src/entities/identity/ids";
import { d1Stores } from "../../../src/frameworks/d1/d1_stores";
import type { Browser } from "../web/browser";
import type { XWire } from "./x_wire";

/** The owner logs in, adds a personality and connects the X user `x.me` through X's OAuth. */
export async function connectThroughDashboard(browser: Browser, x: XWire): Promise<Account> {
  expect((await browser.login()).status).toBe(303);
  const saved = await browser.post("/dashboard/personalities", {
    ...{ id: "", name: "E2E Muse", voiceGuide: "", topics: "", dos: "", donts: "", examples: "" },
  });
  expect(saved.status).toBe(303);
  const page = await browser.page("/dashboard/personalities");
  const personality = /name="id" value="([0-9a-f-]{36})"/.exec(page.html)?.[1] ?? "";
  const started = await browser.post("/oauth/x/start", { personality });
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";
  const finished = await browser.get(`/oauth/x/finish?code=code-e2e&state=${state}`);
  expect([finished.status, finished.headers.get("location")]).toStrictEqual([
    303,
    `/dashboard/accounts?connected=%40${x.me.username}`,
  ]);
  // X saw the code exchange and the who-am-I, nothing else.
  expect(x.calls()).toStrictEqual(["POST /2/oauth2/token", "GET /2/users/me"]);
  const account = await d1Stores(env.DB).accounts.findByXUserId(xUserId(x.me.id));
  expect(account).toMatchObject({ handle: x.me.username, status: "PAUSED" });
  if (account === null) {
    throw new Error("the connect stored no account");
  }
  return account;
}

/** The owner confirms the disclosure, asks to review every post, and activates the account. */
export async function setUpAccount(browser: Browser, account: Account): Promise<void> {
  await browser.page("/dashboard/accounts");
  const base = `/dashboard/accounts/${account.id}`;
  const policy = {
    mode: "REVIEW",
    dailyCap: "10",
    minGapMinutes: "0",
    quietStart: "",
    quietEnd: "",
    tz: "UTC",
    linkPolicy: "REFUSE",
    graceMinutes: "30",
  };
  for (const [path, form] of [
    ["/disclosure", { bioConfirmed: "yes", automatedLabelConfirmed: "yes" }],
    ["/policy", policy],
    ["/status?to=ACTIVE", {}],
  ] as const) {
    expect((await browser.post(`${base}${path}`, form)).status).toBeLessThan(400);
  }
  expect(await d1Stores(env.DB).accounts.get(account.id)).toMatchObject({
    status: "ACTIVE",
    disclosure: { bioConfirmed: true, automatedLabelConfirmed: true },
    policy: { mode: "REVIEW", minGap: 0 },
  });
}
