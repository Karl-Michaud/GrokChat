import http from "node:http";
http.createServer((req, res) => {
  const fast = req.url.includes("fast=1");
  setTimeout(() => { res.end("ok"); }, fast ? 0 : 50);
}).listen(18799, "127.0.0.1", () => console.log("slow server on 18799"));
