/** Base64 (standard, for the key secret) and base64url (for sealed values), over bytes. */

export function bytesFromBase64(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normal), (char) => char.charCodeAt(0));
}

export function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hexFromBytes(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
