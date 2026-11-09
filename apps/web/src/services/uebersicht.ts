/**
 * Übersicht laden (Plan 13, Task C). Liest nur.
 *
 * Deals kommen aus `ladeLeadsRoh` (derselbe Umfang wie Board und Kasse).
 * Dieses Ergebnis geht an `ladeKasse`, damit die Deals nicht noch einmal
 * geladen werden. Zahlungen und `move_completed_at` sind je eine Abfrage.
 * 60 Sekunden je Workspace und Firma; gleichzeitige Aufrufe teilen sich
 * ein Promise, Fehler werden nicht gemerkt.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { berlinDateString } from "@/lib/berlin-date";
import { alsIso, zeilen } from "@/lib/db-werte";
import {
  abschlussJeMonat,
  anfragenJeMonat,
  durchfuehrungsTag,
  durchgefuehrtJeMonat,
  monateBis,
  zuflussJeMonat,
  type UebersichtAntwort,
  type UebersichtDeal,
  type ZuflussZeile,
} from "@/lib/einstellungen-uebersicht";
import { offenAus } from "@/lib/geld";
import type { LeadRoh, StufeZeile } from "@/lib/leads-board-bauen";
import { ladeNavZaehler } from "@/services/heute";
import { ladeKasse } from "@/services/kasse";
import { loadNonLeadDealIds } from "@/services/kontaktart";
import { ladeLeadsRoh } from "@/services/leads-board";

/** So lange gilt eine Übersicht je Workspace und Firma. */
export const UEBERSICHT_CACHE_MS = 60_000;

const cache = new Map<string, { bis: number; wert: Promise<UebersichtAntwort> }>();

/** Nur für Tests. */
export function uebersichtCacheLeeren(): void {
  cache.clear();
}

/**
 * Kalendertag `YYYY-MM-DD` aus `payments.date`. Text bleibt der gespeicherte
 * Tag; ein Date von postgres.js (`new Date("YYYY-MM-DD")`, Mitternacht UTC)
 * wird über die UTC-Teile gelesen, damit der Tag nicht wandert.
 */
function kalenderTag(v: unknown): string | null {
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    return m ? m[1] : null;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const mo = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${v.getUTCFullYear()}-${mo}-${d}`;
  }
  return null;
}

/** Erster `move_completed_at` je lebendem Deal des Workspace, als ISO-Zeit (UTC). */
async function durchgefuehrtAmLesen(ws: string): Promise<Map<string, string>> {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (r.id)
           r.id AS deal_id,
           rv.timestamp_value::text AS am
    FROM records r
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    INNER JOIN attributes a ON a.object_id = o.id AND a.slug = 'move_completed_at'
    INNER JOIN record_values rv
      ON rv.record_id = r.id AND rv.attribute_id = a.id AND rv.timestamp_value IS NOT NULL
    WHERE r.deleted_at IS NULL
    ORDER BY r.id, rv.sort_order, rv.id
  `);
  const aus = new Map<string, string>();
  for (const z of zeilen<{ deal_id: string; am: unknown }>(res)) {
    const iso = alsIso(z.am);
    if (iso) aus.set(z.deal_id, iso);
  }
  return aus;
}

/**
 * Zahlungen ab `startTag`. Firma: Schnappschuss `operating_company_id`, sonst
 * die Firma am Deal (Attribut `operating_company`), sonst null. Gelöschte
 * Deals bleiben drin, Zahlungen ohne Deal zählen mit — wie `getFinancialOverview`.
 */
async function zahlungenLesen(ws: string, startTag: string): Promise<ZuflussZeile[]> {
  const res = await db.execute(sql`
    SELECT p.date::text AS tag,
           p.amount::text AS betrag,
           p.tax_treatment AS tax_treatment,
           COALESCE(p.operating_company_id, firma.referenced_record_id) AS firma_id
    FROM payments p
    LEFT JOIN LATERAL (
      SELECT rv.referenced_record_id
      FROM record_values rv
      INNER JOIN attributes a ON a.id = rv.attribute_id AND a.slug = 'operating_company'
      INNER JOIN objects o ON o.id = a.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE p.operating_company_id IS NULL
        AND rv.record_id = p.deal_record_id
        AND rv.referenced_record_id IS NOT NULL
      ORDER BY rv.sort_order, rv.id
      LIMIT 1
    ) firma ON true
    WHERE p.workspace_id = ${ws}
      AND p.date >= ${startTag}::date
  `);
  const aus: ZuflussZeile[] = [];
  for (const z of zeilen<{ tag: unknown; betrag: unknown; tax_treatment: string | null; firma_id: string | null }>(res)) {
    const tag = kalenderTag(z.tag);
    const cent = Math.round(Number(z.betrag) * 100);
    if (!tag || !Number.isFinite(cent)) continue;
    aus.push({
      tag,
      cent,
      taxTreatment: z.tax_treatment ?? null,
      firmaId: z.firma_id ?? null,
    });
  }
  return aus;
}

function dealsAus(
  roh: readonly LeadRoh[],
  stufen: Map<string, StufeZeile>,
  quellen: readonly { id: string; label: string }[],
  nonLead: Set<string>,
  abgeschlossen: Map<string, string>,
): UebersichtDeal[] {
  return roh.map((r) => {
    const kategorie = (r.stufeId ? stufen.get(r.stufeId)?.kategorie : null) ?? null;
    const quelle = r.quelleId
      ? { id: r.quelleId, label: quellen.find((q) => q.id === r.quelleId)?.label ?? "Unbekannte Quelle" }
      : null;
    return {
      id: r.id,
      angelegtTag: berlinDateString(new Date(r.erstelltAm)),
      kategorie,
      nichtLead: nonLead.has(r.id),
      firmaId: r.firmaId,
      quelle,
      durchgefuehrtTag: durchfuehrungsTag({
        kategorie,
        moveCompletedAt: abgeschlossen.get(r.id) ?? null,
        moveDate: r.umzugAm,
      }),
      auftragCent: offenAus({
        rechnung: r.rechnung ? { status: r.rechnung.status, bruttoCent: r.rechnung.bruttoCent } : null,
        annahmeCent: r.annahme?.cent ?? null,
        festpreis: r.angebot?.festpreisEuro ?? null,
        istStunden: r.angebot?.istStunden ?? false,
        zahlungen: [],
      }).gesamtCent,
    };
  });
}

async function uebersichtLesen(ws: string, firma: string | null, jetzt: Date): Promise<UebersichtAntwort> {
  const heute = berlinDateString(jetzt);
  const monate = monateBis(heute);
  const startTag = `${monate[0]}-01`;
  const [geladen, nonLead, abgeschlossen, zeilenZahlung, navZaehler] = await Promise.all([
    ladeLeadsRoh(ws, jetzt),
    loadNonLeadDealIds(ws),
    durchgefuehrtAmLesen(ws),
    zahlungenLesen(ws, startTag),
    ladeNavZaehler(ws, jetzt),
  ]);
  const stufen = new Map(geladen.stufen.map((s) => [s.id, s]));
  const deals = dealsAus(geladen.roh, stufen, geladen.stamm.quellen, nonLead, abgeschlossen);
  const kasse = await ladeKasse(ws, firma, jetzt, geladen);
  return {
    monate,
    firma,
    firmen: geladen.stamm.firmen.map((f) => ({ id: f.id, name: f.name })),
    eingegangen: zuflussJeMonat(zeilenZahlung, monate, firma),
    durchgefuehrt: durchgefuehrtJeMonat(deals, monate, firma),
    anfragen: anfragenJeMonat(deals, monate, firma),
    abschluss: abschlussJeMonat(deals, monate, firma),
    offen: {
      rest: {
        anzahl: kasse.summen.offen.anzahl,
        cent: kasse.summen.offen.cent,
        unbekannt: kasse.summen.offen.unbekannt,
      },
      ohneRechnung: {
        anzahl: kasse.summen.ohne_rechnung.anzahl,
        cent: kasse.summen.ohne_rechnung.cent,
        unbekannt: kasse.summen.ohne_rechnung.unbekannt,
      },
    },
    wartetAufUns: navZaehler.heute,
    stand: jetzt.toISOString(),
  };
}

/** `GET /api/v1/uebersicht`. `firma` null = alle Betriebsfirmen. */
export function ladeUebersicht(ws: string, firma: string | null, jetzt: Date = new Date()): Promise<UebersichtAntwort> {
  const schluessel = `${ws}|${firma ?? "*"}`;
  const t = jetzt.getTime();
  const treffer = cache.get(schluessel);
  if (treffer && treffer.bis > t) return treffer.wert;
  const wert = uebersichtLesen(ws, firma, jetzt);
  cache.set(schluessel, { bis: t + UEBERSICHT_CACHE_MS, wert });
  wert.catch(() => {
    if (cache.get(schluessel)?.wert === wert) cache.delete(schluessel);
  });
  return wert;
}
