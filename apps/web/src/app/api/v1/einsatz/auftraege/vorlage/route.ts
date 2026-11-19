/**
 * GET → Auftrags-Tabelle als CSV (Excel: Semikolon, UTF-8 mit BOM): alle
 * anstehenden festen Umzüge mit dem heutigen Team. Nur Menschen, wie alle
 * Einsatz-Routen.
 */
import { type NextRequest } from "next/server";
import { auftraegeCsv } from "@/lib/auftraege-csv";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { anstehendeAuftraege } from "@/services/auftraege-import";
import { ladePersonen } from "@/services/einsatz-personen";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const ws = vor.ctx.workspaceId;
  const [auftraege, personen] = await Promise.all([anstehendeAuftraege(ws), ladePersonen(ws)]);
  return new Response(auftraegeCsv(auftraege, personen), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="auftraege-team.csv"',
      "Cache-Control": "no-store",
    },
  });
}
