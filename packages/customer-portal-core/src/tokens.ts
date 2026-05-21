/**
 * Token shape: 32 url-safe base64 chars representing 24 bytes (192 bits) of
 * cryptographic randomness. Unguessable for any practical adversary.
 *
 * `generateToken` is intentionally async and uses Web Crypto so it works in
 * Edge, Node, and the browser.
 */

const TOKEN_BYTES = 24;
const TOKEN_LENGTH = 32; // 24 bytes in base64url
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export async function generateToken(): Promise<string> {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function validateTokenShape(token: string): boolean {
  return typeof token === "string" && TOKEN_RE.test(token);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa exists in all modern Node (18+) and browsers; Edge has it too.
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
