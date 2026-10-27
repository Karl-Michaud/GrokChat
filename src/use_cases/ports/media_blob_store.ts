/** Media bytes (private R2 bucket, U17). */
export interface MediaBlobStore {
  put(bytes: Uint8Array, contentType: string): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}
