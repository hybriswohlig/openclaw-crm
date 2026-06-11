import { NextRequest } from "next/server";
import { getAuthContext, unauthorized, notFound, success } from "@/lib/api-utils";
import { getConversationForClient } from "@/services/inbox";

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
