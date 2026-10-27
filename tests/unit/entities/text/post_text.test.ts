/**
 * U13: twitter-text 3.1.0 against the upstream conformance suite, through GrokChat's own pure
 * functions where they exist. Fixtures: conformance/validate.yml and extract.yml from
 * github.com/twitter/twitter-text at tag v3.1.0 (commit 65e7e00), unmodified.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import twitterText from "twitter-text";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  containsUrl,
  extractUrls,
  hasSchemeUrl,
  isValidPostText,
  MAX_WEIGHTED_LENGTH,
  normalisePostText,
  weightedLength,
} from "../../../../src/entities/text/post_text";

interface CounterCase {
  readonly description: string;
  readonly text: string;
  readonly expected: { readonly weightedLength: number; readonly valid: boolean };
}

interface ExtractCase<T> {
  readonly description: string;
  readonly text: string;
  readonly expected: T;
}

function fixture(name: string): { readonly raw: string; readonly tests: Record<string, unknown> } {
  const raw = readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");
  return { raw, tests: (parse(raw) as { tests: Record<string, unknown> }).tests };
}

const validate = fixture("validate.yml");
const extract = fixture("extract.yml");
const group = (source: { tests: Record<string, unknown> }, name: string): unknown =>
  source.tests[name];

describe("the fixtures are the upstream files", () => {
  it.each([
    [validate.raw, "29fa1be663676f3d0bb0a67f393b32c15d92c5dd10db9be401bf7708d7c5b703"],
    [extract.raw, "2b4f65d43462eb9785785eb94b633d1eccf920d5047fa17d98a45ea219851c71"],
  ])("sha256 matches", (raw, sha) => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(sha);
  });
});

describe("weighted length (v3, the default config)", () => {
  const v3 = [
    ...(group(validate, "WeightedTweetsWithDiscountedEmojiCounterTest") as readonly CounterCase[]),
    ...(group(validate, "UnicodeDirectionalMarkerCounterTest") as readonly CounterCase[]),
  ];

  it("has the 24 upstream v3 cases", () => {
    expect(v3).toHaveLength(24);
  });

  it.each(v3)("$description", ({ text, expected }) => {
    expect(weightedLength(text)).toBe(expected.weightedLength);
    expect(isValidPostText(text)).toBe(expected.valid);
  });
});

describe("the library's v2 counter (the upstream suite, for the record)", () => {
  const v2 = group(validate, "WeightedTweetsCounterTest") as readonly CounterCase[];
  it.each(v2)("$description", ({ text, expected }) => {
    const parsed = twitterText.parseTweet(text, twitterText.configs.version2);
    expect([parsed.weightedLength, parsed.valid]).toStrictEqual([
      expected.weightedLength,
      expected.valid,
    ]);
  });
});

describe("URL extraction", () => {
  const urls = group(extract, "urls") as readonly ExtractCase<string[]>[];
  it("has the 91 upstream cases", () => {
    expect(urls).toHaveLength(91);
  });

  it.each(urls)("$description", ({ text, expected }) => {
    expect(extractUrls(text)).toStrictEqual(expected);
    expect(containsUrl(text)).toBe(expected.length > 0);
  });

  const withIndices = group(extract, "urls_with_indices") as readonly ExtractCase<
    { url: string; indices: number[] }[]
  >[];
  it.each(withIndices)("with indices: $description", ({ text, expected }) => {
    const found = twitterText
      .extractUrlsWithIndices(text)
      .map(({ url, indices }) => ({ url, indices }));
    expect(found).toStrictEqual(expected);
  });
});

describe("GrokChat's URL rules", () => {
  it("a bare domain is a URL but not a scheme URL (U4: billed as a plain post)", () => {
    expect(containsUrl("see trymusechat.com today")).toBe(true);
    expect(hasSchemeUrl("see trymusechat.com today")).toBe(false);
    expect(hasSchemeUrl("see https://trymusechat.com")).toBe(true);
    expect(hasSchemeUrl("see HTTP://trymusechat.com")).toBe(true);
    expect(hasSchemeUrl("no links here")).toBe(false);
    expect(hasSchemeUrl("a bare.com and http://scheme.com")).toBe(true);
    expect(hasSchemeUrl("see example.com/?u=https://a.b ok")).toBe(false);
  });

  it("detects newer gTLDs", () => {
    expect(extractUrls("try grokchat.app and grokchat.dev")).toStrictEqual([
      "grokchat.app",
      "grokchat.dev",
    ]);
  });

  it("counts emoji as 2 and URLs as 23", () => {
    expect(weightedLength("👾")).toBe(2);
    expect(weightedLength("https://example.com/a/very/long/path/that/is/longer/than/23")).toBe(23);
    expect(MAX_WEIGHTED_LENGTH).toBe(280);
    expect(isValidPostText("")).toBe(false);
    expect(isValidPostText("a".repeat(281))).toBe(false);
    expect(isValidPostText("ok")).toBe(true);
  });
});

describe("normalisePostText", () => {
  it("unescapes X's three entities, NFC-normalises and trims", () => {
    expect(normalisePostText("  a &amp; b &lt;c&gt; d  ")).toBe("a & b <c> d");
    expect(normalisePostText("é")).toBe("é");
    expect(normalisePostText("&quot;kept&quot; &amp;amp;")).toBe("&quot;kept&quot; &amp;");
  });
});
