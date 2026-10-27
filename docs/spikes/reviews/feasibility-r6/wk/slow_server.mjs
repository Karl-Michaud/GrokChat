import http from "node:http";
// /?ms=N delays the response N ms; counts refresh calls (path /refresh)
let refreshes = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/refresh") refreshes++;
  if (u.pathname === "/count") { res.end(String(refreshes)); return; }
  if (u.pathname === "/reset") { refreshes = 0; res.end("0"); return; }
  setTimeout(() => res.end("ok"), Number(u.searchParams.get("ms") ?? "30"));
}).listen(18798, "127.0.0.1");
