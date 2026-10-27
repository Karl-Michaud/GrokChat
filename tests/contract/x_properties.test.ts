/** fast-check properties of the X drivers: chunking, timeline order, rate-limit windows, base64url. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SECOND } from "../../src/entities/time/instant";
import { base64Url } from "../../src/frameworks/x_auth/webcrypto_pkce";
import { rateLimit } from "../../src/frameworks/x_http/x_errors";
import { CHUNK_BYTES, HttpXMediaUploader } from "../../src/frameworks/x_http/x_media_driver";
import { HttpXOwnTimelineReader } from "../../src/frameworks/x_http/x_timeline_driver";
import { AccountXUserDirectory } from "../../src/frameworks/x_http/x_user_directory";
import { MemoryAccountRepository } from "../../src/frameworks/memory/memory_repositories";
import { ACCOUNT, anAccount, T0 } from "../unit/support/builders";
import { clientSetup, respond } from "./support/x_fixtures";

describe("chunked GIF upload", () => {
  it("the segments are numbered from 0, each ≤ 5 MB, and add up to the file", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3 * CHUNK_BYTES }), async (size) => {
        const { client, transport } = clientSetup();
        transport.script(respond(200, { data: { id: "1" } }));
        const segments = Math.ceil(size / CHUNK_BYTES);
        for (let i = 0; i < segments; i += 1) {
          transport.script(respond(204, null));
        }
        transport.script(respond(200, { data: { id: "1" } }));
        const uploader = new HttpXMediaUploader(client, () => Promise.resolve());
        expect((await uploader.upload(ACCOUNT, new Uint8Array(size), "GIF")).ok).toBe(true);
        const appends = transport.seen.filter((s) => s.url.pathname.endsWith("/append"));
        const sizes = appends.map((s) => {
          const media = s.form?.get("media");
          return media instanceof Blob ? media.size : -1;
        });
        expect(appends.map((s) => s.form?.get("segment_index"))).toStrictEqual(
          sizes.map((_, i) => String(i)),
        );
        expect(sizes.every((n) => n > 0 && n <= CHUNK_BYTES)).toBe(true);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(size);
      }),
      { numRuns: 25 },
    );
  });
});

describe("own timeline", () => {
  it("whatever X returns, the result is ≥ since, oldest first, ≤ maxResults, and X's own", async () => {
    const post = fc.record({
      id: fc.bigInt({ min: 1n, max: 10n ** 18n }),
      at: fc.integer({ min: -60, max: 600 }),
    });
    await fc.assert(
      fc.asyncProperty(
        fc.array(post, { maxLength: 30 }),
        fc.integer({ min: 0, max: 12 }),
        async (posts, max) => {
          const { client, transport, clock } = clientSetup();
          const accounts = new MemoryAccountRepository();
          accounts.rows.set(ACCOUNT, anAccount());
          const reader = new HttpXOwnTimelineReader(
            client,
            new AccountXUserDirectory(accounts),
            clock,
          );
          const data = posts.map((p) => ({
            id: p.id.toString(),
            text: "t",
            created_at: new Date(T0 + p.at * SECOND).toISOString(),
          }));
          transport.script(respond(200, { data }));
          const result = await reader.recent(ACCOUNT, T0, max);
          const value = result.ok ? result.value : [];
          const eligible = posts.filter((p) => p.at >= 0).length;
          expect(value).toHaveLength(Math.min(max, eligible));
          expect(value.every((p) => p.createdAt >= T0)).toBe(true);
          expect(
            value.every((p, i) => i === 0 || (value[i - 1]?.createdAt ?? 0) <= p.createdAt),
          ).toBe(true);
          const all = posts
            .filter((p) => p.at >= 0)
            .map((p) => T0 + p.at * SECOND)
            .sort((a, b) => a - b);
          expect(value.map((p) => p.createdAt)).toStrictEqual(all.slice(0, max));
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("rate-limit windows", () => {
  it("an exhausted app window always wins and is the app's; otherwise it is the user's", () => {
    const remaining = fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined });
    const reset = fc.integer({ min: 1, max: 2_000_000_000 });
    fc.assert(
      fc.property(
        remaining,
        remaining,
        reset,
        reset,
        reset,
        (app, user, appReset, userReset, reset15) => {
          const headers = new Headers({ "x-rate-limit-reset": String(reset15) });
          if (app !== undefined) {
            headers.set("x-app-limit-24hour-remaining", String(app));
            headers.set("x-app-limit-24hour-reset", String(appReset));
          }
          if (user !== undefined) {
            headers.set("x-user-limit-24hour-remaining", String(user));
            headers.set("x-user-limit-24hour-reset", String(userReset));
          }
          const limit = rateLimit(headers);
          if (app === 0) {
            expect(limit).toStrictEqual({ scope: "app", retryAt: appReset * SECOND });
          } else {
            expect(limit.scope).toBe("user");
            expect(limit.retryAt).toBe((user === 0 ? userReset : reset15) * SECOND);
          }
        },
      ),
    );
  });
});

describe("base64url", () => {
  it("round-trips through atob and uses only the URL-safe alphabet, unpadded", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        const encoded = base64Url(bytes);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
        const standard = encoded.replaceAll("-", "+").replaceAll("_", "/");
        const padded = standard + "=".repeat((4 - (standard.length % 4)) % 4);
        expect(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))).toStrictEqual(bytes);
      }),
    );
  });
});
