import { NextRequest, NextResponse } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getConversationForClient, updateConversationStatus } from "@/services/inbox";
import { updateConversationKlassifikation } from "@/services/kontaktart";

const STATUSES = ["open", "resolved", "spam"] as const;

/**
 * Single conversation in the same shape as the list endpoint (Paket 4:
 * ?conv= deep link). Used by the inbox to restore a conversation that is not
 * in the currently loaded list (other lane/status).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { id } = await params;
  const row = await getConversationForClient(ctx.workspaceId, id);
  if (!row) return notFound("Konversation nicht gefunden");
  return success(row);
}

/**
 * Set Kontaktart and/or the triage lane. A non-lead Kontaktart moves the
 * thread to lane `kein_lead` and the linked deal to stage "Kein Lead".
 * Body: { kontaktart?: slug or German label, lane?: lead|info|spam|review|kein_lead, status?: open|resolved|spam }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const body = (await req.json()) as { kontaktart?: string; lane?: string; status?: string };

  if (body.status) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const updated = await updateConversationStatus(
      id,
      ctx.workspaceId,
      body.status as (typeof STATUSES)[number]
    );
    if (!updated) return notFound("Konversation nicht gefunden");
  }

  if (body.kontaktart != null || body.lane != null) {
    const ok = await updateConversationKlassifikation({
      workspaceId: ctx.workspaceId,
      conversationId: id,
      kontaktart: body.kontaktart,
      lane: body.lane,
      actorId: ctx.userId,
    });
    if (!ok) return NextResponse.json({ error: "Ungültige Kontaktart oder Lane" }, { status: 400 });
  }

  const row = await getConversationForClient(ctx.workspaceId, id);
  if (!row) return notFound("Konversation nicht gefunden");
  return success(row);
}
