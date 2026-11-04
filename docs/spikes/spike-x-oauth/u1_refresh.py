"""U1: do X OAuth 2.0 refresh tokens rotate, and does an old one keep working?

Runs the authorization-code + PKCE flow against a local callback (http://127.0.0.1:8787/callback),
then: refresh with R0 -> R1; replay R0; refresh with R1 -> R2. Prints only token shapes and
fingerprints (first 8 hex of SHA-256), never values. Makes no billable API call. The last valid
refresh token is kept in GrokChat/.env (gitignored, mode 600) as X_TEST_REFRESH_TOKEN for U4.
"""

import base64
import hashlib
import http.server
import json
import os
import secrets
import threading
import time
import urllib.parse
from pathlib import Path

import httpx

ENV = Path(__file__).resolve().parents[2] / "GrokChat" / ".env"
LOG = Path(__file__).parent / "results.json"
REDIRECT = "http://127.0.0.1:8787/callback"
SCOPES = "tweet.read tweet.write users.read media.write offline.access"
TOKEN_URL = "https://api.x.com/2/oauth2/token"


def env() -> dict[str, str]:
    return dict(l.split("=", 1) for l in ENV.read_text().splitlines() if "=" in l)


def set_env(key: str, value: str) -> None:
    lines = [l for l in ENV.read_text().splitlines() if not l.startswith(f"{key}=")]
    ENV.write_text("\n".join(lines + [f"{key}={value}"]) + "\n")
    os.chmod(ENV, 0o600)


def fp(s: str | None) -> str | None:
    return hashlib.sha256(s.encode()).hexdigest()[:8] if s else None


def shape(r: httpx.Response) -> dict:
    try:
        body = r.json()
    except ValueError:
        return {"http": r.status_code, "body": r.text[:200]}
    out = {"http": r.status_code}
    for k, v in body.items():
        out[k] = {"len": len(v), "fp": fp(v)} if k in ("access_token", "refresh_token") else v
    return out


def token_call(e: dict, data: dict) -> httpx.Response:
    return httpx.post(TOKEN_URL, data=data, auth=(e["X_CLIENT_ID"], e["X_CLIENT_SECRET"]),
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=30)


def wait_for_code(state: str) -> str:
    got: dict[str, str] = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
            got.update(q)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"GrokChat U1 test: you can close this tab.")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 8787), H)
    t = threading.Thread(target=srv.handle_request, daemon=True)
    t.start()
    t.join(timeout=600)
    srv.server_close()
    if got.get("state") != state:
        raise SystemExit(f"state mismatch or no callback: {sorted(got)}")
    if "error" in got:
        raise SystemExit(f"authorization refused: {got}")
    return got["code"]


def main() -> None:
    e = env()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    url = "https://x.com/i/oauth2/authorize?" + urllib.parse.urlencode({
        "response_type": "code", "client_id": e["X_CLIENT_ID"], "redirect_uri": REDIRECT, "scope": SCOPES,
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    (Path(__file__).parent / "authorize_url.txt").write_text(url + "\n")
    print("AUTHORIZE_URL_WRITTEN", flush=True)
    code = wait_for_code(state)
    res: dict = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    r = token_call(e, {"grant_type": "authorization_code", "code": code, "redirect_uri": REDIRECT, "code_verifier": verifier})
    res["exchange"] = shape(r)
    r0 = r.json().get("refresh_token")
    if not r0:
        LOG.write_text(json.dumps(res, indent=2)); print(json.dumps(res, indent=2)); return

    r = token_call(e, {"grant_type": "refresh_token", "refresh_token": r0})
    res["refresh_with_R0"] = shape(r)
    r1 = r.json().get("refresh_token")
    res["R1_differs_from_R0"] = bool(r1) and r1 != r0

    r = token_call(e, {"grant_type": "refresh_token", "refresh_token": r0})
    res["replay_R0"] = shape(r)
    replay_new = r.json().get("refresh_token") if r.status_code == 200 else None

    r = token_call(e, {"grant_type": "refresh_token", "refresh_token": r1}) if r1 else None
    res["refresh_with_R1_after_replay"] = shape(r) if r else None
    r2 = r.json().get("refresh_token") if r is not None and r.status_code == 200 else None

    last = r2 or replay_new or r1
    if last:
        set_env("X_TEST_REFRESH_TOKEN", last)
        res["kept_refresh_token_fp"] = fp(last)
    LOG.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
