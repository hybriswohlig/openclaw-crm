import { type NextRequest } from "next/server";
import { badRequest, notFound, success } from "@/lib/api-utils";
import { berlinDateString } from "@/lib/berlin-date";
import { istTag, pruefeAbwesenheit, type AbwesenheitArt } from "@/lib/einsatz";
import { einsatzAutor, einsatzFehler, einsatzVorlauf } from "@/lib/einsatz-route";
import { abwesenheitAnlegen, ladeAbwesenheitenPerson, mitarbeiterImWorkspace } from "@/services/einsatz-personen";
import { liesJson } from "../../eingabe";

function kalenderPlus(tag: string, tage: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + tage)).toISOString().slice(0, 10);
}

/** `von`/`bis` optional. Vorgabe: heute − 31 Tage bis heute + 400 Tage (Berlin). */
function fenster(req: NextRequest): { von: string; bis: string } | null {
  const url = new URL(req.url);
  const heute = berlinDateString();
  const vonRoh = url.searchParams.get("von");
  const bisRoh = url.searchParams.get("bis");
  const von = vonRoh === null || vonRoh === "" ? kalenderPlus(heute, -31) : vonRoh;
  const bis = bisRoh === null || bisRoh === "" ? kalenderPlus(heute, 400) : bisRoh;
  if (!istTag(von) || !istTag(bis) || bis < von) return null;
  return { von, bis };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const zeit = fenster(req);
  if (!zeit) return einsatzFehler("ZEITRAUM_UNGUELTIG", 400);
  const { employeeId } = await params;
  if (!(await mitarbeiterImWorkspace(vor.ctx.workspaceId, employeeId))) return notFound();
  return success(await ladeAbwesenheitenPerson(vor.ctx.workspaceId, employeeId, zeit.von, zeit.bis));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ employeeId: string }> }) {
  const vor = await einsatzVorlauf(req);
  if (vor.antwort) return vor.antwort;
  const gelesen = await liesJson(req);
  if ("antwort" in gelesen) return gelesen.antwort;
  const body = gelesen.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return einsatzFehler("ZEITRAUM_UNGUELTIG", 400);
  const o = body as Record<string, unknown>;
  let notiz: string | null | undefined;
  if ("notiz" in o) {
    if (o.notiz === null) notiz = null;
    else if (typeof o.notiz === "string") notiz = o.notiz;
    else return badRequest("notiz ungültig");
  }
  const fehler = pruefeAbwesenheit({ von: o.von, bis: o.bis, art: o.art });
  if (fehler) return einsatzFehler(fehler, 400);
  const { employeeId } = await params;
  if (!(await mitarbeiterImWorkspace(vor.ctx.workspaceId, employeeId))) return notFound();
  const abwesenheit = await abwesenheitAnlegen(
    vor.ctx.workspaceId,
    employeeId,
    { von: o.von as string, bis: o.bis as string, art: o.art as AbwesenheitArt, notiz },
    einsatzAutor(vor.ctx),
  );
  return success(abwesenheit, 201);
}
