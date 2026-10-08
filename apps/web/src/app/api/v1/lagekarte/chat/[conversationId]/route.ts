import { NextRequest } from "next/server";
import { getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { ladeChatVorschau } from "@/services/lagekarte";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/lagekarte/chat/{conversationId}: letzte Nachrichten eines
 * Threads für das Lagekarte-Panel. Nur lesen: markiert nichts als gelesen
 * (anders als /api/v1/inbox/conversations/{id}/messages). Anhänge nur als
 * Anzahl und Art (Foto/Datei), nie Inhalte.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized();

  const { conversationId } = await params;
  const vorschau = await ladeChatVorschau(ctx.workspaceId, conversationId);
  if (!vorschau) return notFound("Chat nicht gefunden");
  return success(vorschau);
}
