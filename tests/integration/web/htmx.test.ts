import { describe, expect, it } from "vitest";
import { HTMX } from "../../../src/frameworks/web/static_assets";

describe("vendored htmx", () => {
  it("is the file its SRI hash names", async () => {
    const digest = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(HTMX.source));
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    expect(`sha384-${base64}`).toBe(HTMX.integrity);
    expect(HTMX.source.length).toBe(52182);
  });
});
