import json, sys, collections
from urllib.parse import urlparse, parse_qs
raw = open(sys.argv[1]).read()
dec = json.JSONDecoder(); i = 0; evs = []
while True:
    while i < len(raw) and raw[i].isspace(): i += 1
    if i >= len(raw): break
    o, i = dec.raw_decode(raw, i); evs.append(o)
rows = []
for e in evs:
    ev = e.get("event") or {}
    req = ev.get("request") or {}
    url = req.get("url", "")
    kind = e.get("executionModel")
    if not url and kind == "durableObject":
        url = "(DO rpc)"
    rows.append(dict(t=e.get("eventTimestamp"), model=kind, outcome=e.get("outcome"), cpu=e.get("cpuTime"), wall=e.get("wallTime"),
                     path=urlparse(url).path, run=(parse_qs(urlparse(url).query).get("run") or [""])[0],
                     status=(ev.get("response") or {}).get("status"), exc=[x.get("message") for x in e.get("exceptions", [])]))
json.dump(rows, open(sys.argv[2], "w"), indent=0)
print("events", len(evs), "outcomes", collections.Counter(r["outcome"] for r in rows), "models", collections.Counter(r["model"] for r in rows))
for r in rows:
    if r["model"] != "durableObject": print(r["path"], r["run"], r["outcome"], "cpu", r["cpu"], "wall", r["wall"], r["status"], r["exc"] or "")
do = [r["cpu"] for r in rows if r["model"] == "durableObject"]
if do: print("DO events", len(do), "cpu max", max(do), "mean", round(sum(do)/len(do), 2))
