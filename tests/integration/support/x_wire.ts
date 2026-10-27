/**
 * X at the `fetch` boundary, for tests of the production Durable Object (main.ts) on the real
 * fetch drivers: the test and the object share one isolate, so stubbing the global `fetch` reaches
 * the object's `FetchTransport`. Nothing leaves the test: any request X does not answer fails.
 */
import { vi } from "vitest";
import type { TransportResult } from "../../../src/frameworks/x_http/transport";
import { TOKEN_URL } from "../../../src/frameworks/x_auth/x_oauth_config";
import { XEmulator } from "../../contract/support/x_emulator";
import { tokenBody, type SeenRequest } from "../../contract/support/x_fixtures";

/** What a request does before X answers it: delay, or lose the response after X acted. */
export type Hook = (request: SeenRequest) => Promise<"answer" | "lose">;

export interface XWire {
  readonly emulator: XEmulator;
  readonly seen: SeenRequest[];
  /** Runs before X answers each request; `lose` makes the request time out after X acted. */
  hook: Hook;
  /** The `<METHOD> <path>` of every request X saw, in order. */
  calls(): readonly string[];
  restore(): void;
}

async function seenRequest(request: Request): Promise<SeenRequest> {
  return {
    method: request.method,
    url: new URL(request.url),
    headers: request.headers,
    body: new TextDecoder().decode(await request.clone().arrayBuffer()),
    form: null,
    timeout: 0,
  };
}

function answer(result: TransportResult): Response {
  if (result.kind !== "response") {
    throw new Error(`X fixture gave no response: ${result.reason}`);
  }
  return result.response;
}

/** Stubs `fetch` with the X emulator (and X's token endpoint, rotating to `access-2`). */
export function stubX(): XWire {
  const emulator = new XEmulator(() => Date.now());
  const seen: SeenRequest[] = [];
  const wire: XWire = {
    emulator,
    seen,
    hook: () => Promise.resolve("answer"),
    calls: () => seen.map((request) => `${request.method} ${request.url.pathname}`),
    restore: () => {
      spy.mockRestore();
    },
  };
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = await seenRequest(new Request(input, init));
    if (request.url.origin !== "https://api.x.com") {
      throw new Error(`a test reached for ${request.url.origin}`);
    }
    seen.push(request);
    const outcome = await wire.hook(request);
    const result =
      request.url.href === TOKEN_URL
        ? answer({
            kind: "response",
            response: new Response(JSON.stringify(tokenBody(2)), { status: 200 }),
          })
        : answer(emulator.handle(request));
    if (outcome === "lose") {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return result;
  });
  return wire;
}
