/**
 * WhatsApp Business Cloud API webhook.
 *
 * GET — Meta's verification handshake. Responds with `hub.challenge` iff
 *       `hub.verify_token` matches the workspace's stored verify token.
 *
 * POST — Event delivery. Verifies the X-Hub-Signature-256 HMAC, then hands
 *        the payload to the ingest service. Always responds 200 once
 *        verification passes so Meta doesn't retry on transient processing
 *        errors; processing errors are logged and surfaced via activity
 *        events, not HTTP.
 *
 * Single-tenant note: this CRM uses one workspace per deployment, so the
 * webhook resolves the workspace via the singleton helper. In a multi-tenant
 * world you'd put the workspace id in the path.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  handleWebhookPayload,
  verifyWebhookSignature,
  getAppSecret,
  getVerifyToken,
  type WAWebhookPayload,
} from "@/services/inbox-whatsapp";
import { getSingletonWorkspaceId } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return new NextResponse("No workspace", { status: 500 });

  const expected = await getVerifyToken(workspaceId);
  if (!expected || token !== expected) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Meta expects the raw challenge string echoed back, not JSON.
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: NextRequest) {
  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return new NextResponse("No workspace", { status: 500 });

  const appSecret = await getAppSecret(workspaceId);
  if (!appSecret) {
    console.error("[whatsapp webhook] app secret not configured");
    return new NextResponse("Not configured", { status: 503 });
  }

  // We need the raw body for HMAC verification, so read as text first.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature, appSecret)) {
    console.warn("[whatsapp webhook] invalid signature");
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: WAWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  // Ack fast. Processing errors are logged inside handleWebhookPayload so we
  // don't force Meta into its aggressive retry loop on a transient DB blip.
  try {
    await handleWebhookPayload(payload);
  } catch (err) {
    console.error("[whatsapp webhook] handler failed:", err);
  }
  return NextResponse.json({ ok: true });
}
