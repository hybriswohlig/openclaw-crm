/**
 * Transporter-Buchungen im Fenster (Plan 12b).
 * GET ?von&bis&firma → Liste mit Warnungen. POST legt eine Buchung an.
 */
import type { NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { istTag, pruefeBuchung, tageZwischen } from "@/lib/einsatz";
import { einsatzAutor, einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { operatingCompanyInWorkspace } from "@/services/customer-portal-config";
import { buchungAnlegen, buchungenMitWarnungen } from "@/services/einsatz-buchungen";
import { buchungNeu } from "./eingabe";

const FENSTER_MAX = 92;

function fenster(req: NextRequest): { von: string; bis: string } | null {
  const von = req.nextUrl.searchParams.get("von") ?? "";
  const bis = req.nextUrl.searchParams.get("bis") ?? "";
  if (!istTag(von) || !istTag(bis) || bis < von) return null;
  if (tageZwischen(von, bis, FENSTER_MAX + 1).length > FENSTER_MAX) return null;
  return { von, bis };
}

export async function GET(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const zeit = fenster(req);
  if (!zeit) return badRequest("von und bis sind Kalendertage, höchstens 92 Tage.");
  const firma = req.nextUrl.searchParams.get("firma");
  const liste = await buchungenMitWarnungen(vor.ctx.workspaceId, zeit.von, zeit.bis, firma && firma.trim() !== "" ? firma : null);
  return success(liste);
}

export async function POST(req: NextRequest) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungültiges JSON.");
  }
  const eingabe = buchungNeu(body);
  if (!eingabe) return badRequest("Die Angaben zur Buchung sind unvollständig oder ungültig.");
  const fehler = pruefeBuchung(eingabe);
  if (fehler) return einsatzFehler(fehler, 400);
  if (!(await operatingCompanyInWorkspace(vor.ctx.workspaceId, eingabe.firmaId))) return notFound("Firma nicht gefunden.");
  const buchung = await buchungAnlegen(vor.ctx.workspaceId, eingabe, einsatzAutor(vor.ctx));
  return success(buchung, 201);
}
