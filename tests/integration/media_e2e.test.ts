/**
 * Images for bots end to end through main.ts in workerd (GROKCHAT-18), on the production graph
 * (D1, R2, the account's Durable Object; X and the web faked at `fetch` only):
 * - a Grok image link on imgen.x.ai stages under the production allowlist and is posted;
 * - the owner uploads a file on the dashboard's Media page, the bot finds it with list_media and
 *   posts it with create_post; the page shows it with a same-origin thumbnail and deletes it only
 *   while no post uses it;
 * - the upload is refused without a session, without the CSRF token, past the size limit, and
 *   when the bytes are not an image.
 */
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/frameworks/env";
import { MEDIA_FILE_CACHE } from "../../src/frameworks/web/media_routes";
import worker from "../../src/main";
import { freshStorage } from "./support/fresh_d1";
import { body, botEnv, connect, isError, seedAccount } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";
import { Browser, ORIGIN, webEnv } from "./web/browser";

type IncomingRequest = Parameters<typeof worker.fetch>[0];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
/** The shape xAI's image API returns (measured 2026-10-27). */
const GROK_IMAGE =
  "https://imgen.x.ai/xai-imgen/xai-tmp-imgen-5b2b5e0c-8f4e-4c8e-9a51-0c1d2e3f4a5b.jpeg";

let x: XWire;
beforeEach(async () => {
  await freshStorage();
  x = stubX();
});
afterEach(() => {
  x.restore();
});

/** The Worker's env for both sides: the bot's token and the dashboard's secrets, production hosts. */
async function bothSides(accounts: readonly string[]): Promise<Env> {
  const bot = await botEnv(accounts);
  const { GROKCHAT_SESSION_SECRET, GROKCHAT_ADMIN_PASSWORD_HASH, X_CLIENT_ID } = await webEnv();
  return {
    ...bot,
    ...(GROKCHAT_SESSION_SECRET === undefined ? {} : { GROKCHAT_SESSION_SECRET }),
    ...(GROKCHAT_ADMIN_PASSWORD_HASH === undefined ? {} : { GROKCHAT_ADMIN_PASSWORD_HASH }),
    ...(X_CLIENT_ID === undefined ? {} : { X_CLIENT_ID }),
    GROKCHAT_PUBLIC_ORIGIN: ORIGIN,
    GROKCHAT_MEDIA_HOSTS: env.GROKCHAT_MEDIA_HOSTS ?? "",
  };
}

function browserFor(workerEnv: Env): Browser {
  return new Browser(
    (request, e) => worker.fetch(request as IncomingRequest, e, createExecutionContext()),
    workerEnv,
  );
}

async function owner(workerEnv: Env): Promise<Browser> {
  const browser = browserFor(workerEnv);
  expect((await browser.login()).status).toBe(303);
  await browser.page("/dashboard/media");
  return browser;
}

const creates = () =>
  x.seen
    .filter((request) => request.method === "POST" && request.url.pathname === "/2/tweets")
    .map((request) => JSON.parse(request.body) as { media?: { media_ids: string[] } });

async function stagedRows(account: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM staged_media WHERE owner_account_id = ?",
  )
    .bind(account)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

describe("a Grok-generated image (GROKCHAT-18)", () => {
  it("stages from imgen.x.ai under the production allowlist and posts", async () => {
    expect(env.GROKCHAT_MEDIA_HOSTS).toBe("imgen.x.ai");
    const account = await seedAccount();
    x.web.set(GROK_IMAGE, () => new Response(JPEG, { headers: { "content-type": "image/jpeg" } }));
    const client = await connect(await bothSides([account.id]));
    const staged = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url: GROK_IMAGE },
    });
    expect(body(staged)).toMatchObject({ kind: "PHOTO", size_bytes: JPEG.length });
    const listed = body(
      await client.callTool({ name: "list_media", arguments: { account_id: account.id } }),
    );
    expect(listed["media"]).toMatchObject([
      { media_id: body(staged)["media_id"], source: "imgen.x.ai", label: null, used: false },
    ]);
    const created = await client.callTool({
      name: "create_post",
      arguments: {
        account_id: account.id,
        text: "made with Grok",
        media_ids: [String(body(staged)["media_id"])],
        idempotency_key: "k-grok-image",
      },
    });
    expect(body(created)).toMatchObject({ status: "PUBLISHED" });
    expect(creates()[0]?.media?.media_ids).toHaveLength(1);
  });

  it("refuses any other host, naming the allowed one", async () => {
    const account = await seedAccount();
    const client = await connect(await bothSides([account.id]));
    const refused = await client.callTool({
      name: "stage_media_from_url",
      arguments: { account_id: account.id, url: "https://example.com/banner.png" },
    });
    expect(isError(refused)).toBe(true);
    expect(body(refused)).toMatchObject({ error: "host_not_allowed" });
    expect(String(body(refused)["message"])).toContain("Allowed hosts: imgen.x.ai.");
  });
});

describe("a dashboard upload a bot finds (GROKCHAT-18)", () => {
  it("upload → Media page with thumbnail → list_media → create_post; then it cannot be deleted", async () => {
    const account = await seedAccount();
    const workerEnv = await bothSides([account.id]);
    const browser = await owner(workerEnv);
    const uploaded = await browser.upload(
      "/dashboard/media",
      { account: account.id, label: "launch banner" },
      { name: "banner.txt", type: "text/plain", bytes: PNG },
    );
    expect(uploaded.status).toBe(303);
    const location = uploaded.headers.get("location") ?? "";
    const mediaId = new URL(location, ORIGIN).searchParams.get("uploaded") ?? "";
    expect(mediaId).not.toBe("");

    const { html } = await browser.page(location);
    expect(html).toContain("launch banner");
    expect(html).toContain(`data-copy="${mediaId}"`);
    const thumbnail = `/dashboard/media/${mediaId}/file`;
    expect(html).toContain(`src="${thumbnail}"`);
    const file = await browser.get(thumbnail);
    expect([
      file.status,
      file.headers.get("content-type"),
      file.headers.get("cache-control"),
    ]).toStrictEqual([200, "image/png", MEDIA_FILE_CACHE]);
    expect(new Uint8Array(await file.arrayBuffer())).toStrictEqual(PNG);
    expect((await browserFor(workerEnv).get(thumbnail)).status).not.toBe(200);

    const client = await connect(workerEnv);
    const listed = body(
      await client.callTool({ name: "list_media", arguments: { account_id: account.id } }),
    );
    expect(listed).toMatchObject({
      account_id: account.id,
      media: [
        {
          media_id: mediaId,
          label: "launch banner",
          content_type: "image/png",
          bytes: PNG.length,
          source: "dashboard",
          used: false,
        },
      ],
    });
    const created = await client.callTool({
      name: "create_post",
      arguments: {
        account_id: account.id,
        text: "our banner",
        media_ids: [mediaId],
        idempotency_key: "k-upload",
      },
    });
    expect(body(created)).toMatchObject({ status: "PUBLISHED" });
    expect(creates()[0]?.media?.media_ids).toHaveLength(1);

    const all = body(
      await client.callTool({
        name: "list_media",
        arguments: { account_id: account.id, status: "all" },
      }),
    );
    expect(all["media"]).toMatchObject([{ media_id: mediaId, used: true }]);
    const unused = body(
      await client.callTool({ name: "list_media", arguments: { account_id: account.id } }),
    );
    expect(unused["media"]).toStrictEqual([]);

    await browser.page("/dashboard/media");
    expect((await browser.post(`/dashboard/media/${mediaId}/delete`)).status).toBe(409);
    expect(await stagedRows(account.id)).toBe(1);
    const audit = await env.DB.prepare(
      "SELECT actor, action FROM audit_events WHERE action LIKE '%media.%' ORDER BY seq",
    ).all<{ actor: string; action: string }>();
    expect(audit.results).toContainEqual({ actor: "human:admin", action: "media.upload" });
    expect(audit.results).toContainEqual({ actor: "human:admin", action: "refused.media.delete" });
  });

  it("deletes unused media: the row and the bytes", async () => {
    const account = await seedAccount();
    const workerEnv = await bothSides([account.id]);
    const browser = await owner(workerEnv);
    const uploaded = await browser.upload(
      "/dashboard/media",
      { account: account.id, label: "" },
      { name: "a.png", type: "image/png", bytes: PNG },
    );
    const mediaId = new URL(uploaded.headers.get("location") ?? "", ORIGIN).searchParams.get(
      "uploaded",
    );
    const before = await env.MEDIA.list({ prefix: "media/" });
    const deleted = await browser.post(`/dashboard/media/${mediaId ?? ""}/delete`);
    expect([deleted.status, deleted.headers.get("location")]).toStrictEqual([
      303,
      `/dashboard/media?account=${account.id}`,
    ]);
    expect(await stagedRows(account.id)).toBe(0);
    const after = await env.MEDIA.list({ prefix: "media/" });
    expect(after.objects.length).toBe(before.objects.length - 1);
    expect((await browser.page("/dashboard/media")).html).toContain("No media yet");
  });

  it("refuses an upload without a session, without the CSRF token, too large, or not an image", async () => {
    const account = await seedAccount();
    const workerEnv = await bothSides([account.id]);
    const anonymous = await browserFor(workerEnv).upload(
      "/dashboard/media",
      { account: account.id },
      { name: "a.png", type: "image/png", bytes: PNG },
    );
    expect(anonymous.status).not.toBe(303);
    const browser = await owner(workerEnv);
    const file = { name: "a.png", type: "image/png", bytes: PNG };
    const noCsrf = await browser.upload("/dashboard/media", { account: account.id }, file, {
      csrf: null,
    });
    expect(noCsrf.status).toBe(403);
    const huge = {
      name: "big.gif",
      type: "image/gif",
      bytes: new Uint8Array(15 * 1024 * 1024 + 70_000),
    };
    const tooLarge = await browser.upload("/dashboard/media", { account: account.id }, huge);
    expect(tooLarge.status).toBe(413);
    const text = { name: "a.png", type: "image/png", bytes: new TextEncoder().encode("not a png") };
    const notMedia = await browser.upload("/dashboard/media", { account: account.id }, text);
    expect(notMedia.status).toBe(400);
    expect(await notMedia.text()).toContain("its contents were checked, not its name");
    const none = await browser.upload("/dashboard/media", { account: account.id }, null);
    expect(none.status).toBe(400);
    expect(await stagedRows(account.id)).toBe(0);
  });

  it("an ordinary form is still capped at 64 KB; only the Media upload takes a file", async () => {
    const account = await seedAccount();
    const browser = await owner(await bothSides([account.id]));
    const big = await browser.post("/dashboard/people", { name: "x".repeat(70_000) });
    expect(big.status).toBe(413);
    const elsewhere = await browser.upload(
      "/dashboard/people",
      { name: "Karl" },
      { name: "a.gif", type: "image/gif", bytes: new Uint8Array(70_000) },
    );
    expect(elsewhere.status).toBe(413);
  });
});
