import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MAX_PERSON_NAME,
  nameKey,
  personInitials,
  personName,
  sameName,
} from "../../../../src/entities/people/person";

describe("personName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(personName("  Karl   Michaud \t")).toBe("Karl Michaud");
    expect(personName("Aaron\n\nB")).toBe("Aaron B");
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   \t "],
    ["a control character", "Ka\u0000rl"],
    ["DEL", "Karl\u007f"],
    ["61 characters", "x".repeat(MAX_PERSON_NAME + 1)],
  ])("refuses %s", (_name, raw) => {
    expect(personName(raw)).toBeNull();
  });

  it("allows exactly 60 code points, counting an emoji as one", () => {
    expect(personName("x".repeat(MAX_PERSON_NAME))).toBe("x".repeat(MAX_PERSON_NAME));
    const emoji = "😀".repeat(MAX_PERSON_NAME);
    expect(personName(emoji)).toBe(emoji);
    expect(personName(`${emoji}😀`)).toBeNull();
    expect(personName("\u001fK")).toBeNull();
    expect(personName("K L")).toBe("K L");
  });

  it("is idempotent, and a name never has edge or double spaces", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (raw) => {
        const name = personName(raw);
        if (name !== null) {
          expect(personName(name)).toBe(name);
          expect(name).toBe(name.trim());
          expect(name).not.toMatch(/\s{2}/);
          expect(Array.from(name).length).toBeGreaterThan(0);
          expect(Array.from(name).length).toBeLessThanOrEqual(MAX_PERSON_NAME);
        }
      }),
    );
  });
});

describe("nameKey and sameName", () => {
  it("fold ASCII letters only, as SQLite's NOCASE does", () => {
    expect(nameKey("KaRL Z")).toBe("karl z");
    expect(nameKey("ÉLISE")).toBe("Élise");
    expect(sameName("Karl", "kARL")).toBe(true);
    expect(sameName("Élise", "élise")).toBe(false);
    expect(sameName("Karl", "Karla")).toBe(false);
  });

  it("sameName is symmetric, and a name matches itself with its ASCII letters in either case", () => {
    const asciiUpper = (text: string) => text.replace(/[a-z]/g, (letter) => letter.toUpperCase());
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(sameName(a, b)).toBe(sameName(b, a));
        expect(sameName(a, asciiUpper(a))).toBe(true);
        expect(nameKey(nameKey(a))).toBe(nameKey(a));
      }),
    );
  });
});

describe("personInitials", () => {
  it.each([
    ["Karl Michaud", "KM"],
    ["karl", "KA"],
    ["K", "K"],
    ["Aaron de Vries", "AD"],
    ["😀 Smile", "😀S"],
    ["", ""],
  ])("%s → %s", (name, initials) => {
    expect(personInitials(name)).toBe(initials);
  });
});
