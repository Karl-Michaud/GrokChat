import { pbkdf2Sync } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  adminPasswordHash,
  base64Url,
  MIN_PASSWORD_LENGTH,
  newestTokenKeyOnly,
  newSessionSecret,
  newTokenKey,
  parseTokenKeys,
  passwordProblem,
  PBKDF2_ITERATIONS,
  rotatedTokenKeys,
  sha256Hex,
} from "../../../scripts/deploy/secret_values.mjs";

describe("the admin password", () => {
  it("is refused under 12 characters, counted as characters, and when the entries differ", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(passwordProblem("elevenchars", "elevenchars")).toBe(
      "the password is shorter than 12 characters",
    );
    expect(passwordProblem("twelve chars", "twelve chars")).toBeNull();
    expect(passwordProblem("😀".repeat(11), "😀".repeat(11))).toMatch(/shorter/);
    expect(passwordProblem("twelve chars", "twelve charz")).toBe("the two entries differ");
  });

  it("hashes to pbkdf2-sha256$100000$<salt>$<hash>, the same bits as Node's PBKDF2", async () => {
    const salt = new Uint8Array(16).map((_, index) => index);
    const encoded = await adminPasswordHash("correct horse battery", salt);
    const [scheme, iterations, saltText, hash, extra] = encoded.split("$");
    expect([scheme, iterations, saltText, extra]).toStrictEqual([
      "pbkdf2-sha256",
      "100000",
      base64Url(salt),
      undefined,
    ]);
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    const expected = pbkdf2Sync("correct horse battery", salt, 100_000, 32, "sha256");
    expect(hash).toBe(base64Url(new Uint8Array(expected)));
  });

  it("refuses a salt under 16 bytes, and draws a fresh 16-byte salt by default", async () => {
    await expect(adminPasswordHash("long password!", new Uint8Array(15))).rejects.toThrow(
      "the salt must be at least 16 bytes",
    );
    const salt = (await adminPasswordHash("long password!")).split("$")[2] ?? "";
    expect(Buffer.from(salt, "base64url")).toHaveLength(16);
  });
});

describe("base64url", () => {
  it("matches Node's base64url for any bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        expect(base64Url(bytes)).toBe(Buffer.from(bytes).toString("base64url"));
      }),
    );
  });
});

describe("the token keys", () => {
  it("are 32 random bytes of standard base64 each", () => {
    const key = newTokenKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(key).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(newTokenKey()).not.toBe(key);
  });

  it("rotate by putting a new key in front, and drop all but the newest", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (count) => {
        const current = Array.from({ length: count }, newTokenKey).join(",");
        const rotated = parseTokenKeys(rotatedTokenKeys(current));
        expect(rotated.slice(1)).toStrictEqual(parseTokenKeys(current));
        expect(rotated).toHaveLength(count + 1);
        expect(newestTokenKeyOnly(rotated.join(","))).toBe(rotated[0]);
      }),
    );
  });

  it("parse with spaces and empty entries, and refuse what the vault would refuse", () => {
    const [a, b] = [newTokenKey(), newTokenKey()];
    expect(parseTokenKeys(` ${a} ,, ${b} `)).toStrictEqual([a, b]);
    expect(() => parseTokenKeys(" , ")).toThrow("the token keys hold no key");
    expect(() => parseTokenKeys(`${a},c2hvcnQ=`)).toThrow("token key 2 is not 32 bytes of base64");
    expect(() => parseTokenKeys("not base64!")).toThrow("token key 1 is not 32 bytes");
    expect(() => parseTokenKeys(`${a},${a}`)).toThrow("the token keys list a key twice");
  });
});

describe("the session secret and token hashes", () => {
  it("are 32 random bytes, base64url: 43 characters", () => {
    for (const make of [newSessionSecret]) {
      const value = make();
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(value, "base64url")).toHaveLength(32);
      expect(make()).not.toBe(value);
    }
  });

  it("hash to lower-case hex SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
