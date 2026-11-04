import anyio, sys, httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
async def main(url):
    async with httpx2.AsyncClient(headers={"Authorization": "Bearer bot-a-secret"}) as hc:
        async with Client(streamable_http_client(url, http_client=hc)) as c:
            tools = await c.list_tools()
            print("sdk tools", [t.name for t in tools.tools])
            r = await c.call_tool("whoami", {}); print("sdk whoami", r.content[0].text.replace("\n",""), r.structured_content if hasattr(r,'structured_content') else getattr(r,'structuredContent',None))
            r = await c.call_tool("refuse", {}); print("sdk refuse", r.is_error if hasattr(r,'is_error') else r.isError, r.content[0].text)
anyio.run(main, sys.argv[1])
