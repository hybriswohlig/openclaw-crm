import { NextRequest } from "next/server";
import { forbidden, getAuthContext, notFound, success, unauthorized } from "@/lib/api-utils";
import { dealImWorkspace } from "@/lib/kalkulation-versionen-antwort";
import { kundeVorschlag } from "@/services/kunde-vorschlag";

export const dynamic = "force-dynamic";
// Die KI-Auswertung des Chats dauert wie die KI-Analyse bis zu einigen Minuten.
export const maxDuration = 300;

/**
 * POST: Vorschläge für Name, Telefon, E-Mail, Auszug und Einzug aus den
 * Gesprächen dieses Deals („Aus dem Chat übernehmen“). Speichert nichts; die
 * Oberfläche setzt die Werte zum Prüfen in die Felder.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const ctx = await getAuthContext(req);
  if (!ctx) return unauthorized(req);
  // Startet eine KI-Auswertung und liefert Personendaten: nur für Menschen in der Sitzung.
  if (ctx.authMethod !== "cookie") return forbidden("Vorschläge aus dem Chat nur in der angemeldeten Sitzung.");
  const { recordId } = await params;
  if (!(await dealImWorkspace(ctx.workspaceId, recordId))) return notFound("Deal nicht gefunden");
  return success(await kundeVorschlag(ctx.workspaceId, recordId));
}
