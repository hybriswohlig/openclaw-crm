import { NextResponse } from "next/server";
import { pushPublicKey } from "@/services/push";

/**
 * Public endpoint — the VAPID public key is by design not secret. The client
 * fetches it once to build the push subscription.
 */
export function GET() {
  const key = pushPublicKey();
  return NextResponse.json({ publicKey: key ?? null });
}
