/**
 * Drives the Worker's default export (src/main.ts) with the MCP SDK's own client, as xAI's client
 * does: a fresh initialize, then the request, over stateless streamable HTTP (U9).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Account } from "../../../src/entities/accounts/account";
import {
  accountId,
  personalityId,
  xUserId,
  type AccountId,
} from "../../../src/entities/identity/ids";
import type { Env } from "../../../src/frameworks/env";
import worker, { stubs } from "../../../src/main";
import { aPersonality, anAccount } from "../../unit/support/builders";

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

/** A fresh, active, disclosed account in the stub backend, with tokens and a personality. */
export async function seedAccount(overrides: Partial<Account> = {}): Promise<Account> {
  accounts += 1;
  const id: AccountId = accountId(`it-acc-${String(accounts)}`);
  const account = anAccount({
    id,
    xUserId: xUserId(`it-x-${String(accounts)}`),
    personalityId: personalityId(`it-pers-${String(accounts)}`),
    ...overrides,
  });
  await stubs.accounts.save(account);
  await stubs.personalities.save(aPersonality({ id: account.personalityId }));
  await stubs.tokenStore.commitRotated(account.id, stubs.tokenEndpoint.issue());
  return account;
}

/** The structured body of a tool result. */
export function body(result: unknown): Record<string, unknown> {
  return (result as { structuredContent: Record<string, unknown> }).structuredContent;
}

export function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}
