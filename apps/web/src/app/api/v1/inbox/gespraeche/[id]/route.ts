import { NextRequest } from "next/server";
import { getAuthContext, isReadOnlyApiKey, notFound, success, unauthorized } from "@/lib/api-utils";
import { ladeEinzelgespraech } from "@/services/gespraech";
import { markConversationRead } from "@/services/inbox";

type Params = { params: Promise<{ id: string }> };

/**
 * GET → `{ eintraege, kanaele, vorauswahl }` für genau ein Gespräch (Inbox neu,
 * Plan 6 Entscheidung 8): dieselbe Form wie `GET /deals/[id]/gespraech`, für
 * Gespräche ohne Deal. Einträge nur Nachrichten, `kanaele` = dieses Gespräch,
 * senden nach denselben Regeln wie ein direkt verknüpftes Gespräch.
 *
 * Fremder Workspace oder unbekannte ID → 404. Ansehen zählt als Lesen wie in
 * der Akte: best effort, ein Fehler beim Markieren bricht die Antwort nie,
 * Nur-Lesen-Schlüssel markieren nichts.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { id } = await params;

  const gespraech = await ladeEinzelgespraech(ctx.workspaceId, id);
  if (!gespraech) return notFound("Gespräch nicht gefunden.");

  if (!isReadOnlyApiKey(ctx)) {
    await markConversationRead(id, ctx.workspaceId).catch((err) =>
      console.error("[inbox] gespraech mark-read failed:", err)
    );
  }

  return success(gespraech);
}
