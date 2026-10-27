import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/main";
import { Browser, ORIGIN, webEnv, X_CLIENT_ID } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

/** The dashboard through the deployed entry point, on D1 and the real X OAuth connector. */
describe("the dashboard through main.ts", () => {
  it("logs in, creates a personality, starts an X connect, and keeps /health", async () => {
    const env = await webEnv();
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.get("/dashboard/backlog")).status).toBe(303);
    expect((await browser.login()).status).toBe(303);
    expect((await browser.page("/dashboard/backlog")).html).toContain("No posts.");
    const saved = await browser.post("/dashboard/personalities", {
      id: "",
      name: "Main Muse",
      voiceGuide: "",
      topics: "",
      dos: "",
      donts: "",
      examples: "",
    });
    expect(saved.status).toBe(303);
    const personalities = await browser.page("/dashboard/personalities");
    expect(personalities.html).toContain("Main Muse (version 1)");
    const id = /name="id" value="([0-9a-f-]{36})"/.exec(personalities.html)?.[1] ?? "";
    const started = await browser.post("/oauth/x/start", { personality: id });
    expect(started.status).toBe(303);
    const location = new URL(started.headers.get("location") ?? "");
    expect(location.origin).toBe("https://x.com");
    expect(location.searchParams.get("client_id")).toBe(X_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/oauth/x/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toMatch(/^[0-9a-f-]{36}$/);
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const page of ["calendar", "accounts", "metrics", "costs", "media", "audit"]) {
      expect((await browser.page(`/dashboard/${page}`)).status).toBe(200);
    }
    expect((await browser.get("/health")).status).toBe(200);
  });

  it("keeps the personality in D1, and refuses to start a connect without the X app's secrets", async () => {
    const env = await webEnv({ X_CLIENT_ID: "" });
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.login()).status).toBe(303);
    const saved = await browser.post("/dashboard/personalities", {
      id: "",
      name: "Stored Muse",
      voiceGuide: "",
      topics: "",
      dos: "",
      donts: "",
      examples: "",
    });
    expect(saved.status).toBe(303);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM personalities WHERE name = ?")
      .bind("Stored Muse")
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
    const personalities = await browser.page("/dashboard/personalities");
    const id = /name="id" value="([0-9a-f-]{36})"/.exec(personalities.html)?.[1] ?? "";
    expect((await browser.post("/oauth/x/start", { personality: id })).status).toBe(500);
  });

  it("answers 503 on the dashboard while unconfigured, and 404 elsewhere", async () => {
    const env = await webEnv({ GROKCHAT_SESSION_SECRET: "" });
    const browser = new Browser(
      (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
      env,
    );
    expect((await browser.get("/dashboard/login")).status).toBe(503);
    expect((await browser.get("/nope")).status).toBe(404);
  });
});
