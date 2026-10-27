import time
from fastapi import FastAPI, Request

app = FastAPI()
state = {}

def build_mcp():
    from mcp.server.mcpserver import MCPServer
    from mcp.server.transport_security import TransportSecuritySettings
    mcp = MCPServer("cf-spike")
    @mcp.tool()
    def echo(text: str) -> str:
        return f"echo: {text}"
    return mcp.streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/",
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))

@app.get("/report")
async def rep():
    r = {}
    t0 = time.time()
    try:
        state.setdefault("mcp", build_mcp()); r["mcp_build"] = True
    except Exception as e:
        r["mcp_build"] = repr(e)[:300]
    r["mcp_build_s"] = round(time.time() - t0, 3)
    for mod in ("psycopg", "pg8000"):
        try:
            __import__(mod); r[mod] = "imported"
        except Exception as e:
            r[mod] = repr(e)[:200]
    try:
        import socket
        s = socket.create_connection(("1.1.1.1", 443), timeout=3); s.close(); r["raw_socket"] = True
    except Exception as e:
        r["raw_socket"] = repr(e)[:200]
    return r

async def mcp_asgi(scope, receive, send):
    if "mcp" not in state:
        state["mcp"] = build_mcp()
    m = state["mcp"]
    if not state.get("started"):
        state["cm"] = m.router.lifespan_context(m); await state["cm"].__aenter__(); state["started"] = True
    await m(scope, receive, send)

app.mount("/mcp", mcp_asgi)

from workers import asgi
Default = asgi.entrypoint(app)
