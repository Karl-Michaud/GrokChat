"""U9 spike: a minimal MCP server that xAI's remote-MCP client calls through a tunnel.

Logs every HTTP request (headers with the Authorization value reduced to its shape) and
every JSON-RPC method to logs/requests.jsonl. Tools only echo, sleep and report the caller;
nothing here touches X.
"""

import asyncio
import contextlib
import hashlib
import hmac
import json
import os
import time
from pathlib import Path

from fastapi import FastAPI
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

HERE = Path(__file__).parent
TOKEN = (HERE / ".spike_token").read_text().strip()
TOKEN_SHA = hashlib.sha256(TOKEN.encode()).hexdigest()
HOST = os.environ["SPIKE_HOST"]
LOG = HERE / "logs" / "requests.jsonl"
LOG.parent.mkdir(exist_ok=True)


def log(event: dict) -> None:
    event["t"] = time.time()
    with LOG.open("a") as f:
        f.write(json.dumps(event) + "\n")


def auth_shape(value: str | None) -> dict:
    if value is None:
        return {"present": False}
    scheme, _, rest = value.partition(" ")
    bare_match = hmac.compare_digest(hashlib.sha256(value.encode()).hexdigest(), TOKEN_SHA)
    bearer_match = scheme.lower() == "bearer" and hmac.compare_digest(
        hashlib.sha256(rest.encode()).hexdigest(), TOKEN_SHA
    )
    return {"present": True, "len": len(value), "first_word": scheme if rest else "(none)",
            "whole_value_is_token": bare_match, "bearer_then_token": bearer_match}


class Verifier:
    async def verify_token(self, token: str) -> AccessToken | None:
        ok = hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), TOKEN_SHA)
        log({"kind": "verify", "ok": ok})
        return AccessToken(token=token, client_id="spike-bot", scopes=["account:spike"]) if ok else None


mcp = MCPServer(
    "grokchat-spike",
    token_verifier=Verifier(),
    auth=AuthSettings(issuer_url="https://example.invalid", resource_server_url=None),
)


@mcp.tool()
def echo(text: str) -> str:
    """Return the text unchanged. Use this when asked to echo something."""
    t = get_access_token()
    log({"kind": "tool", "name": "echo", "client": t.client_id if t else None, "text": text})
    return f"echo: {text}"


@mcp.tool()
async def slow(seconds: int) -> str:
    """Wait the given number of seconds, then return. Use only when asked to wait."""
    log({"kind": "tool", "name": "slow", "seconds": seconds, "phase": "start"})
    await asyncio.sleep(seconds)
    log({"kind": "tool", "name": "slow", "seconds": seconds, "phase": "end"})
    return f"waited {seconds}s"


@mcp.tool()
def whoami() -> str:
    """Report which bot identity the server sees."""
    t = get_access_token()
    return json.dumps({"client_id": t.client_id if t else None, "scopes": t.scopes if t else None})


@mcp.resource("personality://spike")
def personality() -> str:
    """The voice guide for the spike personality."""
    log({"kind": "resource", "uri": "personality://spike"})
    return "Voice: dry, short sentences. Always end with the word 'PINEAPPLE'."


mcp_app = mcp.streamable_http_app(
    stateless_http=True,
    json_response=True,
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(allowed_hosts=[HOST], allowed_origins=[]),
)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    async with mcp_app.router.lifespan_context(mcp_app):
        yield


app_inner = FastAPI(lifespan=lifespan)
app_inner.mount("/mcp", mcp_app)


async def app(scope, receive, send):
    """Log each request (headers, JSON-RPC method, status) around the real app."""
    if scope["type"] != "http":
        return await app_inner(scope, receive, send)
    headers = {k.decode(): v.decode() for k, v in scope["headers"]}
    auth = headers.pop("authorization", None)
    chunks = []

    async def recv():
        msg = await receive()
        if msg["type"] == "http.request":
            chunks.append(msg.get("body", b""))
        return msg

    status = {}

    async def snd(msg):
        if msg["type"] == "http.response.start":
            status["code"] = msg["status"]
            status["location"] = dict(msg.get("headers", [])).get(b"location", b"").decode()
        await send(msg)

    await app_inner(scope, recv, snd)
    body = b"".join(chunks)
    rpc = None
    with contextlib.suppress(Exception):
        j = json.loads(body)
        items = j if isinstance(j, list) else [j]
        rpc = [{"method": i.get("method"), "params_keys": sorted((i.get("params") or {}).keys()),
                "protocolVersion": (i.get("params") or {}).get("protocolVersion"),
                "tool": (i.get("params") or {}).get("name")} for i in items]
    log({"kind": "http", "method": scope["method"], "path": scope["path"], "status": status,
         "auth": auth_shape(auth), "headers": headers, "rpc": rpc})
