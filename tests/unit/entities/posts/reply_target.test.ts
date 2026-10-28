import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { accountId, xPostId } from "../../../../src/entities/identity/ids";
import { requestHash } from "../../../../src/entities/posts/new_post";
import { replyTargetId } from "../../../../src/entities/posts/reply_target";

describe("replyTargetId", () => {
  it("takes a bare post id, trimmed", () => {
    expect(replyTargetId("1850000000000000001")).toBe("1850000000000000001");
    expect(replyTargetId("  42\n")).toBe("42");
    expect(replyTargetId("1".repeat(20))).toBe("1".repeat(20));
  });

  it("takes the post's URL on x.com or twitter.com, with or without a query or a suffix", () => {
    for (const url of [
      "https://x.com/someone/status/42",
      "https://x.com/someone/status/42?s=20&t=abc",
      "https://x.com/someone/status/42/photo/1",
      "https://x.com/someone/status/42#reply",
      "http://www.twitter.com/Some_One/status/42",
      "https://mobile.twitter.com/someone/statuses/42",
      "https://X.COM/i/web/status/42",
    ]) {
      expect(replyTargetId(url)).toBe("42");
    }
  });

  it("refuses anything else", () => {
    for (const raw of [
      "",
      " ",
      "abc",
      "-1",
      "1.5",
      "1".repeat(21),
      "https://example.com/someone/status/42",
      "see https://x.com/someone/status/42",
      "https://x.com.evil.example/someone/status/42",
      "https://x.com/someone",
      "https://x.com/someone/status/",
      "https://x.com/someone/status/42abc",
      "https://x.com/a_name_too_long_for_x/status/42",
      "ftp://x.com/someone/status/42",
    ]) {
      expect(replyTargetId(raw)).toBeNull();
    }
  });

  it("an original post's request hash leaves the target out, so hashes stored before still match", () => {
    const parts = [{ text: "hi", media: [] }];
    expect(requestHash(accountId("a"), parts, null, null)).toBe(
      JSON.stringify({ account: "a", parts, publishAt: null }),
    );
    expect(requestHash(accountId("a"), parts, null, xPostId("42"))).toBe(
      JSON.stringify({ account: "a", parts, publishAt: null, replyTo: "42" }),
    );
  });

  it("any id round-trips, bare or in a URL", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{1,20}$/),
        fc.stringMatching(/^\w{1,15}$/),
        (id, handle) => {
          expect(replyTargetId(id)).toBe(id);
          expect(replyTargetId(`https://x.com/${handle}/status/${id}`)).toBe(id);
        },
      ),
    );
  });
});
