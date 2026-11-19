/**
 * POST `{ csv: string, uebernehmen: boolean }` → `{ data: ImportErgebnis }`.
 * `uebernehmen: false` zeigt nur, was sich ändern würde. Leere Zellen ändern
 * nie etwas. Nur Menschen, wie alle Einsatz-Routen.
 */
import { type NextRequest } from "next/server";
import { badRequest, success } from "@/lib/api-utils";
import { einsatzVorlauf } from "@/lib/einsatz-route";
import { IMPORT_MAX_ZEICHEN, mitarbeiterImport } from "@/services/mitarbeiter-import";
import { liesJson } from "../eingabe";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const gelesen = await liesJson(req);
  if ("antwort" in gelesen) return gelesen.antwort;
  const b = gelesen.body as { csv?: unknown; uebernehmen?: unknown } | null;
  if (!b || typeof b.csv !== "string" || typeof b.uebernehmen !== "boolean") return badRequest("Body: { csv: string, uebernehmen: boolean }");
  if (b.csv.length > IMPORT_MAX_ZEICHEN) return badRequest("Die Datei ist zu groß.");
  return success(await mitarbeiterImport(vor.ctx.workspaceId, b.csv, b.uebernehmen));
}
