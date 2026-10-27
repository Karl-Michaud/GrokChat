"""Vercel half of the U9 spike: the same MCP shape as GrokChat will use, on Vercel's Python runtime.

Everything is logged as one JSON line per event to stdout (read with `vercel logs`). The bot token
and cron secret come from env vars; logs show only their shape, never their value.
"""

import asyncio
import contextlib
import hashlib
import hmac
import json
import os
import time
import uuid

from fastapi import FastAPI, Request
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

INSTANCE = uuid.uuid4().hex[:8]
BOOTED = time.time()
TOKEN_SHA = hashlib.sha256(os.environ.get("SPIKE_TOKEN", "").encode()).hexdigest()
CRON_SHA = hashlib.sha256(os.environ.get("CRON_SECRET", "").encode()).hexdigest()
HOSTS = sorted({h for h in (os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"), os.environ.get("VERCEL_URL")) if h})


def log(**event) -> None:
    print(json.dumps({"spike": True, "instance": INSTANCE, "age_s": round(time.time() - BOOTED, 1), **event}), flush=True)


log(kind="boot", hosts=HOSTS, token_set=bool(os.environ.get("SPIKE_TOKEN")))


class Verifier:
    async def verify_token(self, token: str) -> AccessToken | None:
        ok = hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), TOKEN_SHA)
        log(kind="verify", ok=ok)
        return AccessToken(token=token, client_id="spike-bot", scopes=["account:spike"]) if ok else None


mcp = MCPServer("grokchat-spike", token_verifier=Verifier(),
                auth=AuthSettings(issuer_url="https://example.invalid", resource_server_url=None))


@mcp.tool()
def echo(text: str) -> str:
    """Return the text unchanged. Use this when asked to echo something."""
    log(kind="tool", name="echo", text=text)
    return f"echo: {text} (instance {INSTANCE}, age {round(time.time() - BOOTED, 1)}s)"


@mcp.tool()
def whoami() -> str:
    """Report which bot identity the server sees."""
    t = get_access_token()
    return json.dumps({"client_id": t.client_id if t else None, "instance": INSTANCE})


mcp_app = mcp.streamable_http_app(
    stateless_http=True, json_response=True, streamable_http_path="/",
    transport_security=TransportSecuritySettings(allowed_hosts=HOSTS, allowed_origins=[]),
)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    log(kind="lifespan", phase="start")
    async with mcp_app.router.lifespan_context(mcp_app):
        yield
    log(kind="lifespan", phase="stop")


inner = FastAPI(lifespan=lifespan)
inner.mount("/mcp", mcp_app)


@inner.get("/health")
def health() -> dict:
    return {"ok": True, "instance": INSTANCE, "age_s": round(time.time() - BOOTED, 1), "hosts": HOSTS}


@inner.get("/cron/ping")
def cron_ping(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    scheme, _, rest = auth.partition(" ")
    ok = scheme == "Bearer" and hmac.compare_digest(hashlib.sha256(rest.encode()).hexdigest(), CRON_SHA)
    log(kind="cron", method=request.method, user_agent=request.headers.get("user-agent"),
        auth_present=bool(auth), auth_scheme=scheme if rest else None, secret_matches=ok)
    return {"secret_matches": ok}


@inner.get("/sleep")
async def sleep(s: int) -> dict:
    log(kind="sleep", phase="start", s=s)
    await asyncio.sleep(s)
    log(kind="sleep", phase="end", s=s)
    return {"slept": s}


@inner.post("/body")
async def body(request: Request) -> dict:
    data = await request.body()
    return {"bytes": len(data)}


async def app(scope, receive, send):
    """Serve /mcp exactly (xAI does not follow redirects) and log each request's shape."""
    if scope["type"] == "http":
        if scope["path"] == "/mcp":
            scope = {**scope, "path": "/mcp/", "raw_path": b"/mcp/"}
        h = {k.decode(): v.decode() for k, v in scope["headers"]}
        a = h.get("authorization", "")
        log(kind="http", method=scope["method"], path=scope["path"], host=h.get("host"),
            ua=h.get("user-agent"), auth_scheme=a.partition(" ")[0] if a else None,
            mcp_version=h.get("mcp-protocol-version"))
    await inner(scope, receive, send)
