/**
 * Transporter-Buchungen je Betriebsfirma (Plan 12b). Eine Buchung wird nie
 * gelöscht, nur storniert. Zuordnungen und Warnungen lesen den Deal live
 * (Name, Umzugstag) und die eingefrorenen Anteile gesperrter Versionen.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealVehicleBookings, vehicleBookings } from "@/db/schema";
import { alsJson, zeilen } from "@/lib/db-werte";
import {
  anteilAusRechnerFeld,
  buchungsLeisteText,
  buchungsWarnungen,
  istTag,
  pruefeBuchung,
  type BuchungEingabe,
  type BuchungStatus,
  type BuchungZuordnung,
  type EingefrorenerAnteil,
  type EinsatzFehlerCode,
  type TransporterBuchung,
} from "@/lib/einsatz";
import { ladeDealKopf } from "@/services/kalkulations-ansicht-db";
import type { DbExecutor } from "@/services/einsatz-personen";

const STATUS: readonly BuchungStatus[] = ["geplant", "bestaetigt", "storniert"];
const NOTIZ_MAX = 300;

export type BuchungMitZuordnung = TransporterBuchung & { zuordnungen: BuchungZuordnung[] };
export type BuchungMitWarnungen = BuchungMitZuordnung & { text: string; warnungen: string[] };

type BuchungZeile = {
  id: string;
  operatingCompanyRecordId: string;
  von: string;
  bis: string;
  stationId: string;
  stationName: string;
  stationAnbieter: string | null;
  klasseId: string;
  klasseName: string;
  mieteCents: number;
  inklusivKm: number | null;
  mehrkmSatzCents: number | null;
  geplanteAuftraege: number;
  status: BuchungStatus;
  notiz: string | null;
};

function tagOderNull(wert: unknown): string | null {
  if (wert === null || wert === undefined || wert === "") return null;
  const s = wert instanceof Date ? wert.toISOString().slice(0, 10) : String(wert).slice(0, 10);
  return istTag(s) ? s : null;
}

function ganzOderNull(wert: unknown): number | null {
  if (wert === null || wert === undefined || wert === "") return null;
  const n = typeof wert === "number" ? wert : Number(wert);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function notizAus(wert: string | null | undefined): string | null {
  if (wert == null) return null;
  const t = wert.trim().slice(0, NOTIZ_MAX);
  return t === "" ? null : t;
}

function buchungAus(z: BuchungZeile): TransporterBuchung {
  return {
    id: z.id,
    firmaId: z.operatingCompanyRecordId,
    von: z.von.slice(0, 10),
    bis: z.bis.slice(0, 10),
    stationId: z.stationId,
    stationName: z.stationName,
    stationAnbieter: z.stationAnbieter,
    klasseId: z.klasseId,
    klasseName: z.klasseName,
    mieteCent: z.mieteCents,
    inklusivKm: z.inklusivKm,
    mehrkmSatzCent: z.mehrkmSatzCents,
    geplanteAuftraege: z.geplanteAuftraege,
    status: z.status,
    notiz: z.notiz,
  };
}

type ZuZeile = {
  booking_id: string;
  deal_id: string;
  titel: string | null;
  tag: string | null;
  geschaetzte_km: number | null;
};

/** Lebende Deals des Workspace, Name und Umzugstag (`move_date` → `date_value`). */
async function zuordnungenFuer(ws: string, ids: readonly string[]): Promise<Map<string, BuchungZuordnung[]>> {
  const map = new Map<string, BuchungZuordnung[]>();
  if (ids.length === 0) return map;
  const res = await db.execute(sql`
    SELECT
      dvb.booking_id,
      dvb.deal_record_id AS deal_id,
      dvb.geschaetzte_km,
      COALESCE(NULLIF(btrim((
        SELECT v.text_value FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'name'
        WHERE v.record_id = r.id
        ORDER BY v.sort_order, v.id
        LIMIT 1
      )), ''), 'Ohne Namen') AS titel,
      (
        SELECT v.date_value::text FROM record_values v
        INNER JOIN attributes a ON a.id = v.attribute_id AND a.object_id = r.object_id AND a.slug = 'move_date'
        WHERE v.record_id = r.id AND v.date_value IS NOT NULL
        ORDER BY v.sort_order, v.id
        LIMIT 1
      ) AS tag
    FROM deal_vehicle_bookings dvb
    INNER JOIN records r ON r.id = dvb.deal_record_id AND r.deleted_at IS NULL
    INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
    WHERE dvb.workspace_id = ${ws}
      AND dvb.booking_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    ORDER BY dvb.booking_id, titel, dvb.deal_record_id
  `);
  for (const z of zeilen<ZuZeile>(res)) {
    const liste = map.get(z.booking_id) ?? [];
    liste.push({
      dealId: z.deal_id,
      titel: z.titel?.trim() || "Ohne Namen",
      tag: tagOderNull(z.tag),
      geschaetzteKm: ganzOderNull(z.geschaetzte_km),
    });
    map.set(z.booking_id, liste);
  }
  return map;
}

async function zeileInWorkspace(ws: string, id: string): Promise<BuchungZeile | null> {
  const [zeile] = await db
    .select()
    .from(vehicleBookings)
    .where(and(eq(vehicleBookings.id, id), eq(vehicleBookings.workspaceId, ws)))
    .limit(1);
  return zeile ?? null;
}

async function warnungenFuer(ws: string, buchung: TransporterBuchung): Promise<string[]> {
  const zuordnungen = (await zuordnungenFuer(ws, [buchung.id])).get(buchung.id) ?? [];
  return buchungsWarnungen({
    buchung,
    zuordnungen,
    eingefroren: await eingefroreneAnteile(ws, buchung.id),
  });
}

/**
 * Buchungen des Workspace, deren Zeitraum `von..bis` schneidet
 * (`von` ≤ Ende der Buchung und `bis` ≥ Anfang der Buchung).
 */
export async function ladeBuchungen(
  ws: string,
  von: string,
  bis: string,
  firmaId?: string | null,
): Promise<BuchungMitZuordnung[]> {
  const zeilenBuchung = await db
    .select()
    .from(vehicleBookings)
    .where(
      and(
        eq(vehicleBookings.workspaceId, ws),
        lte(vehicleBookings.von, bis),
        gte(vehicleBookings.bis, von),
        firmaId ? eq(vehicleBookings.operatingCompanyRecordId, firmaId) : undefined,
      ),
    )
    .orderBy(asc(vehicleBookings.von), asc(vehicleBookings.id));
  const zuordnungen = await zuordnungenFuer(ws, zeilenBuchung.map((z) => z.id));
  return zeilenBuchung.map((z) => {
    const buchung = buchungAus(z);
    return { ...buchung, zuordnungen: zuordnungen.get(buchung.id) ?? [] };
  });
}

/** Wie `ladeBuchungen`, plus Leistetext und Warnungen (eingefrorene Anteile je Buchung). */
export async function buchungenMitWarnungen(
  ws: string,
  von: string,
  bis: string,
  firmaId?: string | null,
): Promise<BuchungMitWarnungen[]> {
  const liste = await ladeBuchungen(ws, von, bis, firmaId);
  const aus: BuchungMitWarnungen[] = [];
  for (const b of liste) {
    aus.push({
      ...b,
      text: buchungsLeisteText(b, b.zuordnungen),
      warnungen: buchungsWarnungen({
        buchung: b,
        zuordnungen: b.zuordnungen,
        eingefroren: await eingefroreneAnteile(ws, b.id),
      }),
    });
  }
  return aus;
}

/** Legt an. Der Aufrufer hat `pruefeBuchung` und die Firma schon geprüft. */
export async function buchungAnlegen(ws: string, e: BuchungEingabe, autor: string): Promise<TransporterBuchung> {
  const jetzt = new Date();
  const [zeile] = await db
    .insert(vehicleBookings)
    .values({
      id: crypto.randomUUID(),
      workspaceId: ws,
      operatingCompanyRecordId: e.firmaId,
      von: e.von,
      bis: e.bis,
      stationId: e.stationId,
      stationName: e.stationName,
      stationAnbieter: e.stationAnbieter,
      klasseId: e.klasseId,
      klasseName: e.klasseName,
      mieteCents: e.mieteCent,
      inklusivKm: e.inklusivKm,
      mehrkmSatzCents: e.mehrkmSatzCent,
      geplanteAuftraege: e.geplanteAuftraege,
      status: e.status ?? "geplant",
      notiz: notizAus(e.notiz),
      createdBy: autor,
      createdAt: jetzt,
      updatedAt: jetzt,
    })
    .returning();
  return buchungAus(zeile!);
}

/**
 * Ändert eine Buchung. `null`, wenn sie nicht im Workspace liegt. Stornierte
 * Buchungen bleiben liegen und lassen sich nicht mehr ändern. `firmaId` im
 * Patch wird ignoriert.
 */
export async function buchungAendern(
  ws: string,
  id: string,
  e: Partial<BuchungEingabe>,
  _autor: string,
): Promise<{ buchung: TransporterBuchung; warnungen: string[] } | { fehler: EinsatzFehlerCode } | null> {
  const zeile = await zeileInWorkspace(ws, id);
  if (!zeile) return null;
  const bisher = buchungAus(zeile);
  if (bisher.status === "storniert") return { fehler: "BUCHUNG_STORNIERT" };
  if (e.status !== undefined && !STATUS.includes(e.status)) return { fehler: "BUCHUNG_UNGUELTIG" };

  const status = e.status ?? bisher.status;
  const eingabe: BuchungEingabe = {
    firmaId: bisher.firmaId,
    von: e.von ?? bisher.von,
    bis: e.bis ?? bisher.bis,
    stationId: e.stationId ?? bisher.stationId,
    stationName: e.stationName ?? bisher.stationName,
    stationAnbieter: e.stationAnbieter !== undefined ? e.stationAnbieter : bisher.stationAnbieter,
    klasseId: e.klasseId ?? bisher.klasseId,
    klasseName: e.klasseName ?? bisher.klasseName,
    mieteCent: e.mieteCent ?? bisher.mieteCent,
    inklusivKm: e.inklusivKm !== undefined ? e.inklusivKm : bisher.inklusivKm,
    mehrkmSatzCent: e.mehrkmSatzCent !== undefined ? e.mehrkmSatzCent : bisher.mehrkmSatzCent,
    geplanteAuftraege: e.geplanteAuftraege ?? bisher.geplanteAuftraege,
    notiz: e.notiz !== undefined ? notizAus(e.notiz) : bisher.notiz,
    status,
  };
  const fehler = pruefeBuchung(eingabe);
  if (fehler) return { fehler };

  const [aktualisiert] = await db
    .update(vehicleBookings)
    .set({
      von: eingabe.von,
      bis: eingabe.bis,
      stationId: eingabe.stationId,
      stationName: eingabe.stationName,
      stationAnbieter: eingabe.stationAnbieter,
      klasseId: eingabe.klasseId,
      klasseName: eingabe.klasseName,
      mieteCents: eingabe.mieteCent,
      inklusivKm: eingabe.inklusivKm,
      mehrkmSatzCents: eingabe.mehrkmSatzCent,
      geplanteAuftraege: eingabe.geplanteAuftraege,
      status,
      notiz: eingabe.notiz,
      updatedAt: new Date(),
    })
    .where(and(eq(vehicleBookings.id, id), eq(vehicleBookings.workspaceId, ws)))
    .returning();
  if (!aktualisiert) return null;
  const buchung = buchungAus(aktualisiert);
  return { buchung, warnungen: await warnungenFuer(ws, buchung) };
}

/** Kilometer der Empfehlung aus der neuesten Version mit Rechner-Ergebnis. */
async function geschaetzteKm(ws: string, deal: string): Promise<number | null> {
  const res = await db.execute(sql`
    SELECT rechner_result
    FROM deal_calculation_versions
    WHERE workspace_id = ${ws}
      AND deal_record_id = ${deal}
      AND rechner_result IS NOT NULL
    ORDER BY version DESC
    LIMIT 1
  `);
  const [z] = zeilen<{ rechner_result: unknown }>(res);
  if (!z) return null;
  const ergebnis = alsJson(z.rechner_result);
  if (!ergebnis || typeof ergebnis !== "object") return null;
  const o = ergebnis as { empfehlungOptionId?: unknown; fahrzeugoptionen?: unknown };
  if (typeof o.empfehlungOptionId !== "string" || !Array.isArray(o.fahrzeugoptionen)) return null;
  const option = o.fahrzeugoptionen.find(
    (x) => !!x && typeof x === "object" && (x as { id?: unknown }).id === o.empfehlungOptionId,
  ) as { km?: unknown } | undefined;
  return option ? ganzOderNull(option.km) : null;
}

/**
 * Hängt den Deal an die Buchung (eine Zeile je Deal; ein zweites Mal verschiebt).
 * Ein Termin außerhalb des Zeitraums ist erlaubt und erscheint in den Warnungen.
 */
export async function zuordnen(
  ws: string,
  id: string,
  deal: string,
  autor: string,
): Promise<{ ok: true; warnungen: string[] } | { ok: false; code: EinsatzFehlerCode } | null> {
  const zeile = await zeileInWorkspace(ws, id);
  if (!zeile) return null;
  const buchung = buchungAus(zeile);
  if (buchung.status === "storniert") return { ok: false, code: "BUCHUNG_STORNIERT" };
  const kopf = await ladeDealKopf(ws, deal);
  if (kopf.firmaId !== buchung.firmaId) return { ok: false, code: "FALSCHE_FIRMA" };

  const km = await geschaetzteKm(ws, deal);
  const jetzt = new Date();
  await db
    .insert(dealVehicleBookings)
    .values({
      dealRecordId: deal,
      bookingId: id,
      workspaceId: ws,
      geschaetzteKm: km,
      createdBy: autor,
      createdAt: jetzt,
    })
    .onConflictDoUpdate({
      target: dealVehicleBookings.dealRecordId,
      set: { bookingId: id, geschaetzteKm: km, createdBy: autor, createdAt: jetzt },
    });
  return { ok: true, warnungen: await warnungenFuer(ws, buchung) };
}

/** Löst die Zuordnung des Deals. `false`, wenn keine Zeile in diesem Workspace lag. */
export async function loesen(ws: string, deal: string): Promise<boolean> {
  const rows = await db
    .delete(dealVehicleBookings)
    .where(and(eq(dealVehicleBookings.dealRecordId, deal), eq(dealVehicleBookings.workspaceId, ws)))
    .returning({ dealRecordId: dealVehicleBookings.dealRecordId });
  return rows.length > 0;
}

/** Die Buchung, an der der Deal hängt. Alle Abfragen laufen über `ex`. */
export async function dealBuchung(ws: string, deal: string, ex: DbExecutor = db): Promise<TransporterBuchung | null> {
  const [row] = await ex
    .select({
      id: vehicleBookings.id,
      operatingCompanyRecordId: vehicleBookings.operatingCompanyRecordId,
      von: vehicleBookings.von,
      bis: vehicleBookings.bis,
      stationId: vehicleBookings.stationId,
      stationName: vehicleBookings.stationName,
      stationAnbieter: vehicleBookings.stationAnbieter,
      klasseId: vehicleBookings.klasseId,
      klasseName: vehicleBookings.klasseName,
      mieteCents: vehicleBookings.mieteCents,
      inklusivKm: vehicleBookings.inklusivKm,
      mehrkmSatzCents: vehicleBookings.mehrkmSatzCents,
      geplanteAuftraege: vehicleBookings.geplanteAuftraege,
      status: vehicleBookings.status,
      notiz: vehicleBookings.notiz,
    })
    .from(dealVehicleBookings)
    .innerJoin(vehicleBookings, eq(vehicleBookings.id, dealVehicleBookings.bookingId))
    .where(
      and(
        eq(dealVehicleBookings.dealRecordId, deal),
        eq(dealVehicleBookings.workspaceId, ws),
        eq(vehicleBookings.workspaceId, ws),
      ),
    )
    .limit(1);
  return row ? buchungAus(row) : null;
}

/**
 * Review M5: je Deal nur die neueste gesperrte Version (die gilt beim Kunden).
 * Nennt sie die Buchung (`vehicle_booking_id` oder ein Tag in `day_prices`),
 * zählt ihr Anteil aus der gespeicherten Anfrage; Datum = Umzugsdatum, wenn
 * die Buchung am Hauptdatum gilt, sonst der erste Tag mit dieser Buchung.
 * Eine neuere gesperrte Version ohne Buchung beendet die Warnung.
 */
export async function eingefroreneAnteile(ws: string, buchungId: string): Promise<EingefrorenerAnteil[]> {
  const res = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (v.deal_record_id)
        v.deal_record_id AS deal_id,
        v.vehicle_booking_id AS haupt,
        v.day_prices AS tage,
        v.rechner_request->>'buchung' AS buchung,
        v.rechner_request->>'umzugsdatum' AS datum,
        COALESCE(NULLIF(btrim((
          SELECT rv.text_value FROM record_values rv
          INNER JOIN attributes a ON a.id = rv.attribute_id AND a.object_id = r.object_id AND a.slug = 'name'
          WHERE rv.record_id = r.id
          ORDER BY rv.sort_order, rv.id
          LIMIT 1
        )), ''), 'Ohne Namen') AS titel
      FROM deal_calculation_versions v
      INNER JOIN records r ON r.id = v.deal_record_id
      INNER JOIN objects o ON o.id = r.object_id AND o.workspace_id = ${ws} AND o.slug = 'deals'
      WHERE v.workspace_id = ${ws} AND v.status = 'gesperrt'
      ORDER BY v.deal_record_id, v.version DESC
    ) neueste
    WHERE neueste.haupt = ${buchungId}
       OR neueste.tage @> ${JSON.stringify([{ vehicleBookingId: buchungId }])}::jsonb
  `);
  const aus: EingefrorenerAnteil[] = [];
  for (const z of zeilen<{ deal_id: string; haupt: string | null; tage: unknown; buchung: string | null; datum: string | null; titel: string | null }>(res)) {
    const anteil = anteilAusRechnerFeld(z.buchung);
    if (!anteil) continue;
    const tage = alsJson(z.tage);
    const tagMitBuchung = Array.isArray(tage)
      ? (tage as Array<{ vehicleBookingId?: unknown; datum?: unknown }>).find((t) => t?.vehicleBookingId === buchungId && typeof t.datum === "string")?.datum
      : undefined;
    const umzug = typeof z.datum === "string" ? z.datum.trim() : "";
    const datum = z.haupt === buchungId && umzug !== "" ? umzug : typeof tagMitBuchung === "string" ? tagMitBuchung : umzug;
    if (datum === "") continue;
    aus.push({ dealId: z.deal_id, titel: z.titel?.trim() || "Ohne Namen", datum, anteil });
  }
  return aus;
}
