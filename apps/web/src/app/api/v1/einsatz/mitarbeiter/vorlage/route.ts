/**
 * GET → Mitarbeiter-Tabelle als CSV (Excel: Semikolon, UTF-8 mit BOM) mit allen
 * aktiven Mitarbeitern und dem, was schon eingetragen ist. Nur Menschen, wie
 * alle Einsatz-Routen (enthält Telefon und Adresse).
 */
import { type NextRequest } from "next/server";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { vorlageCsv } from "@/lib/mitarbeiter-csv";
import { ladePersonen } from "@/services/einsatz-personen";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const csv = vorlageCsv(await ladePersonen(vor.ctx.workspaceId));
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="mitarbeiter.csv"',
      "Cache-Control": "no-store",
    },
  });
}
