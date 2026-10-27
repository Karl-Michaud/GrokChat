"""U4: which posts does X bill as "Post: Create (with URL)"?

Posts three posts on the test account (plain, https URL, bare domain), records their ids and the
rate-limit headers, then deletes them. Pricing is read afterwards from the Developer Console's Usage
page (counts per billable event). Uses X_TEST_REFRESH_TOKEN (rotating, single-use: the new one is
saved before the access token is used). Prints no token values.
"""

import json
import time
from pathlib import Path

import httpx

from u1_refresh import ENV, TOKEN_URL, env, fp, set_env

OUT = Path(__file__).parent / "u4_results.json"
API = "https://api.x.com/2"


def access_token(e: dict) -> str:
    r = httpx.post(TOKEN_URL, data={"grant_type": "refresh_token", "refresh_token": e["X_TEST_REFRESH_TOKEN"]},
                   auth=(e["X_CLIENT_ID"], e["X_CLIENT_SECRET"]), timeout=30)
    r.raise_for_status()
    body = r.json()
    set_env("X_TEST_REFRESH_TOKEN", body["refresh_token"])  # persist the rotated token first (U1)
    return body["access_token"]


def main() -> None:
    e = env()
    tok = access_token(e)
    h = {"Authorization": f"Bearer {tok}"}
    stamp = time.strftime("%H:%M:%S", time.gmtime())
    variants = {
        "plain": f"GrokChat API test, plain text, deleting in a minute ({stamp}Z)",
        "https_url": f"GrokChat API test with a link https://trymusechat.com ({stamp}Z)",
        "bare_domain": f"GrokChat API test with a bare domain trymusechat.com ({stamp}Z)",
    }
    res: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "posts": {}, "deletes": {}}
    for name, text in variants.items():
        r = httpx.post(f"{API}/tweets", json={"text": text}, headers=h, timeout=30)
        body = r.json() if r.headers.get("content-type", "").startswith("application") else {"raw": r.text[:200]}
        res["posts"][name] = {"http": r.status_code, "id": (body.get("data") or {}).get("id"), "body_keys": sorted(body),
                              "errors": body.get("errors") or body.get("detail") or body.get("title"),
                              "ratelimit_remaining": r.headers.get("x-rate-limit-remaining"),
                              "ratelimit_limit": r.headers.get("x-rate-limit-limit")}
        time.sleep(2)
    time.sleep(20)
    for name, p in res["posts"].items():
        if p["id"]:
            r = httpx.delete(f"{API}/tweets/{p['id']}", headers=h, timeout=30)
            res["deletes"][name] = {"http": r.status_code, "body": r.json() if r.content else None}
    OUT.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
