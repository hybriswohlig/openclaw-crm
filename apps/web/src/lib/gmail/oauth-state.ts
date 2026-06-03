/**
 * Stateless, signed OAuth `state` for the Gmail connect flow.
 *
 * The state carries which channel account is being connected (and its workspace)
 * across the round-trip to Google, HMAC-signed so a tampered/forged callback is
 * rejected. No DB row needed. Lightweight (no googleapis import) so both the
 * start and callback routes can share it cheaply.
 */

import { createHmac, timingSafeEqual } from "crypto";

export interface GmailOAuthState {
  channelAccountId: string;
  workspaceId: string;
  /** Random per-request value so two concurrent connects don't collide. */
  nonce: string;
}

function signingKey(): string {
  const key =
    process.env.BETTER_AUTH_SECRET || process.env.SETTINGS_ENCRYPTION_KEY || "";
  if (!key) {
    throw new Error(
      "Cannot sign Gmail OAuth state: BETTER_AUTH_SECRET (or SETTINGS_ENCRYPTION_KEY) is unset."
    );
  }
  return key;
}

export function encodeState(state: GmailOAuthState): string {
  const data = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function decodeState(raw: string): GmailOAuthState | null {
  const dot = raw.indexOf(".");
  if (dot < 1) return null;
  const data = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = createHmac("sha256", signingKey()).update(data).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString()) as GmailOAuthState;
    if (!parsed?.channelAccountId || !parsed?.workspaceId) return null;
    return parsed;
  } catch {
    return null;
  }
}
