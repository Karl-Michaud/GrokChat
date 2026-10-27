// TypeScript-on-Cloudflare spike for GrokChat: MCP over stateless Streamable HTTP, D1, a Durable
// Object per account, a cron trigger and WebCrypto. Every route needs the bearer token except /health.
import { DurableObject } from "cloudflare:workers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

interface Env {
  DB: D1Database;
  ACCOUNT: DurableObjectNamespace<AccountPublisher>;
  SPIKE_TOKEN: string;
}

const enc = new TextEncoder();

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", enc.encode(s));
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [a, b] = await Promise.all([sha256(token), sha256(env.SPIKE_TOKEN ?? "")]);
  return token.length > 0 && crypto.subtle.timingSafeEqual(a, b);
}

function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "grokchat-spike-ts", version: "0.0.0" });
  server.registerTool("echo", { description: "Return the text unchanged.", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }));
  server.registerTool("count_posts", { description: "Count rows in the D1 posts table.", inputSchema: {} },
    async () => {
      const r = await env.DB.prepare("SELECT count(*) AS n FROM posts").first<{ n: number }>();
      return { content: [{ type: "text", text: `posts: ${r?.n ?? "no table"}` }] };
    });
  server.registerTool("publish", {
    description: "Ask the account's publisher to send one post (simulated) under a daily cap.",
    inputSchema: { account_id: z.string() },
  }, async ({ account_id }) => {
    const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(account_id));
    const r = await stub.publish("blocked", 3);
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  });
  return server;
}

async function handleMcp(req: Request, env: Env): Promise<Response> {
  const server = buildServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export class AccountPublisher extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS sends (n INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT)");
  }

  // Check the cap, do a slow outbound call (as an X request would be), then record the send.
  // "naive" lets other requests interleave at the await; "blocked" holds the object for the whole step.
  async publish(mode: "naive" | "blocked", cap: number): Promise<{ sent: boolean; count: number }> {
    const step = async () => {
      const count = this.ctx.storage.sql.exec<{ c: number }>("SELECT count(*) AS c FROM sends").one().c;
      if (count >= cap) return { sent: false, count };
      await fetch("https://example.com/", { cf: { cacheTtl: 0 } });
      this.ctx.storage.sql.exec("INSERT INTO sends (at) VALUES (?)", new Date().toISOString());
      return { sent: true, count: count + 1 };
    };
    return mode === "blocked" ? this.ctx.blockConcurrencyWhile(step) : step();
  }

  async reset(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM sends");
  }

  async total(): Promise<number> {
    return this.ctx.storage.sql.exec<{ c: number }>("SELECT count(*) AS c FROM sends").one().c;
  }
}

async function testD1(url: URL, env: Env): Promise<Response> {
  const op = url.searchParams.get("op");
  if (op === "setup") {
    await env.DB.batch([
      env.DB.prepare("DROP TABLE IF EXISTS posts"),
      env.DB.prepare("CREATE TABLE posts (id INTEGER PRIMARY KEY, account TEXT, state TEXT, claimer TEXT)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS cron_log (at TEXT, cron TEXT)"),
    ]);
    const n = Number(url.searchParams.get("n") ?? 50);
    const stmts = Array.from({ length: n }, (_, i) =>
      env.DB.prepare("INSERT INTO posts (id, account, state) VALUES (?, ?, 'SCHEDULED')").bind(i + 1, `acct${i % 5}`));
    await env.DB.batch(stmts);
    return Response.json({ setup: n });
  }
  if (op === "claim") {
    // Same shape as GrokChat's claim: one conditional UPDATE with RETURNING; the outer guard makes it exactly-once.
    const claimer = url.searchParams.get("claimer") ?? crypto.randomUUID();
    const guard = url.searchParams.get("guard") !== "off";
    const sql = guard
      ? "UPDATE posts SET state='CLAIMED', claimer=?1 WHERE id IN (SELECT id FROM posts WHERE state='SCHEDULED' ORDER BY id LIMIT 3) AND state='SCHEDULED' RETURNING id"
      : "UPDATE posts SET state='CLAIMED', claimer=?1 WHERE id IN (SELECT id FROM posts WHERE state='SCHEDULED' ORDER BY id LIMIT 3) RETURNING id";
    const r = await env.DB.prepare(sql).bind(claimer).all<{ id: number }>();
    return Response.json({ claimer, ids: r.results.map((x) => x.id), meta: r.meta });
  }
  if (op === "cron") {
    const r = await env.DB.prepare("SELECT at, cron FROM cron_log ORDER BY at DESC LIMIT 10").all();
    return Response.json(r.results);
  }
  return new Response("op?", { status: 400 });
}

async function testDo(url: URL, env: Env): Promise<Response> {
  const stub = env.ACCOUNT.get(env.ACCOUNT.idFromName(url.searchParams.get("account") ?? "A"));
  const op = url.searchParams.get("op");
  if (op === "reset") { await stub.reset(); return Response.json({ reset: true }); }
  if (op === "total") return Response.json({ total: await stub.total() });
  const mode = url.searchParams.get("mode") === "naive" ? "naive" : "blocked";
  return Response.json(await stub.publish(mode, Number(url.searchParams.get("cap") ?? 3)));
}

async function testCrypto(): Promise<Response> {
  const key = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])) as CryptoKey;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode("refresh-token-sample"));
  const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  return Response.json({ aes_gcm_roundtrip: pt === "refresh-token-sample", ciphertext_bytes: ct.byteLength });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (!(await authorized(req, env))) return new Response("unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return handleMcp(req, env);
    if (url.pathname === "/test/d1") return testD1(url, env);
    if (url.pathname === "/test/do") return testDo(url, env);
    if (url.pathname === "/test/crypto") return testCrypto();
    return new Response("not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS cron_log (at TEXT, cron TEXT)").run();
    await env.DB.prepare("INSERT INTO cron_log (at, cron) VALUES (?, ?)").bind(new Date(controller.scheduledTime).toISOString(), controller.cron).run();
  },
} satisfies ExportedHandler<Env>;
