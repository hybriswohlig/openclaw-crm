/**
 * MessageBird inbound webhook for the post-move reviews engine
 * ([KOT-603] / [KOT-617]). Verifies the legacy HMAC signature, parses
 * the payload, and persists into inbox_conversations / inbox_messages.
 *
 * Always responds 200 once the signature passes so MessageBird does
 * not retry on transient processing errors — failures are logged.
 *
 * In dev (NODE_ENV !== "production") with no MESSAGEBIRD_SIGNING_KEY
 * set, the signature check is skipped. This matches the WhatsApp
 * webhook's posture and lets local testing work without dashboard
 * round-trips. Production must set the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleMessagebirdInbound, verifyMessagebirdSignature } from "@/services/inbox-sms";
import type { MessagebirdInboundPayload } from "@/services/inbox-sms";
import { getSingletonWorkspaceId } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return new NextResponse("No workspace", { status: 500 });

  const rawBody = await req.text();
  const signature = req.headers.get("messagebird-signature");
  const signingKey = process.env.MESSAGEBIRD_SIGNING_KEY;

  if (signingKey) {
    if (!verifyMessagebirdSignature(rawBody, signature, signingKey)) {
      console.warn("[messagebird inbound] invalid signature");
      return new NextResponse("Invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[messagebird inbound] MESSAGEBIRD_SIGNING_KEY not configured in production");
    return new NextResponse("Not configured", { status: 503 });
  }

  let payload: MessagebirdInboundPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  try {
    await handleMessagebirdInbound(payload, workspaceId);
  } catch (err) {
    console.error("[messagebird inbound] handler failed:", err);
  }
  return NextResponse.json({ ok: true });
}
