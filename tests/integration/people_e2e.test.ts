/**
 * People and their tokens end to end through main.ts in workerd (GROKCHAT-16): the dashboard
 * creates a person, assigns accounts and issues a token; the MCP endpoint, on the same D1, lets
 * that token reach exactly the person's accounts, follows every assignment at once with no
 * reissue, and stops the token on a rotation or a delete. The token appears only in the POST
 * answer that made it: never in a URL, a GET, the audit log or a log line.
 */
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { personId } from "../../src/entities/identity/ids";
import { d1Stores } from "../../src/frameworks/d1/d1_stores";
import type { Env } from "../../src/frameworks/env";
import worker from "../../src/main";
import { freshStorage } from "./support/fresh_d1";
import { body, call, connect, initialize, isError, seedAccount } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";
import { Browser, issuedField, webEnv } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

let x: XWire;
let lines: string[];
beforeEach(async () => {
  await freshStorage();
  x = stubX();
  lines = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  x.restore();
});

async function owner(): Promise<{ browser: Browser; workerEnv: Env }> {
  const workerEnv = { ...(await webEnv()), GROKCHAT_MEDIA_HOSTS: "media.example" };
  const browser = new Browser(
    (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
    workerEnv,
  );
  expect((await browser.login()).status).toBe(303);
  await browser.page("/dashboard/accounts");
  return { browser, workerEnv };
}

async function createPerson(browser: Browser, name: string): Promise<string> {
  expect((await browser.post("/dashboard/people", { name })).status).toBe(303);
  const person = await d1Stores(env.DB).people.findByName(name);
  if (person === null) {
    throw new Error("not created");
  }
  return person.id;
}

/** Issues the token from the dashboard and reads it off the one-time panel. */
async function issueToken(
  browser: Browser,
  person: string,
): Promise<{ token: string; response: Response; html: string }> {
  const { html: page } = await browser.page("/dashboard/accounts");
  const response = await browser.post(`/dashboard/people/${person}/token`, {
    issued: issuedField(page, person),
  });
  const html = await response.text();
  const token = /data-copy="([^"]+)"\s+aria-label="Copy token"/.exec(html)?.[1] ?? "";
  if (token === "") {
    throw new Error(html.slice(0, 3000));
  }
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { token, response, html };
}

async function myAccounts(workerEnv: Env, token: string): Promise<string[]> {
  const client = await connect(workerEnv, token);
  const result = body(await client.callTool({ name: "list_accounts", arguments: {} }));
  return (result["accounts"] as { account_id: string }[]).map((account) => account.account_id);
}

async function status(workerEnv: Env, token: string): Promise<number> {
  const response = await call(workerEnv, initialize("/mcp", { authorization: `Bearer ${token}` }));
  return response.status;
}

describe("a person's token, from the dashboard to the MCP endpoint", () => {
  it("reaches exactly the person's accounts, and follows each assignment with the same token", async () => {
    const { browser, workerEnv } = await owner();
    const [a, b, other] = [await seedAccount(), await seedAccount(), await seedAccount()];
    const karl = await createPerson(browser, "Karl");
    const aaron = await createPerson(browser, "Aaron");
    await browser.page("/dashboard/accounts");
    expect((await browser.post(`/dashboard/accounts/${a.id}/owner`, { person: karl })).status).toBe(
      303,
    );
    expect(
      (await browser.post(`/dashboard/accounts/${other.id}/owner`, { person: aaron })).status,
    ).toBe(303);
    const { token, response, html } = await issueToken(browser, karl);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(html).toContain('hx-history="false"');
    expect(html).toContain(`Bearer ${token}`);
    expect(html).toContain(`@${a.handle}`);

    expect(await myAccounts(workerEnv, token)).toStrictEqual([a.id]);
    const client = await connect(workerEnv, token);
    const refused = await client.callTool({
      name: "get_policy",
      arguments: { account_id: other.id },
    });
    expect([isError(refused), body(refused)]).toStrictEqual([true, { error: "scope", part: null }]);

    // Assigning another account widens the same token at once; unassigning narrows it.
    await browser.post(`/dashboard/accounts/${b.id}/owner`, { person: karl });
    expect(await myAccounts(workerEnv, token)).toStrictEqual([a.id, b.id].sort());
    await browser.post(`/dashboard/accounts/${a.id}/owner`, { person: "" });
    expect(await myAccounts(workerEnv, token)).toStrictEqual([b.id]);

    // The audit says who acted (`bot:<person id>`) and what the owner did, never the token.
    await client.callTool({ name: "get_policy", arguments: { account_id: other.id } });
    const audit = await env.DB.prepare("SELECT actor, action, detail FROM audit_events").all<{
      actor: string;
      action: string;
      detail: string;
    }>();
    const rows = audit.results;
    expect(rows).toContainEqual({
      actor: `bot:${karl}`,
      action: "refused.policy.get",
      detail: "scope",
    });
    expect(rows).toContainEqual({
      actor: "human:admin",
      action: "person.token",
      detail: `person ${karl} generated`,
    });
    expect(JSON.stringify(rows)).not.toContain(token);

    // No GET shows the token, and no log line has it.
    for (const path of ["/dashboard/accounts", "/dashboard/activity", "/dashboard/analytics"]) {
      expect((await browser.page(path)).html).not.toContain(token);
    }
    expect((await browser.page("/dashboard/accounts")).html).toContain("Token set");
    expect(lines.join("\n")).not.toContain(token);
  });

  it("rotating revokes the old token at once; deleting the person revokes the new one", async () => {
    const { browser, workerEnv } = await owner();
    const account = await seedAccount();
    const karl = await createPerson(browser, "Karl");
    await browser.page("/dashboard/accounts");
    await browser.post(`/dashboard/accounts/${account.id}/owner`, { person: karl });
    const first = await issueToken(browser, karl);
    expect(await status(workerEnv, first.token)).toBe(200);
    await browser.page("/dashboard/accounts");
    const second = await issueToken(browser, karl);
    expect(second.html).toContain("The previous token has stopped working.");
    expect(await status(workerEnv, first.token)).toBe(401);
    expect(await myAccounts(workerEnv, second.token)).toStrictEqual([account.id]);

    await browser.page("/dashboard/accounts");
    const wrong = await browser.post(`/dashboard/people/${karl}/delete`, { confirmation: "Carl" });
    expect(wrong.status).toBe(400);
    expect(await status(workerEnv, second.token)).toBe(200);
    const deleted = await browser.post(`/dashboard/people/${karl}/delete`, {
      confirmation: "karl",
    });
    expect(deleted.status).toBe(303);
    expect(await status(workerEnv, second.token)).toBe(401);
    expect(await d1Stores(env.DB).owners.list()).toStrictEqual([]);
    expect((await browser.page("/dashboard/accounts")).html).toContain("Unassigned");
  });

  it("a reload re-sending the token form rotates nothing; rotating again is a deliberate press (GROKCHAT-18)", async () => {
    const { browser, workerEnv } = await owner();
    const account = await seedAccount();
    const karl = await createPerson(browser, "Karl");
    await browser.post(`/dashboard/accounts/${account.id}/owner`, { person: karl });
    const { html: page } = await browser.page("/dashboard/accounts");
    const form = { issued: issuedField(page, karl) };
    const first = await browser.post(`/dashboard/people/${karl}/token`, form);
    const token = /data-copy="([^"]+)"\s+aria-label="Copy token"/.exec(await first.text())?.[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = (await d1Stores(env.DB).people.get(personId(karl)))?.token;

    // The browser's reload re-sends the same body: nothing rotates, the token keeps working.
    const resent = await browser.post(`/dashboard/people/${karl}/token`, form);
    const html = await resent.text();
    expect([resent.status, resent.headers.get("cache-control")]).toStrictEqual([200, "no-store"]);
    expect(html).toContain("This token was already issued.");
    expect(html).not.toContain('aria-label="Copy token"');
    expect((await d1Stores(env.DB).people.get(personId(karl)))?.token).toStrictEqual(stored);
    expect(await status(workerEnv, token ?? "")).toBe(200);

    // Its "Rotate again" carries the current token's nonce: one press, one rotation.
    const again = { issued: issuedField(html, karl) };
    expect(again.issued).toBe(String(stored?.createdAt));
    const rotated = await browser.post(`/dashboard/people/${karl}/token`, again);
    expect(await rotated.text()).toContain("The previous token has stopped working.");
    expect(await status(workerEnv, token ?? "")).toBe(401);
    const audit = await env.DB.prepare(
      "SELECT action, detail FROM audit_events WHERE action LIKE '%person.token' ORDER BY seq",
    ).all<{ action: string; detail: string }>();
    expect(audit.results).toStrictEqual([
      { action: "person.token", detail: `person ${karl} generated` },
      { action: "refused.person.token", detail: "token_already_issued" },
      { action: "person.token", detail: `person ${karl} rotated` },
    ]);
  });

  it("a token form with no nonce issues nothing", async () => {
    const { browser } = await owner();
    const karl = await createPerson(browser, "Karl");
    await browser.page("/dashboard/accounts");
    const response = await browser.post(`/dashboard/people/${karl}/token`);
    expect(await response.text()).toContain("This token was already issued.");
    expect((await d1Stores(env.DB).people.get(personId(karl)))?.token).toBeNull();
  });

  it("issues nothing without the session's CSRF token or from another origin", async () => {
    const { browser } = await owner();
    const karl = await createPerson(browser, "Karl");
    const path = `/dashboard/people/${karl}/token`;
    expect((await browser.post(path, {}, { csrf: null })).status).toBe(403);
    expect((await browser.post(path, {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await d1Stores(env.DB).people.get(personId(karl)))?.token).toBeNull();
  });
});
