/** A JSON value as a tool result carries it: plain data, no class instances, no undefined. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type JsonObject = Readonly<Record<string, JsonValue>>;

/**
 * What one tool call answers (plan §3.4): structured data, or a refusal with `isError` and a
 * machine-readable `error` code. The framework shim turns it into the MCP SDK's result.
 */
export interface ToolResult {
  readonly isError: boolean;
  readonly body: JsonObject;
}

/** Holds what the presenter produced for one tool call; built per call by the composition root. */
export class ToolViewModel {
  private result: ToolResult | undefined;

  update(result: ToolResult): void {
    this.result = result;
  }

  current(): ToolResult {
    if (this.result === undefined) {
      throw new Error("ToolViewModel was read before a presenter wrote it");
    }
    return this.result;
  }
}
