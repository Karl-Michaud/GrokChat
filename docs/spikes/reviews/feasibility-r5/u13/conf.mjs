import fs from "node:fs";
import * as yaml from "js-yaml";
import twttr from "twitter-text";
const v = yaml.load(fs.readFileSync("validate.yml", "utf8")).tests;
const e = yaml.load(fs.readFileSync("extract.yml", "utf8")).tests;
const v3 = twttr.configs.version3;
for (const [group, cfg] of [["WeightedTweetsCounterTest", twttr.configs.version2], ["WeightedTweetsWithDiscountedEmojiCounterTest", v3], ["UnicodeDirectionalMarkerCounterTest", v3]]) {
  let ok = 0, bad = 0;
  for (const t of v[group]) { const r = twttr.parseTweet(t.text, cfg); (r.weightedLength === t.expected.weightedLength && r.valid === t.expected.valid) ? ok++ : bad++; }
  console.log(group, "pass", ok, "fail", bad);
}
for (const g of ["urls", "urls_with_indices"]) {
  if (!e[g]) continue;
  let ok = 0, bad = 0;
  for (const t of e[g]) {
    const got = g === "urls" ? twttr.extractUrls(t.text) : twttr.extractUrlsWithIndices(t.text).map(x => ({ url: x.url, indices: x.indices }));
    JSON.stringify(got) === JSON.stringify(t.expected) ? ok++ : bad++;
  }
  console.log("extract", g, "pass", ok, "fail", bad);
}
console.log("default config is v3:", twttr.parseTweet("👾").weightedLength === 2, "| bare domain:", twttr.extractUrls("see grokchat.ai today"), twttr.parseTweet("see grokchat.ai today").weightedLength);
console.log("newer gTLD (.app, 2018):", twttr.extractUrls("try grokchat.app"), "| .xyz:", twttr.extractUrls("try grokchat.xyz"), "| .dev:", twttr.extractUrls("try grokchat.dev"));
