/**
 * Karte des Einsatzes (Plan 12c). Liest die Lage ohne Anfahrten, damit kein
 * Distance-Matrix-Aufruf entsteht. Auftragspunkte kommen aus der gespeicherten
 * Route der maßgeblichen Version, sonst aus der Ortsmitte (Kalkulation, Lead,
 * zuletzt Chat). Schreibt nie `deal_employees`; nur `ortPunkte` schreibt den
 * Cache `einsatz_orte`.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealCalculationRoutes, type RoutenTeilstrecke } from "@/db/schema";
import { kuerzelAus } from "@/lib/akte";
import {
  kartenOrtSchluessel,
  ortAusAdresse,
  ortText,
  PLZ_MUSTER,
  type AuftragPunktQuelle,
  type EinsatzKarte,
  type KartenAuftragPunkt,
  type KartenPerson,
  type Punkt,
} from "@/lib/einsatz";
import { polylineDekodieren } from "@/components/neu/kalkulation/route-karte-bild-logik";
import { ladeEinsatzLage } from "./einsatz";
import { ortPunkte, type OrtAnfrage } from "./einsatz-geo";

export interface KartenLead {
  von: string | null;
  nach: string | null;
  chatVon: string | null;
  chatNach: string | null;
}

const ROUTE_HINWEIS = "Noch keine Route: erst die Kalkulation rechnen.";
const AUFTRAG_OHNE_PUNKT = "Auftragsort ohne Kartenpunkt.";

function textVon(w: unknown): string | null {
  return typeof w === "string" && w.trim() !== "" ? w.trim() : null;
}

function anzeige(adresse: string | null, ersatz: string): string {
  const { plz, ort } = adresse ? ortAusAdresse(adresse) : { plz: null, ort: null };
  if (ort?.trim()) return ort.trim();
  // Review M2: nur die PLZ ist lesbar.
  return plz ? `PLZ ${plz}` : ersatz;
}

/** Ort ohne PLZ ist mehrdeutig („Neustadt“): Punkt nur ungefähr (Review M3). */
function nurOrt(adresse: string | null): boolean {
  if (!adresse) return false;
  const { plz, ort } = ortAusAdresse(adresse);
  return !plz && !!ort;
}

function ortAnfrage(adresse: string): OrtAnfrage | null {
  const { plz, ort } = ortAusAdresse(adresse);
  const plz5 = plz && PLZ_MUSTER.test(plz) ? plz : null;
  const schluessel = kartenOrtSchluessel(plz5, ort);
  if (!schluessel) return null;
  // Review M2: PLZ allein reicht (Google mit components=postal_code).
  const text = ort ? ortText({ plz: plz5, wohnort: ort }) : plz5;
  if (!text) return null;
  return { schluessel, text, plz: plz5 };
}

function merken(liste: OrtAnfrage[], anfrage: OrtAnfrage | null): void {
  if (!anfrage || liste.some((a) => a.schluessel === anfrage.schluessel)) return;
  liste.push(anfrage);
}

/** Hauptstrecke, sonst das Ende von Station → Beladen. Kaputte Polylinie: null. */
function routeAus(strecken: RoutenTeilstrecke[] | null): { linie: Punkt[]; beladen: Punkt; entladen: Punkt | null } | null {
  if (!strecken?.length) return null;
  const haupt = strecken.find((s) => s.haupt === true);
  if (haupt) {
    const linie = polylineDekodieren(typeof haupt.polyline === "string" ? haupt.polyline : "");
    if (linie.length < 2) return null;
    return { linie, beladen: linie[0]!, entladen: linie[linie.length - 1]! };
  }
  const nachBeladen = strecken.find((s) => s.nach === "Beladen");
  if (!nachBeladen) return null;
  const linie = polylineDekodieren(typeof nachBeladen.polyline === "string" ? nachBeladen.polyline : "");
  if (linie.length < 2) return null;
  return { linie: [], beladen: linie[linie.length - 1]!, entladen: null };
}

async function routenStandard(ws: string, versionId: string): Promise<RoutenTeilstrecke[] | null> {
  const [z] = await db
    .select({ teilstrecken: dealCalculationRoutes.teilstrecken })
    .from(dealCalculationRoutes)
    .where(and(eq(dealCalculationRoutes.workspaceId, ws), eq(dealCalculationRoutes.calculationVersionId, versionId)))
    .limit(1);
  return z?.teilstrecken ?? null;
}

async function leadStandard(ws: string, deal: string): Promise<KartenLead | null> {
  const { ladeLeadDaten } = await import("./rechner/lead-daten");
  const lead = await ladeLeadDaten(ws, deal);
  if (!lead) return null;
  return {
    von: textVon(lead.von),
    nach: textVon(lead.nach),
    chatVon: textVon(lead.chatAdressen?.von),
    // Einzug noch offen: kein Ziel aus dem Chat auf der Karte (Review M6).
    chatNach: lead.einzugOffen ? null : textVon(lead.chatAdressen?.nach),
  };
}

function orteHinweis(n: number): string | null {
  if (n === 1) return "1 Ort ohne Kartenpunkt.";
  if (n > 1) return `${n} Orte ohne Kartenpunkt.`;
  return null;
}

export async function ladeEinsatzKarte(
  ws: string,
  deal: string,
  o: {
    jetzt?: Date;
    orte?: typeof ortPunkte;
    routen?: (ws: string, versionId: string) => Promise<RoutenTeilstrecke[] | null>;
    lead?: (ws: string, deal: string) => Promise<KartenLead | null>;
  } = {},
): Promise<EinsatzKarte> {
  const jetzt = o.jetzt ?? new Date();
  const orteFn = o.orte ?? ((w: string, liste: OrtAnfrage[]) => ortPunkte(w, liste, { jetzt }));
  const lage = await ladeEinsatzLage(ws, deal, { jetzt });
  const strecken = lage.version?.id ? await (o.routen ?? routenStandard)(ws, lage.version.id) : null;
  const route = routeAus(strecken);

  let beladenAdresse: string | null = null;
  let entladenAdresse: string | null = null;
  let beladenQuelle: AuftragPunktQuelle = "ort";
  let entladenQuelle: AuftragPunktQuelle = "ort";

  if (route) {
    beladenAdresse = textVon(lage.anfrage?.von_adresse);
    entladenAdresse = textVon(lage.anfrage?.nach_adresse);
  } else {
    beladenAdresse = textVon(lage.anfrage?.von_adresse);
    entladenAdresse = textVon(lage.anfrage?.nach_adresse);
    if (!beladenAdresse || !entladenAdresse) {
      const lead = await (o.lead ?? leadStandard)(ws, deal).catch(() => null);
      if (!beladenAdresse) {
        const ausLead = textVon(lead?.von);
        const ausChat = textVon(lead?.chatVon);
        if (ausLead) beladenAdresse = ausLead;
        else if (ausChat) {
          beladenAdresse = ausChat;
          beladenQuelle = "chat";
        }
      }
      if (!entladenAdresse) {
        const ausLead = textVon(lead?.nach);
        const ausChat = textVon(lead?.chatNach);
        if (ausLead) entladenAdresse = ausLead;
        else if (ausChat) {
          entladenAdresse = ausChat;
          entladenQuelle = "chat";
        }
      }
    }
  }

  const anfragen: OrtAnfrage[] = [];
  const beladenOrt = !route && beladenAdresse ? ortAnfrage(beladenAdresse) : null;
  const entladenOrt = !route && entladenAdresse ? ortAnfrage(entladenAdresse) : null;
  merken(anfragen, beladenOrt);
  merken(anfragen, entladenOrt);

  const aktiv = lage.personen.filter((p) => p.aktiv === true);
  const meta = aktiv.map((p) => {
    const ohneWohnort = (p.wohnort ?? "").trim() === "";
    const schluessel = ohneWohnort ? null : kartenOrtSchluessel(p.plz, p.wohnort);
    const anzeigeText = ortText(p);
    if (schluessel && anzeigeText) {
      const plzRoh = (p.plz ?? "").trim();
      merken(anfragen, { schluessel, text: anzeigeText, plz: PLZ_MUSTER.test(plzRoh) ? plzRoh : null });
    }
    return { p, schluessel, anzeigeText };
  });

  const geo = anfragen.length > 0 ? await orteFn(ws, anfragen) : { punkte: new Map<string, Punkt>() };
  const punkte = geo.punkte;

  let beladen: KartenAuftragPunkt | null = null;
  let entladen: KartenAuftragPunkt | null = null;
  let linie: Punkt[] = [];
  if (route) {
    linie = route.linie;
    beladen = { punkt: route.beladen, text: anzeige(beladenAdresse, "Beladen"), quelle: "route" };
    entladen = route.entladen ? { punkt: route.entladen, text: anzeige(entladenAdresse, "Entladen"), quelle: "route" } : null;
  } else {
    const beladenPunkt = beladenOrt ? punkte.get(beladenOrt.schluessel) : undefined;
    const entladenPunkt = entladenOrt ? punkte.get(entladenOrt.schluessel) : undefined;
    if (beladenPunkt)
      beladen = {
        punkt: beladenPunkt,
        text: anzeige(beladenAdresse, "Beladen"),
        quelle: beladenQuelle,
        ...(nurOrt(beladenAdresse) ? { ungefaehr: true } : {}),
      };
    if (entladenPunkt)
      entladen = {
        punkt: entladenPunkt,
        text: anzeige(entladenAdresse, "Entladen"),
        quelle: entladenQuelle,
        ...(nurOrt(entladenAdresse) ? { ungefaehr: true } : {}),
      };
  }

  const personen: KartenPerson[] = meta.map(({ p, schluessel, anzeigeText }) => ({
    employeeId: p.id,
    name: p.name,
    kuerzel: p.kuerzel || kuerzelAus(p.name),
    ortText: anzeigeText,
    ortSchluessel: schluessel,
    punkt: schluessel ? punkte.get(schluessel) ?? null : null,
    lage: p.lage,
  }));

  const hinweise: string[] = [];
  // „Noch keine Route“ nur, wenn gar kein Ort bekannt ist (Auftrag 10.11. Punkt 1); ist ein Ort
  // bekannt, fehlt nur der Kartenpunkt (etwa ohne Freigabe der Geocoding API).
  if (!beladen && !entladen && linie.length === 0) hinweise.push(beladenOrt || entladenOrt ? AUFTRAG_OHNE_PUNKT : ROUTE_HINWEIS);
  const fehlendeOrte = new Set(personen.filter((p) => p.ortSchluessel && !p.punkt).map((p) => p.ortSchluessel));
  const orteText = orteHinweis(fehlendeOrte.size);
  if (orteText) hinweise.push(orteText);

  return { beladen, entladen, linie, hinweise, personen };
}
