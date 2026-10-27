import { redact } from "../../entities/security/redact";
import type { JsonObject, JsonValue, ToolResult } from "./tool_result";
import { ToolViewModel } from "./tool_result";

/** A use case's output as a tool shows it: a body, or a refusal code (and the part it is about). */
export type ToolOutcome =
  | { readonly ok: true; readonly body: JsonObject }
  | { readonly ok: false; readonly code: string; readonly part?: number | null };

/** Maps one use case's output data onto a tool outcome. */
export type ToolView<Output> = (output: Output) => ToolOutcome;

function redactJson(value: JsonValue, secrets: readonly string[]): JsonValue {
  if (typeof value === "string") {
    return redact(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item: JsonValue) => redactJson(item, secrets));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactJson(item, secrets)]),
    );
  }
  return value;
}

function toResult(outcome: ToolOutcome): ToolResult {
  if (outcome.ok) {
    return { isError: false, body: outcome.body };
  }
  return { isError: true, body: { error: outcome.code, part: outcome.part ?? null } };
}

/**
 * Every tool's presenter (plan §3.4): the tool's view maps the output, then every string in the
 * result goes through `redact` with the deployment's secrets and the caller's token (I6, R8).
 */
export class ToolPresenter<Output> {
  constructor(
    private readonly view: ToolView<Output>,
    private readonly secrets: readonly string[],
    private readonly viewModel: ToolViewModel,
  ) {}

  present(output: Output): void {
    const result = toResult(this.view(output));
    this.viewModel.update({
      isError: result.isError,
      body: redactJson(result.body, this.secrets) as JsonObject,
    });
  }
}

/** Runs one tool call against a fresh presenter and view model and returns what it presented. */
export async function presentTool<Output>(
  view: ToolView<Output>,
  secrets: readonly string[],
  run: (presenter: ToolPresenter<Output>) => Promise<void>,
): Promise<ToolResult> {
  const viewModel = new ToolViewModel();
  await run(new ToolPresenter(view, secrets, viewModel));
  return viewModel.current();
}
