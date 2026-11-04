import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";
import type { Actor } from "../../entities/identity/actor";
import type { ToolArgs, ToolName } from "../../interface_adapters/mcp/tool_args";
import { TOOL_CATALOG, TOOL_NAMES } from "../../interface_adapters/mcp/tool_catalog";
import type { ToolResult } from "../../interface_adapters/mcp/tool_result";
import { TOOL_SCHEMAS } from "../../interface_adapters/schemas/mcp_tool_schemas";

/** Who is calling, and what every string in the answer is redacted against. */
export interface ToolCall {
  readonly actor: Actor;
  readonly secrets: readonly string[];
}

/** One handler per tool, built by the composition root for one request. */
export type ToolHandlers = {
  readonly [K in ToolName]: (call: ToolCall, args: ToolArgs[K]) => Promise<ToolResult>;
};

export const SERVER_INFO = { name: "grokchat", version: "0.0.0" } as const;

/** The MCP SDK's result: the JSON as text (what Grok reads) and as structured content. */
export function callToolResult(result: ToolResult): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result.body) }],
    structuredContent: { ...result.body },
    isError: result.isError,
  };
}

const INTERNAL: ToolResult = { isError: true, body: { error: "internal", part: null } };

/** A throw never reaches the SDK, which would put the message (and what it quotes) in the result. */
async function guarded(name: ToolName, run: () => Promise<ToolResult>): Promise<CallToolResult> {
  try {
    return callToolResult(await run());
  } catch {
    console.error(`grokchat mcp: tool ${name} failed`);
    return callToolResult(INTERNAL);
  }
}

function register<K extends ToolName>(
  server: McpServer,
  name: K,
  handler: ToolHandlers[K],
  call: ToolCall,
): void {
  const info = TOOL_CATALOG[name];
  // Widened so the SDK's callback type does not depend on K; the SDK parses `args` with it.
  const inputSchema: ZodType = TOOL_SCHEMAS[name];
  server.registerTool(
    name,
    {
      description: info.description,
      inputSchema,
      annotations: { readOnlyHint: info.readOnly, destructiveHint: info.destructive },
    },
    // TOOL_SCHEMAS[name] satisfies ZodType<ToolArgs[K]>, so the parsed `args` are ToolArgs[K].
    (args: unknown) => guarded(name, () => handler(call, args as ToolArgs[K])),
  );
}

/** Every tool from the static table, nothing else: no resources, no prompts (plan §3.4, U9). */
export function buildMcpServer(call: ToolCall, handlers: ToolHandlers): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const name of TOOL_NAMES) {
    register(server, name, handlers[name], call);
  }
  return server;
}

/** Per request: a new server and a stateless JSON transport (plan §3.5, spike-cf-ts). */
export async function serveMcp(
  request: Request,
  call: ToolCall,
  handlers: ToolHandlers,
): Promise<Response> {
  const server = buildMcpServer(call, handlers);
  // No `sessionIdGenerator`: stateless (the spike's `sessionIdGenerator: undefined`, written so
  // that exactOptionalPropertyTypes accepts it).
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}
