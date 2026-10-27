/** The production `ContentHasher` against the FIPS 180-2 test vectors, beside the FNV stub. */
import { describe, expect, it } from "vitest";
import { WebCryptoContentHasher } from "../../src/frameworks/crypto/sha256_hasher";
import { FnvContentHasher } from "../../src/frameworks/memory/memory_media";
import type { ContentHasher } from "../../src/use_cases/ports/content_hasher";

function hasherContract(make: () => ContentHasher): void {
  it("is deterministic, lowercase hex, and tells different bytes apart", async () => {
    const hasher = make();
    const one = await hasher.sha256Hex(new Uint8Array([1, 2, 3]));
    expect(await hasher.sha256Hex(new Uint8Array([1, 2, 3]))).toBe(one);
    expect(one).toMatch(/^[0-9a-f]+$/);
    expect(await hasher.sha256Hex(new Uint8Array([1, 2, 4]))).not.toBe(one);
  });
}

describe("ContentHasher contract: the FNV stub", () => {
  hasherContract(() => new FnvContentHasher());
});

describe("ContentHasher contract: WebCrypto SHA-256", () => {
  hasherContract(() => new WebCryptoContentHasher());

  it("matches the SHA-256 test vectors", async () => {
    const hasher = new WebCryptoContentHasher();
    expect(await hasher.sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await hasher.sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
