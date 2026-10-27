import json, sys, httpx
BASE = sys.argv[1]; HOST = sys.argv[2] if len(sys.argv) > 2 else None
def call(method, params, token="bot-a-secret", id_=1, pv="2025-06-18"):
    h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": pv}
    if token: h["Authorization"] = f"Bearer {token}"
    if HOST: h["Host"] = HOST
    r = httpx.post(BASE, json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params}, headers=h, timeout=10)
    return r.status_code, dict((k, v) for k, v in r.headers.items() if k.lower() in ("mcp-session-id", "www-authenticate", "content-type")), r.text[:400]
init = {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "0"}}
print("init         ", call("initialize", init, pv=None) if False else call("initialize", init))
print("tools/list   ", call("tools/list", {}, id_=2))
print("whoami       ", call("tools/call", {"name": "whoami", "arguments": {}}, id_=3))
print("create own   ", call("tools/call", {"name": "create_post", "arguments": {"account_id": "A", "text": "hi"}}, id_=4))
print("create other ", call("tools/call", {"name": "create_post", "arguments": {"account_id": "B", "text": "hi"}}, id_=5))
print("no token     ", call("tools/list", {}, token=None, id_=6))
print("wrong token  ", call("tools/list", {}, token="nope", id_=7))
