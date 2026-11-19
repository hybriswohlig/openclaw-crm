/**
 * POST `{ csv: string, uebernehmen: boolean }` → `{ data: AuftraegeImportErgebnis }`.
 * `uebernehmen: false` zeigt nur, was sich ändern würde. Beide Team-Zellen leer
 * = nichts ändern. Speichert über „Team bestätigen“, ohne WhatsApp. Nur Menschen.
 */
import { type NextRequest } from "next/server";
import { badRequest, success } from "@/lib/api-utils";
import { einsatzAutor, einsatzVorlauf } from "@/lib/einsatz-route";
import { AUFTRAEGE_MAX_ZEICHEN, auftraegeImport } from "@/services/auftraege-import";
import { liesJson } from "../../mitarbeiter/eingabe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const gelesen = await liesJson(req);
  if ("antwort" in gelesen) return gelesen.antwort;
  const b = gelesen.body as { csv?: unknown; uebernehmen?: unknown } | null;
  if (!b || typeof b.csv !== "string" || typeof b.uebernehmen !== "boolean") return badRequest("Body: { csv: string, uebernehmen: boolean }");
  if (b.csv.length > AUFTRAEGE_MAX_ZEICHEN) return badRequest("Die Datei ist zu groß.");
  return success(await auftraegeImport(vor.ctx.workspaceId, b.csv, b.uebernehmen, einsatzAutor(vor.ctx)));
}
