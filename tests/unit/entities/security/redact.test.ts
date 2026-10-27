import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { redact, REDACTED } from "../../../../src/entities/security/redact";

describe("redact", () => {
  it("removes every secret, longest first", () => {
    expect(redact("token=abc123 refresh=abc123xyz", ["abc123", "abc123xyz"])).toBe(
      "token=[redacted] refresh=[redacted]",
    );
    expect(REDACTED).toBe("[redacted]");
  });

  it("ignores empty secrets and leaves clean text alone", () => {
    expect(redact("nothing here", ["", "zzz"])).toBe("nothing here");
  });

  it("removes bearer credentials even when the secret is unknown", () => {
    expect(redact("Authorization: Bearer eyJ.abc-def_~+/=", [])).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redact("bearer   tok123 next", [])).toBe("bearer [redacted] next");
    expect(redact("Bearer", [])).toBe("Bearer");
  });

  const secret = fc.stringMatching(/^[A-Za-z0-9]{12,40}$/);

  it("property: no secret survives, wherever it appears", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string()),
        fc.array(secret, { minLength: 1, maxLength: 4 }),
        (pieces, secrets) => {
          const text = pieces
            .map((piece, index) => `${piece}${secrets[index % secrets.length] ?? ""}`)
            .join("");
          const out = redact(text, secrets);
          for (const value of secrets) {
            expect(out.includes(value)).toBe(false);
          }
        },
      ),
    );
  });

  it("property: text with no secret and no bearer credential is unchanged", () => {
    fc.assert(
      fc.property(
        fc.string().filter((text) => !/bearer/i.test(text)),
        secret,
        (text, value) => {
          fc.pre(!text.includes(value));
          expect(redact(text, [value])).toBe(text);
        },
      ),
    );
  });
});
