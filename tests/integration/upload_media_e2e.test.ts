/**
 * A bot's own image end to end through main.ts in workerd (GROKCHAT-20), on the production graph
 * (D1, R2, the account's Durable Object; X faked at `fetch` only): a real JPEG sent in three
 * base64 parts with upload_media, found by list_media, then posted with create_post; one part of
 * the full 256 KiB in one call (no body limit below it); and each refusal with its code. The
 * expired upload's cleanup runs through the metrics cron.
 */
import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_MEDIA_BYTES } from "../../src/entities/content/staged_media";
import { MAX_PART_BYTES } from "../../src/entities/media/upload_parts";
import { CRONS } from "../../src/frameworks/cron/dispatch";
import { R2PendingUploads, UPLOADS_PREFIX } from "../../src/frameworks/r2/r2_pending_uploads";
import worker from "../../src/main";
import { freshStorage } from "./support/fresh_d1";
import { MASCOT_JPEG } from "./support/mascot_jpeg";
import { body, botEnv, connect, isError, seedAccount } from "./support/mcp_client";
import { stubX, type XWire } from "./support/x_wire";

let x: XWire;
beforeEach(async () => {
  await freshStorage();
  x = stubX();
});
afterEach(() => {
  x.restore();
});

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** `bytes` cut into `count` parts of (nearly) equal size. */
function cut(bytes: Uint8Array, count: number): Uint8Array[] {
  const size = Math.ceil(bytes.length / count);
  return Array.from({ length: count }, (_, index) => bytes.slice(index * size, (index + 1) * size));
}

interface PartCall {
  readonly account: string;
  readonly file: Uint8Array;
  readonly part: Uint8Array;
  readonly index: number;
  readonly count: number;
  readonly uploadId?: string;
  readonly fileSha256?: string;
  readonly partSha256?: string;
  readonly data?: string;
}

async function sendPart(client: Client, call: PartCall) {
  return client.callTool({
    name: "upload_media",
    arguments: {
      account_id: call.account,
      label: "mascot",
      sha256: call.fileSha256 ?? (await sha256(call.file)),
      data_base64: call.data ?? base64(call.part),
      part_sha256: call.partSha256 ?? (await sha256(call.part)),
      part_index: call.index,
      part_count: call.count,
      ...(call.uploadId === undefined ? {} : { upload_id: call.uploadId }),
    },
  });
}

/** Sends every part in order and answers with the last result. */
async function upload(client: Client, account: string, file: Uint8Array, count: number) {
  const parts = cut(file, count);
  let uploadId: string | undefined;
  let last: unknown = null;
  for (const [index, part] of parts.entries()) {
    last = await sendPart(client, {
      account,
      file,
      part,
      index,
      count,
      ...(uploadId === undefined ? {} : { uploadId }),
    });
    uploadId ??= String(body(last)["upload_id"]);
  }
  return last;
}

const creates = () =>
  x.seen
    .filter((request) => request.method === "POST" && request.url.pathname === "/2/tweets")
    .map((request) => JSON.parse(request.body) as { media?: { media_ids: string[] } });

async function pendingKeys(): Promise<readonly string[]> {
  return (await env.MEDIA.list({ prefix: UPLOADS_PREFIX })).objects.map((object) => object.key);
}

describe("upload_media: a bot's own image, in parts, then posted (GROKCHAT-20)", () => {
  it("a real JPEG in 3 parts → media_id → list_media → create_post on the fake X", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const parts = cut(MASCOT_JPEG, 3);
    const file = MASCOT_JPEG;
    const first = await sendPart(client, {
      account: account.id,
      file,
      part: parts[0] ?? file,
      index: 0,
      count: 3,
    });
    expect(isError(first)).toBe(false);
    expect(body(first)).toMatchObject({ complete: false, missing_parts: [1, 2] });
    const uploadId = String(body(first)["upload_id"]);
    const third = await sendPart(client, {
      account: account.id,
      file,
      part: parts[2] ?? file,
      index: 2,
      count: 3,
      uploadId,
    });
    expect(body(third)).toStrictEqual({ complete: false, upload_id: uploadId, missing_parts: [1] });
    // A resent part is harmless.
    await sendPart(client, {
      account: account.id,
      file,
      part: parts[2] ?? file,
      index: 2,
      count: 3,
      uploadId,
    });
    const done = await sendPart(client, {
      account: account.id,
      file,
      part: parts[1] ?? file,
      index: 1,
      count: 3,
      uploadId,
    });
    expect(body(done)).toMatchObject({
      complete: true,
      kind: "PHOTO",
      size_bytes: MASCOT_JPEG.length,
      upload_id: uploadId,
    });
    const mediaId = String(body(done)["media_id"]);
    expect(await pendingKeys()).toStrictEqual([`${UPLOADS_PREFIX}${uploadId}/upload`]);

    const listed = body(
      await client.callTool({ name: "list_media", arguments: { account_id: account.id } }),
    );
    expect(listed["media"]).toMatchObject([
      {
        media_id: mediaId,
        label: "mascot",
        content_type: "image/jpeg",
        source: "bot_upload",
        bytes: MASCOT_JPEG.length,
      },
    ]);
    const row = await env.DB.prepare("SELECT source, sha256 FROM staged_media WHERE id = ?")
      .bind(mediaId)
      .first<{ source: string; sha256: string }>();
    expect(row).toStrictEqual({ source: "bot_upload", sha256: await sha256(MASCOT_JPEG) });

    const created = await client.callTool({
      name: "create_post",
      arguments: {
        account_id: account.id,
        text: "our mascot",
        media_ids: [mediaId],
        idempotency_key: "k-mascot",
      },
    });
    expect(body(created)).toMatchObject({ status: "PUBLISHED" });
    expect(creates()[0]?.media?.media_ids).toHaveLength(1);
    const uploads = x.seen.filter((request) => request.url.pathname.includes("/media/upload"));
    expect(uploads.length).toBeGreaterThan(0);
  });

  it("the last two parts sent together (parallel tool calls) stage the file once", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const file = MASCOT_JPEG;
    const parts = cut(file, 3);
    const call = (index: number, uploadId?: string) =>
      sendPart(client, {
        account: account.id,
        file,
        part: parts[index] ?? file,
        index,
        count: 3,
        ...(uploadId === undefined ? {} : { uploadId }),
      });
    const uploadId = String(body(await call(0))["upload_id"]);
    const answers = (await Promise.all([call(1, uploadId), call(2, uploadId)])).map(body);
    expect(answers.filter((answer) => answer["complete"] === true)).toHaveLength(1);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM staged_media").first<{
      n: number;
    }>();
    expect(rows?.n).toBe(1);
    expect((await env.MEDIA.list({ prefix: "media/" })).objects).toHaveLength(1);
    expect(await pendingKeys()).toStrictEqual([`${UPLOADS_PREFIX}${uploadId}/upload`]);
    const again = body(await call(1, uploadId));
    expect(again).toStrictEqual(answers.find((answer) => answer["complete"] === true));
  });

  it("one part of the full 256 KiB (about 350,000 base64 characters) goes through in one call", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const file = new Uint8Array(MAX_PART_BYTES);
    file.set(MASCOT_JPEG);
    const sent = await sendPart(client, {
      account: account.id,
      file,
      part: file,
      index: 0,
      count: 1,
    });
    expect(base64(file).length).toBeGreaterThan(349_000);
    expect(body(sent)).toMatchObject({
      complete: true,
      kind: "PHOTO",
      size_bytes: MAX_PART_BYTES,
      upload_id: null,
    });
    expect(await pendingKeys()).toStrictEqual([]);
  });
});

describe("upload_media refusals, each with its code (GROKCHAT-20)", () => {
  it("a garbled part is refused at once, naming it; only that part is resent", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const file = MASCOT_JPEG;
    const parts = cut(file, 2);
    const first = await sendPart(client, {
      account: account.id,
      file,
      part: parts[0] ?? file,
      index: 0,
      count: 2,
    });
    const uploadId = String(body(first)["upload_id"]);
    const garbled = (parts[1] ?? file).slice();
    garbled[3] = (garbled[3] ?? 0) ^ 0xff;
    const refused = await sendPart(client, {
      account: account.id,
      file,
      part: parts[1] ?? file,
      data: base64(garbled),
      index: 1,
      count: 2,
      uploadId,
    });
    expect(isError(refused)).toBe(true);
    expect(body(refused)).toMatchObject({ error: "part_hash_mismatch", part: 1 });
    expect(String(body(refused)["message"])).toContain(await sha256(garbled));
    const resent = await sendPart(client, {
      account: account.id,
      file,
      part: parts[1] ?? file,
      index: 1,
      count: 2,
      uploadId,
    });
    expect(body(resent)).toMatchObject({ complete: true, kind: "PHOTO" });
  });

  it("a wrong whole-file hash is refused once every part is in, and the upload is discarded", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const file = MASCOT_JPEG;
    const parts = cut(file, 2);
    const fileSha256 = "0".repeat(64);
    const first = await sendPart(client, {
      account: account.id,
      file,
      part: parts[0] ?? file,
      index: 0,
      count: 2,
      fileSha256,
    });
    const uploadId = String(body(first)["upload_id"]);
    const last = await sendPart(client, {
      account: account.id,
      file,
      part: parts[1] ?? file,
      index: 1,
      count: 2,
      uploadId,
      fileSha256,
    });
    expect(body(last)).toMatchObject({ error: "file_hash_mismatch", part: null });
    expect(await pendingKeys()).toStrictEqual([]);
  });

  it("a missing part stages nothing: the answer names it, and list_media has no file", async () => {
    const account = await seedAccount();
    const client = await connect(await botEnv([account.id]));
    const file = MASCOT_JPEG;
    const parts = cut(file, 3);
    const first = await sendPart(client, {
      account: account.id,
      file,
      part: parts[0] ?? file,
      index: 0,
      count: 3,
    });
    const uploadId = String(body(first)["upload_id"]);
    const third = await sendPart(client, {
      account: account.id,
      file,
      part: parts[2] ?? file,
      index: 2,
      count: 3,
      uploadId,
    });
    expect(body(third)).toStrictEqual({ complete: false, upload_id: uploadId, missing_parts: [1] });
    const listed = body(
      await client.callTool({
        name: "list_media",
        arguments: { account_id: account.id, status: "all" },
      }),
    );
    expect(listed["media"]).toStrictEqual([]);
  });

  it("an expired upload is refused and its parts deleted; the metrics cron cleans the rest", async () => {
    const account = await seedAccount();
    const workerEnv = await botEnv([account.id]);
    const client = await connect(workerEnv);
    const pending = new R2PendingUploads(env.MEDIA);
    const file = MASCOT_JPEG;
    const parts = cut(file, 2);
    for (const id of ["old-1", "old-2"]) {
      const opened = {
        id,
        accountId: account.id,
        fileSha256: await sha256(file),
        partCount: 2,
        label: null,
        expiresAt: Date.now() - 1,
        mediaId: null,
      };
      await pending.open(opened);
      await pending.putPart(
        opened,
        { index: 0, sha256: await sha256(parts[0] ?? file), size: 1 },
        parts[0] ?? file,
      );
    }
    const refused = await sendPart(client, {
      account: account.id,
      file,
      part: parts[1] ?? file,
      index: 1,
      count: 2,
      uploadId: "old-1",
    });
    expect(body(refused)).toMatchObject({ error: "upload_expired" });
    expect(await pendingKeys()).toStrictEqual(["uploads/old-2/part/0", "uploads/old-2/upload"]);
    await worker.scheduled(
      createScheduledController({ cron: CRONS.metrics, scheduledTime: Date.now() }),
      workerEnv,
    );
    expect(await pendingKeys()).toStrictEqual([]);
  });

  it("not an image, too large for its kind, and another person's account", async () => {
    const account = await seedAccount();
    const theirs = await seedAccount();
    const client = await connect(await botEnv([account.id], [theirs.id]));
    const text = new TextEncoder().encode("not an image at all");
    const notMedia = await sendPart(client, {
      account: account.id,
      file: text,
      part: text,
      index: 0,
      count: 1,
    });
    expect(body(notMedia)).toMatchObject({ error: "not_media" });

    const big = new Uint8Array(MAX_MEDIA_BYTES.PHOTO + 1);
    big.set(MASCOT_JPEG);
    const tooLarge = await upload(client, account.id, big, Math.ceil(big.length / MAX_PART_BYTES));
    expect(body(tooLarge)).toMatchObject({ error: "too_large" });
    expect(await pendingKeys()).toStrictEqual([]);

    const scope = await sendPart(client, {
      account: theirs.id,
      file: MASCOT_JPEG,
      part: MASCOT_JPEG,
      index: 0,
      count: 1,
    });
    expect(body(scope)).toMatchObject({ error: "scope" });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM staged_media").first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });
});
