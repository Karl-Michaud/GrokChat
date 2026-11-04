"""U14: what does X's token endpoint return for a REVOKED refresh token, and does revoking it kill the access token?

Steps: refresh X_TEST_REFRESH_TOKEN -> (A1, R1), persist R1; GET /2/users/me with A1; revoke R1
(POST /2/oauth2/revoke, token_type_hint=refresh_token, HTTP Basic); refresh with R1; GET /2/users/me
with A1 again; remove X_TEST_REFRESH_TOKEN from GrokChat/.env. No posts. Two paid reads (/2/users/me).
Records shapes and fingerprints only, never token values.
"""

import json
import os
import time
from pathlib import Path

import httpx

from u1_refresh import ENV, env, fp, set_env, shape, token_call

REVOKE_URL = "https://api.x.com/2/oauth2/revoke"
ME_URL = "https://api.x.com/2/users/me"
LOG = Path(__file__).parent / "u14_results.json"


def revoke(e: dict, token: str, hint: str) -> httpx.Response:
    return httpx.post(REVOKE_URL, data={"token": token, "token_type_hint": hint},
                      auth=(e["X_CLIENT_ID"], e["X_CLIENT_SECRET"]),
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)


def me(access: str) -> dict:
    r = httpx.get(ME_URL, headers={"Authorization": f"Bearer {access}"}, timeout=30)
    try:
        body = r.json()
    except ValueError:
        body = r.text[:200]
    if isinstance(body, dict) and "data" in body:
        body = {"data_keys": sorted(body["data"])}  # no profile values in the log
    return {"http": r.status_code, "body": body}


def unset_env(key: str) -> None:
    lines = [l for l in ENV.read_text().splitlines() if not l.startswith(f"{key}=")]
    ENV.write_text("\n".join(lines) + "\n")
    os.chmod(ENV, 0o600)


def main() -> None:
    e = env()
    res: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                 "start_refresh_token_fp": fp(e.get("X_TEST_REFRESH_TOKEN"))}

    r = token_call(e, {"grant_type": "refresh_token", "refresh_token": e["X_TEST_REFRESH_TOKEN"]})
    res["1_refresh"] = shape(r)
    if r.status_code != 200:
        LOG.write_text(json.dumps(res, indent=2)); print(json.dumps(res, indent=2)); return
    a1, r1 = r.json()["access_token"], r.json()["refresh_token"]
    set_env("X_TEST_REFRESH_TOKEN", r1)

    res["2_me_before"] = me(a1)
    res["3_revoke_R1"] = shape(revoke(e, r1, "refresh_token"))

    r = token_call(e, {"grant_type": "refresh_token", "refresh_token": r1})
    res["4_refresh_revoked_R1"] = shape(r)
    if r.status_code == 200:  # revoke did not take: clean up the new pair too
        res["4b_revoke_new_R"] = shape(revoke(e, r.json()["refresh_token"], "refresh_token"))
        res["4c_revoke_new_A"] = shape(revoke(e, r.json()["access_token"], "access_token"))

    res["5_me_after"] = me(a1)
    unset_env("X_TEST_REFRESH_TOKEN")
    res["6_env_key_removed"] = "X_TEST_REFRESH_TOKEN" not in env()
    LOG.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
