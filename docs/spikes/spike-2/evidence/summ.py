import json, sys
def strip(x):
    if isinstance(x, dict): return {k: strip(v) for k, v in x.items() if k not in ("attempts", "perDo")}
    return x
for f in sys.argv[1:]:
    d = json.loads(open(f).read().split("\n[http")[0])
    print(f, json.dumps(strip(d)))
