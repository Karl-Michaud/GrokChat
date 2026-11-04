import contextlib, hashlib, hmac, os, sys
from fastapi import FastAPI
from mcp.server.mcpserver import MCPServer
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.transport_security import TransportSecuritySettings

BOTS = {hashlib.sha256(b"bot-a-secret").hexdigest(): ("bot-a", ["account:A"])}

class StaticVerifier:
    async def verify_token(self, token: str) -> AccessToken | None:
        h = hashlib.sha256(token.encode()).hexdigest()
        for k, (bid, scopes) in BOTS.items():
            if hmac.compare_digest(k, h):
                return AccessToken(token=token, client_id=bid, scopes=scopes)
        return None

MODE = os.environ.get("MODE", "auth")  # "noauth" = try token_verifier without AuthSettings
kw = {}
if MODE == "auth":
    kw["auth"] = AuthSettings(issuer_url="https://example.invalid", resource_server_url=None)
mcp = MCPServer("grokchat", token_verifier=StaticVerifier(), **kw)

@mcp.tool()
def whoami() -> dict:
    t = get_access_token()
    return {"client_id": t.client_id if t else None, "scopes": t.scopes if t else None}

@mcp.tool()
def create_post(account_id: str, text: str) -> dict:
    t = get_access_token()
    if f"account:{account_id}" not in (t.scopes if t else []):
        raise ValueError("scope_refused")
    return {"ok": True, "account_id": account_id, "len": len(text)}

TS = os.environ.get("TS", "default")
ts_kw = {}
if TS == "open":
    ts_kw["transport_security"] = TransportSecuritySettings(enable_dns_rebinding_protection=False)
mcp_app = mcp.streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/", **ts_kw)

LIFESPAN = os.environ.get("LIFESPAN", "parent")
@contextlib.asynccontextmanager
async def lifespan(app):
    async with mcp_app.router.lifespan_context(mcp_app):
        yield
app = FastAPI(lifespan=lifespan if LIFESPAN == "parent" else None)
app.mount("/mcp", mcp_app)
@app.get("/health")
def health(): return {"ok": True}

from mcp.server.mcpserver.exceptions import ToolError
@mcp.tool()
def refuse() -> dict:
    raise ToolError("scope_refused: bot-a may not post for account B")
