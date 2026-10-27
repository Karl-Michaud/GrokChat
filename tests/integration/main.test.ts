import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../src/main";

describe("GET /health through the deployed entry point (wrangler.jsonc main)", () => {
  it("answers 200 with the service status as JSON", async () => {
    const response = await exports.default.fetch("https://grokchat.test/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toStrictEqual({ service: "grokchat", status: "ok" });
  });

  it("answers 404 for a route that does not exist", async () => {
    const response = await exports.default.fetch("https://grokchat.test/nope");
    expect(response.status).toBe(404);
  });

  it("does not serve /health to a POST", async () => {
    const response = await exports.default.fetch("https://grokchat.test/health", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

describe("the default export", () => {
  it("serves /health when called directly", async () => {
    const response = await worker.fetch(
      new Request("https://grokchat.test/health"),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
  });

  it("has a scheduled handler that dispatches by cron (tests/integration/cron_ticks.test.ts)", async () => {
    await expect(
      worker.scheduled(createScheduledController({ cron: "0 * * * *" }), env),
    ).rejects.toThrow('no tick is scheduled as "0 * * * *"');
  });
});

describe("the declared bindings", () => {
  it("binds D1 as DB, the AccountPublisher Durable Object as ACCOUNT and R2 as MEDIA", async () => {
    const row = await env.DB.prepare("SELECT 41 + 1 AS v").first<{ v: number }>();
    expect(row?.v).toBe(42);
    expect(env.ACCOUNT.idFromName("account-1").toString()).toMatch(/^[0-9a-f]{64}$/);
    await env.MEDIA.put("probe", "x");
    expect(await (await env.MEDIA.get("probe"))?.text()).toBe("x");
  });
});
