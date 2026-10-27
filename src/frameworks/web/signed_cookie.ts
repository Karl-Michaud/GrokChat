import { fromBase64Url, toBase64Url } from "./base64url";

type SignedPayload = Readonly<Record<string, unknown>> & {
  readonly purpose?: unknown;
  readonly expiresAt?: unknown;
};

/**
 * HMAC-SHA-256 signed values for the session and the connect-intent cookies (plan §3.5). Each
 * value carries its purpose and its expiry inside the signature, so one cookie cannot stand in
 * for the other and an old one is refused.
 */
export class CookieSigner {
  private key: Promise<CryptoKey> | undefined;

  constructor(private readonly secret: string) {}

  async sign(purpose: string, expiresAt: number, payload: object): Promise<string> {
    const body = toBase64Url(
      new TextEncoder().encode(JSON.stringify({ ...payload, purpose, expiresAt })),
    );
    const signature = await crypto.subtle.sign("HMAC", await this.hmacKey(), this.bytes(body));
    return `${body}.${toBase64Url(new Uint8Array(signature))}`;
  }

  /** The payload, or null when the value is malformed, forged, for another purpose or expired. */
  async verify(purpose: string, value: string, now: number): Promise<SignedPayload | null> {
    const [body, signature, extra] = value.split(".");
    const signatureBytes = fromBase64Url(signature ?? "");
    if (body === undefined || signatureBytes === null || extra !== undefined) {
      return null;
    }
    const key = await this.hmacKey();
    if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, this.bytes(body)))) {
      return null;
    }
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body) ?? new Uint8Array()),
    ) as SignedPayload;
    const fresh = typeof payload.expiresAt === "number" && now < payload.expiresAt;
    return payload.purpose === purpose && fresh ? payload : null;
  }

  private bytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  private hmacKey(): Promise<CryptoKey> {
    this.key ??= crypto.subtle.importKey(
      "raw",
      this.bytes(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return this.key;
  }
}
