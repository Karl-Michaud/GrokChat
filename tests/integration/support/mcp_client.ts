/**
 * Drives the Worker's default export (src/main.ts) with the MCP SDK's own client, as xAI's client
 * does: a fresh initialize, then the request, over stateless streamable HTTP (U9). The Worker runs
 * its production graph: real local D1 and R2, the production account Durable Object, the real X
 * and media fetch drivers; only `fetch` is stubbed (support/x_wire.ts).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Account } from "../../../src/entities/accounts/account";
import { accountId, xUserId, type AccountId } from "../../../src/entities/identity/ids";
import type { Env } from "../../../src/frameworks/env";
import { d1Stores } from "../../../src/frameworks/d1/d1_stores";
import { AccountObjects } from "../../../src/frameworks/durable_objects/account_client";
import worker from "../../../src/main";
import { HOUR } from "../../../src/entities/time/instant";
import { anAccount } from "../../unit/support/builders";

/** 32 random bytes as hex, as a deployment would mint them (plan §3.5). */
export const BOT_TOKEN = "5f0c3a9e8d7b6a5f4e3d2c1b0a99887766554433221100ffeeddccbbaa998877";
export const OTHER_BOT_TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const CLIENT_SECRET = "x-client-secret-value-for-tests";

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The env the Worker sees: two bot clients, each scoped to its own accounts. */
export async function botEnv(
  mine: readonly string[],
  theirs: readonly string[] = [],
  extra: Partial<Env> = {},
): Promise<Env> {
  const clients = [
    { id: "bot-mine", tokenSha256: await sha256Hex(BOT_TOKEN), accounts: mine },
    { id: "bot-theirs", tokenSha256: await sha256Hex(OTHER_BOT_TOKEN), accounts: theirs },
  ];
  return {
    ...env,
    GROKCHAT_BOT_CLIENTS: JSON.stringify(clients),
    X_CLIENT_SECRET: CLIENT_SECRET,
    GROKCHAT_MEDIA_HOSTS: "media.example",
    ...extra,
  };
}

type IncomingRequest = Parameters<typeof worker.fetch>[0];

export async function call(workerEnv: Env, request: Request): Promise<Response> {
  return await worker.fetch(request as IncomingRequest, workerEnv, createExecutionContext());
}

export async function connect(workerEnv: Env, token = BOT_TOKEN, path = "/mcp"): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`https://grokchat.test${path}`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) => call(workerEnv, new Request(input, init)),
  });
  const client = new Client({ name: "grokchat-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

let accounts = 0;
/** Per test file, so a Durable Object named after an account never carries over between files. */
const RUN = crypto.randomUUID().slice(0, 8);

/**
 * A fresh, active, disclosed account in D1, and tokens sealed in its production
 * Durable Object, as the dashboard's connect leaves it.
 */
export async function seedAccount(overrides: Partial<Account> = {}): Promise<Account> {
  accounts += 1;
  const id: AccountId = accountId(`it-acc-${RUN}-${String(accounts)}`);
  const account = anAccount({
    id,
    xUserId: xUserId(`it-x-${RUN}-${String(accounts)}`),
    ...overrides,
  });
  const stores = d1Stores(env.DB);
  await stores.accounts.save(account);
  await new AccountObjects(env.ACCOUNT).storeConnectedTokens(account.id, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessExpiresAt: Date.now() + 2 * HOUR,
  });
  return account;
}

/** The structured body of a tool result. */
export function body(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

export function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

/** The `initialize` request xAI's client sends first (U9). */
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "rmcp", version: "0" },
  },
};

export function initialize(path: string, headers: Record<string, string>): Request {
  return new Request(`https://grokchat.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(INITIALIZE),
  });
}
