import { NextRequest } from "next/server";
import { getAuthContext, success, unauthorized } from "@/lib/api-utils";
import { SUCHE_MIN_ZEICHEN } from "@/lib/inbox-neu";
import { ladeInboxListe } from "@/services/inbox-neu";

/**
 * GET → `{ data: InboxListe }`: die Liste der neuen Inbox (Plan 6), alle
 * Gespräche außer Spam, je Deal gebündelt und nach „wartet auf uns“ sortiert.
 * `?q=` sucht ab 2 Zeichen auf dem Server (Name, Nummer, E-Mail, Betreff,
 * Nachrichtentext); kürzere Suchtexte laden die ganze Liste. Liest nur, auch
 * für Nur-Lesen-Schlüssel.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const liste = await ladeInboxListe(ctx.workspaceId, {
    suche: q.length >= SUCHE_MIN_ZEICHEN ? q : undefined,
  });
  return success(liste);
}
