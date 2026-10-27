import type { ContentHasher } from "../../use_cases/ports/content_hasher";

/** The production `ContentHasher`: SHA-256 through WebCrypto, as lowercase hex. */
export class WebCryptoContentHasher implements ContentHasher {
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}
