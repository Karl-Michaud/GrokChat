import anyio
from pydantic import BaseModel
from mcp import Client
from mcp.server.mcpserver import MCPServer
s = MCPServer("t")
class Out(BaseModel):
    post_id: str
    status: str
@s.tool(structured_output=True)
def a() -> Out: return Out(post_id="p1", status="SCHEDULED")
async def main():
    async with Client(s) as c:
        for n in ("a",):
            r = await c.call_tool(n, {})
            print(n, getattr(r, "structured_content", None) or getattr(r, "structuredContent", None))
anyio.run(main)
