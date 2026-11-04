/** A use case's refusal, as its output data carries it (a tool result with `isError`, §3.4). */
export interface Refusal<Code extends string> {
  readonly ok: false;
  readonly code: Code;
}

export function refusal<Code extends string>(code: Code): Refusal<Code> {
  return { ok: false, code };
}
