import sys, yaml
from twitter_text import parse_tweet, extract_urls
v = yaml.safe_load(open(sys.argv[1]))["tests"]; e = yaml.safe_load(open(sys.argv[2]))["tests"]
for group in ("WeightedTweetsCounterTest", "WeightedTweetsWithDiscountedEmojiCounterTest", "UnicodeDirectionalMarkerCounterTest"):
    ok = bad = 0
    for t in v[group]:
        r = parse_tweet(t["text"]); exp = t["expected"]
        if r.weightedLength == exp["weightedLength"] and r.valid == exp["valid"]: ok += 1
        else: bad += 1
    print(group, "pass", ok, "fail", bad)
for group in ("urls",):
    ok = bad = 0
    for t in e[group]:
        got = extract_urls(t["text"])
        if got == t["expected"]: ok += 1
        else: bad += 1
    print("extract", group, "pass", ok, "fail", bad)
print("bare domain:", extract_urls("see grokchat.ai today"), parse_tweet("see grokchat.ai today").weightedLength)
