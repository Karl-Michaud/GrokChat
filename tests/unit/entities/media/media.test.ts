import { describe, expect, it } from "vitest";
import {
  KEEP_AFTER_DONE,
  KEEP_UNUSED,
  mediaCleanupDue,
} from "../../../../src/entities/media/media_cleanup";
import { checkMediaUrl } from "../../../../src/entities/media/media_url";
import {
  canRead,
  canStore,
  monthKey,
  R2_GUARDS,
  usageAt,
  type MediaUsage,
} from "../../../../src/entities/media/r2_quota";
import { DAY } from "../../../../src/entities/time/instant";
import { aMedia, aPost, part, sentState, T0 } from "../../support/builders";

const usage = (overrides: Partial<MediaUsage> = {}): MediaUsage => ({
  month: "2026-10",
  storedBytes: 0,
  classA: 0,
  classB: 0,
  ...overrides,
});

describe("R2 quota guard (plan §3.5)", () => {
  it("guards sit below the free allowance", () => {
    expect(R2_GUARDS).toStrictEqual({
      storedBytes: 8_000_000_000,
      classA: 800_000,
      classB: 8_000_000,
    });
    expect(monthKey(T0)).toBe("2026-10");
  });

  it("a new month resets the operation counts but not the stored bytes", () => {
    const old = usage({ month: "2026-09", storedBytes: 5, classA: 9, classB: 9 });
    expect(usageAt(old, T0)).toStrictEqual(usage({ storedBytes: 5 }));
    const current = usage({ classA: 3 });
    expect(usageAt(current, T0)).toBe(current);
  });

  it("canStore: refused once the bytes would pass 8 GB or Class A reaches 800k", () => {
    expect(canStore(usage({ storedBytes: 7_999_999_000 }), 1_000, T0)).toStrictEqual({
      allowed: true,
    });
    expect(canStore(usage({ storedBytes: 7_999_999_000 }), 1_001, T0)).toStrictEqual({
      allowed: false,
      reason: "media_quota",
    });
    expect(canStore(usage({ classA: 799_999 }), 1, T0).allowed).toBe(true);
    expect(canStore(usage({ classA: 800_000 }), 1, T0).allowed).toBe(false);
    expect(canStore(usage({ month: "2026-09", classA: 800_000 }), 1, T0).allowed).toBe(true);
  });

  it("canRead: refused once Class B reaches 8M", () => {
    expect(canRead(usage({ classB: 7_999_999 }), T0)).toStrictEqual({ allowed: true });
    expect(canRead(usage({ classB: 8_000_000 }), T0)).toStrictEqual({
      allowed: false,
      reason: "media_quota",
    });
    expect(canRead(usage({ month: "2026-09", classB: 8_000_000 }), T0).allowed).toBe(true);
  });
});

describe("mediaCleanupDue", () => {
  const media = aMedia({ stagedAt: T0 });

  it("unused, or attached to a cancelled or missed post: two days after staging", () => {
    expect(KEEP_UNUSED).toBe(2 * DAY);
    for (const post of [null, aPost({ lifecycle: "CANCELLED" }), aPost({ lifecycle: "MISSED" })]) {
      expect(mediaCleanupDue(media, post, T0 + 2 * DAY - 1)).toBe(false);
      expect(mediaCleanupDue(media, post, T0 + 2 * DAY)).toBe(true);
    }
  });

  it("kept while its post waits or publishes", () => {
    for (const lifecycle of [
      "DRAFT",
      "PENDING_REVIEW",
      "SCHEDULED",
      "RESUMING",
      "PUBLISHING",
    ] as const) {
      expect(mediaCleanupDue(media, aPost({ lifecycle }), T0 + 100 * DAY)).toBe(false);
    }
  });

  it("seven days after its post's last sent part, or after staging if none was sent", () => {
    expect(KEEP_AFTER_DONE).toBe(7 * DAY);
    const done = aPost({
      lifecycle: "DONE",
      parts: [part("a", sentState("x1", T0 + DAY)), part("b", sentState("x2", T0 + 2 * DAY))],
    });
    expect(mediaCleanupDue(media, done, T0 + 9 * DAY - 1)).toBe(false);
    expect(mediaCleanupDue(media, done, T0 + 9 * DAY)).toBe(true);
    const failed = aPost({
      lifecycle: "DONE",
      parts: [part("a", { kind: "REJECTED", reason: "r" })],
    });
    expect(mediaCleanupDue(media, failed, T0 + 7 * DAY - 1)).toBe(false);
    expect(mediaCleanupDue(media, failed, T0 + 7 * DAY)).toBe(true);
  });
});

describe("checkMediaUrl (SSRF policy, U18)", () => {
  const hosts = ["cdn.example.com", "Images.Example.org", "1cdn.example.com", "host9", "a0x.com"];

  it.each([
    "https://cdn.example.com/a.png",
    "https://CDN.example.com",
    "https://images.example.org:443/x?y#z",
    "https://cdn.example.com?x",
    "https://cdn.example.com#x",
    "https://1cdn.example.com/x",
    "https://host9/x",
    "https://a0x.com/x",
  ])("allows %s", (url) => {
    expect(checkMediaUrl(url, hosts)).toStrictEqual({ allowed: true });
  });

  it.each([
    ["not_https", "http://cdn.example.com/a.png"],
    ["not_https", "ftp://cdn.example.com/a.png"],
    ["not_https", " https://cdn.example.com/a.png"],
    ["bad_url", "https:///a.png"],
    ["bad_url", "https://user:pw@cdn.example.com/a.png"],
    ["bad_url", "https://:443/a.png"],
    ["literal_ip", "https://127.0.0.1/a.png"],
    ["literal_ip", "https://169.254.169.254/latest"],
    ["literal_ip", "https://[::1]/a.png"],
    ["literal_ip", "https://2130706433/a.png"],
    ["literal_ip", "https://0x7f000001/a.png"],
    ["bad_url", "https://cdn:1.example.com/a.png"],
    ["bad_url", "https://cdn.example.com:44x/a.png"],
    ["host_not_allowed", "https://evil.com/a.png"],
    ["host_not_allowed", "https://cdn.example.com.evil.com/a.png"],
  ] as const)("refuses %s: %s", (reason, url) => {
    expect(checkMediaUrl(url, hosts)).toStrictEqual({ allowed: false, reason });
  });
});
