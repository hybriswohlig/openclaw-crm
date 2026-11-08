/**
 * Kasse laden (Plan 9). Liest nur: alle lebenden Deals über `ladeLeadsRoh`
 * (das Board lädt sie schon vollständig), Zahlungsregel je Firma mit Cache,
 * dann die reinen Schlangen aus `kasseEintraege`.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { objects } from "@/db/schema/objects";
import { records } from "@/db/schema/records";
import {
  berlinTag,
  kasseEintraege,
  kasseZaehler,
  type FirmenZahlungsregel,
  type KasseAntwort,
  type KasseDealRoh,
} from "@/lib/geld";
import {
  durchgefuehrtAmAus,
  ersterTermin,
  offenVonLead,
  type LeadRoh,
  type StufeZeile,
} from "@/lib/leads-board-bauen";
import { offeneMeldungen } from "@/lib/zahlungsmeldungen";
import { ladeZahlungsregel } from "@/services/company-settings";
import { ladeLeadsRoh } from "@/services/leads-board";

/** So lange gilt der Seitenleisten-Zähler je Workspace (wie `ladeNavZaehler`). */
export const KASSE_ZAEHLER_CACHE_MS = 30_000;

const zaehlerCache = new Map<string, { bis: number; wert: Promise<number> }>();

/** Nur für Tests. */
export function kasseZaehlerCacheLeeren(): void {
  zaehlerCache.clear();
}

/**
 * `ocId` ist ein lebendes `operating_companies`-Record dieses Workspace
 * (gleiche Prüfung wie `speichereFirmenEinstellungen`).
 */
export async function betriebsfirmaImWorkspace(ws: string, ocId: string): Promise<boolean> {
  const [obj] = await db
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, ws), eq(objects.slug, "operating_companies")))
    .limit(1);
  if (!obj) return false;
  const [rec] = await db
    .select({ id: records.id })
    .from(records)
    .where(and(eq(records.id, ocId), eq(records.objectId, obj.id), isNull(records.deletedAt)))
    .limit(1);
  return Boolean(rec);
}

function kategorieVon(roh: LeadRoh, stufen: Map<string, StufeZeile>): string | null {
  if (!roh.stufeId) return null;
  return stufen.get(roh.stufeId)?.kategorie ?? null;
}

async function regelnLaden(ws: string, firmaIds: (string | null)[]): Promise<Map<string, FirmenZahlungsregel>> {
  const einzig = [...new Set(firmaIds)];
  const paare = await Promise.all(
    einzig.map(async (id) => [id ?? "", await ladeZahlungsregel(ws, id)] as const),
  );
  return new Map(paare);
}

function dealAus(
  roh: LeadRoh,
  stufen: Map<string, StufeZeile>,
  firmen: Map<string, string>,
  regeln: Map<string, FirmenZahlungsregel>,
): KasseDealRoh {
  const kategorie = kategorieVon(roh, stufen);
  return {
    dealId: roh.id,
    name: roh.name?.trim() || "Ohne Namen",
    nummer: roh.nummer,
    firmaId: roh.firmaId,
    firmaName: roh.firmaId ? firmen.get(roh.firmaId) ?? null : null,
    kategorie,
    termin: ersterTermin(roh),
    durchgefuehrtAm: durchgefuehrtAmAus(roh, kategorie),
    offen: offenVonLead(roh),
    rechnung: roh.rechnung,
    meldungen: offeneMeldungen(roh.meldungsEreignisse),
    anzahlungCent: roh.anzahlungCent,
    regel: regeln.get(roh.firmaId ?? "") as FirmenZahlungsregel,
    kanalFehlt: roh.letzteNachrichtAm == null,
  };
}

/** `GET /api/v1/kasse`. `firmaId` filtert auf die Betriebsfirma des Deals. */
export async function ladeKasse(ws: string, firmaId: string | null, jetzt: Date = new Date()): Promise<KasseAntwort> {
  const geladen = await ladeLeadsRoh(ws, jetzt);
  const stufen = new Map(geladen.stufen.map((s) => [s.id, s]));
  const firmen = new Map(geladen.stamm.firmen.map((f) => [f.id, f.name]));
  const leads = (firmaId ? geladen.roh.filter((r) => r.firmaId === firmaId) : geladen.roh);
  const regeln = await regelnLaden(ws, leads.map((r) => r.firmaId));
  const deals = leads.map((r) => dealAus(r, stufen, firmen, regeln));
  return kasseEintraege(deals, berlinTag(jetzt), jetzt.toISOString());
}

/**
 * Zähler der Seitenleiste. Gleichzeitige Aufrufe teilen sich eine Abfrage,
 * Fehler werden nicht gemerkt. 30 Sekunden je Workspace.
 */
export function ladeKasseZaehler(ws: string, jetzt: Date = new Date()): Promise<number> {
  const t = jetzt.getTime();
  const treffer = zaehlerCache.get(ws);
  if (treffer && treffer.bis > t) return treffer.wert;
  const wert = ladeKasse(ws, null, jetzt).then(kasseZaehler);
  zaehlerCache.set(ws, { bis: t + KASSE_ZAEHLER_CACHE_MS, wert });
  wert.catch(() => {
    if (zaehlerCache.get(ws)?.wert === wert) zaehlerCache.delete(ws);
  });
  return wert;
}
