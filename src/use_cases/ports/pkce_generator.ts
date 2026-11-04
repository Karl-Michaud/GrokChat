export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

/** A random PKCE verifier and its S256 challenge (WebCrypto in the driver). */
export interface PkceGenerator {
  create(): Promise<PkcePair>;
}
