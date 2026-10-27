/** SHA-256 of staged media (WebCrypto in the driver; the inner layers have no crypto). */
export interface ContentHasher {
  sha256Hex(bytes: Uint8Array): Promise<string>;
}
