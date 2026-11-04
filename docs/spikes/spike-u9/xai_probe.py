"""U9 spike: call the xAI Responses API with the spike server as a remote MCP tool.

Usage: uv run python xai_probe.py <public base url> <case> [<case> ...]
Cases: bearer, bare, noslash, allowed, wrongtoken, resource, slow:<seconds>
Reads XAI_API_KEY from ../../GrokChat/.env. Prints no secrets; saves each response
(with the bot token scrubbed) to logs/xai_<case>.json.
"""

import json
import sys
import time
from pathlib import Path

import httpx

HERE = Path(__file__).parent
ENV = HERE.parent.parent / "GrokChat" / ".env"
KEY = next(l.split("=", 1)[1].strip() for l in ENV.read_text().splitlines() if l.startswith("XAI_API_KEY="))
TOKEN = Path(__import__("os").environ.get("SPIKE_TOKEN_FILE", HERE / ".spike_token")).read_text().strip()
MODEL = "grok-4.7"


def tool(base: str, authorization: str | None, path: str = "/mcp/", allowed: list[str] | None = None) -> dict:
    t = {"type": "mcp", "server_url": base.rstrip("/") + path, "server_label": "grokchat"}
    if authorization is not None:
        t["authorization"] = authorization
    if allowed is not None:
        t["allowed_tools"] = allowed
    return t


def case_spec(base: str, case: str) -> tuple[str, dict]:
    if case == "bearer":
        return "Call the echo tool with text 'hello-bearer' and report its exact result.", tool(base, f"Bearer {TOKEN}")
    if case == "bare":
        return "Call the echo tool with text 'hello-bare' and report its exact result.", tool(base, TOKEN)
    if case == "noslash":
        return "Call the echo tool with text 'hello-noslash' and report its exact result.", tool(base, f"Bearer {TOKEN}", path="/mcp")
    if case == "allowed":
        return ("List every tool you can call on the grokchat server by name, then call whoami.",
                tool(base, f"Bearer {TOKEN}", allowed=["echo", "whoami"]))
    if case == "wrongtoken":
        return "Call the echo tool with text 'hello-wrong'.", tool(base, "Bearer not-the-token")
    if case == "resource":
        return ("Read the grokchat resource personality://spike and quote it verbatim. If you cannot read "
                "resources, say exactly 'NO RESOURCE ACCESS'.", tool(base, f"Bearer {TOKEN}"))
    if case.startswith("slow:"):
        s = int(case.split(":")[1])
        return f"Call the slow tool with seconds={s} and report its exact result.", tool(base, f"Bearer {TOKEN}")
    raise SystemExit(f"unknown case {case}")


def scrub(obj):
    s = json.dumps(obj)
    return json.loads(s.replace(TOKEN, "<BOT_TOKEN>"))


def run(base: str, case: str) -> None:
    prompt, t = case_spec(base, case)
    body = {"model": MODEL, "input": [{"role": "user", "content": prompt}], "tools": [t]}
    t0 = time.time()
    try:
        r = httpx.post("https://api.x.ai/v1/responses", json=body,
                       headers={"Authorization": f"Bearer {KEY}"}, timeout=600)
        status, data = r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text)
    except httpx.HTTPError as e:
        status, data = "client_error", repr(e)
    dt = round(time.time() - t0, 1)
    out = scrub({"case": case, "status": status, "seconds": dt, "request_tool": t, "response": data})
    (HERE / "logs" / f"xai_{case.replace(':', '_')}.json").write_text(json.dumps(out, indent=2))
    summary = {"case": case, "http": status, "seconds": dt}
    if isinstance(data, dict):
        items = data.get("output", [])
        summary["output_types"] = [i.get("type") for i in items]
        summary["mcp_items"] = [{k: i.get(k) for k in ("type", "name", "status", "error", "server_label")}
                                for i in items if str(i.get("type", "")).startswith("mcp")]
        texts = [c.get("text") for i in items if i.get("type") == "message" for c in i.get("content", [])]
        summary["text"] = (" ".join(t for t in texts if t) or "")[:300]
        if "error" in data:
            summary["error"] = data["error"]
    else:
        summary["raw"] = str(data)[:300]
    print(json.dumps(scrub(summary)))


if __name__ == "__main__":
    base, *cases = sys.argv[1:]
    for c in cases:
        run(base, c)
