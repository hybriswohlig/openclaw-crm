/**
 * Inbound call from the phone system. HMAC of the raw body in
 * `x-telefon-signature` (hex SHA-256, optional `sha256=` prefix).
 * The secret is TELEFON_WEBHOOK_SECRET. A missing secret refuses the call.
 * A database error returns 500 so the sender can retry the same externalId.
 */

import { NextRequest, NextResponse } from "next/server";
import { parseTelefonCallPayload, verifyTelefonSignature } from "@/lib/phone-calls";
import { ingestPhoneCall } from "@/services/phone-calls";
import { getSingletonWorkspaceId } from "@/services/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.TELEFON_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[telefon] TELEFON_WEBHOOK_SECRET is not set");
    return new NextResponse("Not configured", { status: 503 });
  }

  const workspaceId = await getSingletonWorkspaceId();
  if (!workspaceId) return new NextResponse("No workspace", { status: 500 });

  const rawBody = await req.text();
  if (!verifyTelefonSignature(rawBody, req.headers.get("x-telefon-signature"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const parsed = parseTelefonCallPayload(body);
  if (!parsed.ok) return new NextResponse(parsed.error, { status: 400 });

  try {
    const result = await ingestPhoneCall(workspaceId, parsed.value);
    console.info("[telefon] call stored", {
      duplicate: result.duplicate,
      filled: result.filled,
      matchStatus: result.matchStatus,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[telefon] store failed:", err instanceof Error ? err.message : "unknown");
    return new NextResponse("Store failed", { status: 500 });
  }
}
