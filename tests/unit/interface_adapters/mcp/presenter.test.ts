import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REDACTED } from "../../../../src/entities/security/redact";
import {
  presentTool,
  ToolPresenter,
  type ToolOutcome,
} from "../../../../src/interface_adapters/mcp/tool_presenter";
import {
  ToolViewModel,
  type JsonObject,
  type JsonValue,
} from "../../../../src/interface_adapters/mcp/tool_result";

const identity = (outcome: ToolOutcome): ToolOutcome => outcome;

function presented(outcome: ToolOutcome, secrets: readonly string[] = []) {
  const viewModel = new ToolViewModel();
  new ToolPresenter(identity, secrets, viewModel).present(outcome);
  return viewModel.current();
}

describe("ToolPresenter", () => {
  it("passes a success through as a result that is not an error", () => {
    expect(presented({ ok: true, body: { a: 1, b: [true, null] } })).toStrictEqual({
      isError: false,
      body: { a: 1, b: [true, null] },
    });
  });

  it("turns a refusal into isError with its code and part", () => {
    expect(presented({ ok: false, code: "part_too_long", part: 2 })).toStrictEqual({
      isError: true,
      body: { error: "part_too_long", part: 2 },
    });
  });

  it("gives a refusal without a part `part: null`", () => {
    expect(presented({ ok: false, code: "scope" })).toStrictEqual({
      isError: true,
      body: { error: "scope", part: null },
    });
    expect(presented({ ok: false, code: "scope", part: null }).body).toStrictEqual({
      error: "scope",
      part: null,
    });
  });

  it("redacts every string at any depth, in objects and arrays, and leaves the rest alone", () => {
    const result = presented(
      {
        ok: true,
        body: {
          top: "token tok-123 here",
          nested: { list: ["tok-123", { deep: "x tok-123" }], n: 4, f: false, z: null },
          auth: "Bearer abc.def",
        },
      },
      ["tok-123"],
    );
    expect(result.body).toStrictEqual({
      top: `token ${REDACTED} here`,
      nested: { list: [REDACTED, { deep: `x ${REDACTED}` }], n: 4, f: false, z: null },
      auth: `Bearer ${REDACTED}`,
    });
  });

  it("redacts the refusal's code too", () => {
    expect(presented({ ok: false, code: "leak-s3cret" }, ["s3cret"]).body).toStrictEqual({
      error: `leak-${REDACTED}`,
      part: null,
    });
  });

  it("never lets a known secret through, whatever the body (property)", () => {
    const withSecret = (token: string): fc.Arbitrary<JsonObject> => {
      const text = fc
        .tuple(fc.string({ maxLength: 6 }), fc.boolean(), fc.string({ maxLength: 6 }))
        .map(([before, put, after]) => (put ? `${before}${token}${after}` : before + after));
      const key = fc.constantFrom("a", "b", "c", "d");
      const { value } = fc.letrec<{ value: JsonValue }>((tie) => ({
        value: fc.oneof(
          { depthSize: "small" },
          text,
          fc.integer(),
          fc.boolean(),
          fc.constant(null),
          fc.array(tie("value"), { maxLength: 4 }),
          fc.dictionary(key, tie("value"), { maxKeys: 4 }),
        ),
      }));
      return fc.dictionary(key, value, { maxKeys: 4 });
    };
    const scenario = fc
      .stringMatching(/^[A-Z0-9]{8,16}$/) // upper case: never inside "[redacted]"
      .chain((token) => fc.tuple(fc.constant(token), withSecret(token)));
    fc.assert(
      fc.property(scenario, ([token, raw]) => {
        const out = presented({ ok: true, body: raw }, [token]);
        expect(JSON.stringify(out.body)).not.toContain(token);
      }),
    );
  });
});

describe("presentTool", () => {
  it("runs the call with a fresh presenter and returns what it presented", async () => {
    const result = await presentTool(
      (n: number): ToolOutcome => ({ ok: true, body: { n } }),
      ["never"],
      (presenter) => {
        presenter.present(7);
        return Promise.resolve();
      },
    );
    expect(result).toStrictEqual({ isError: false, body: { n: 7 } });
  });

  it("fails loudly when the use case presented nothing", async () => {
    await expect(presentTool(identity, [], () => Promise.resolve())).rejects.toThrow(
      "ToolViewModel was read before a presenter wrote it",
    );
  });
});
