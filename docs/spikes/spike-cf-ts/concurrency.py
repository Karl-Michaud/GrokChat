"""Concurrency checks for the TypeScript spike, each with a negative control.

D1 claim: 20 concurrent claimers over 50 scheduled rows. With the outer state guard every row is
claimed at most once; the control drops the guard.
Durable Object: 10 concurrent publishes for one account with cap 3, where each publish awaits an
outbound fetch between its cap check and its write. "blocked" (blockConcurrencyWhile) must send
exactly 3; the control "naive" shows what happens without it.
"""

import json
import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

C = str(Path(__file__).parent / "c.sh")


def get(path: str) -> dict:
    out = subprocess.run([C, path], capture_output=True, text=True, timeout=60).stdout
    return json.loads(out)


def d1_claim(guard: bool, claimers: int = 20) -> dict:
    get("/test/d1?op=setup&n=50")
    q = "on" if guard else "off"
    with ThreadPoolExecutor(claimers) as ex:
        results = list(ex.map(lambda i: get(f"/test/d1?op=claim&claimer=c{i}&guard={q}"), range(claimers)))
    ids = [i for r in results for i in r["ids"]]
    dup = {k: v for k, v in Counter(ids).items() if v > 1}
    return {"guard": guard, "claims": len(ids), "distinct": len(set(ids)), "claimed_twice": dup}


def do_publish(mode: str, n: int = 10, cap: int = 3) -> dict:
    acct = f"acct-{mode}"
    get(f"/test/do?op=reset&account={acct}")
    with ThreadPoolExecutor(n) as ex:
        results = list(ex.map(lambda _: get(f"/test/do?mode={mode}&cap={cap}&account={acct}"), range(n)))
    total = get(f"/test/do?op=total&account={acct}")["total"]
    return {"mode": mode, "cap": cap, "requests": n, "reported_sent": sum(r["sent"] for r in results), "rows_written": total}


if __name__ == "__main__":
    which = sys.argv[1:] or ["d1", "do"]
    if "d1" in which:
        print(json.dumps(d1_claim(True)))
        print(json.dumps(d1_claim(False)))
    if "do" in which:
        print(json.dumps(do_publish("blocked")))
        print(json.dumps(do_publish("naive")))
