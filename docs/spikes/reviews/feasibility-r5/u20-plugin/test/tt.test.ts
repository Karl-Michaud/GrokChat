import { it, expect } from "vitest";
// @ts-expect-error no types
import twttr from "twitter-text";
it("twitter-text runs inside workerd", () => {
  const r = twttr.parseTweet("hello 👾 see grokchat.ai");
  console.log("[R5] twitter-text in workerd:", r.weightedLength, JSON.stringify(twttr.extractUrls("see grokchat.ai")));
  expect(r.weightedLength).toBe(33);
});
