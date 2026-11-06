import { NextRequest } from "next/server";
import { getAuthContext, isReadOnlyApiKey, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { ladeGespraech } from "@/services/gespraech";
import { markConversationRead } from "@/services/inbox";

type Params = { params: Promise<{ recordId: string }> };

/**
 * GET → `{ eintraege, kanaele, vorauswahl }`: das Gespräch des Deals über alle
 * Kanäle mit Systemzeilen (Plan 3, Task 7).
 *
 * Ansehen zählt als Lesen, aber nur für die direkt verknüpften Gespräche
 * (Entscheidung 10); indirekt gefundene bleiben ungelesen. Wie
 * `inbox/person-thread`: best effort, ein Fehler beim Markieren bricht die
 * Antwort nie, Nur-Lesen-Schlüssel markieren nichts.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden.");

  const gespraech = await ladeGespraech(ctx.workspaceId, recordId);

  if (!isReadOnlyApiKey(ctx)) {
    await Promise.all(
      gespraech.kanaele
        .filter((k) => k.direkt)
        .map((k) =>
          markConversationRead(k.gespraechId, ctx.workspaceId).catch((err) =>
            console.error("[akte] gespraech mark-read failed:", err)
          )
        )
    );
  }

  return success(gespraech);
}
