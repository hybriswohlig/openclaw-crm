/**
 * Datenbank-Speicher der Kalkulationsversionen (Tabelle deal_calculation_versions)
 * und der Lader für die Paket-Hebel der Firma. Jede Abfrage ist auf Workspace
 * und Deal begrenzt; nur Entwürfe werden geändert.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import {
  customerDateSelections,
  kvaConfirmations,
  offerPackages,
  quotationDateOffers,
  quotationPackageOptions,
} from "@/db/schema/customer-portal";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { quotations } from "@/db/schema/quotations";
import { istFest, naechsterTag, type KapazitaetTag } from "@/lib/einsatz";
import { sperrWahl } from "@/lib/kalkulation-versionen";
import { wahlPaketSlug } from "@openclaw-crm/customer-portal-core";
import { resolveDealOperatingCompany } from "./financial";
import { AngebotAngenommenError, aktivBedingung } from "./kva-annahme";
import { angebotAusVersionSchreiben, angebotSperren, type AngebotAusVersion } from "./quotations";
import type { HebelArt } from "./rechner/kv-posten";
import {
  centSumme,
  EntwurfExistiertError,
  VersionsFehler,
  type PaketOption,
  type Plan5Sperre,
  type VersionsSpeicher,
  type VersionsZeile,
} from "./kalkulation-versionen";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Unique-Verletzungen, die "es gibt schon einen Entwurf" bedeuten (paralleles Anlegen). */
const ENTWURF_CONSTRAINTS = new Set(["deal_calculation_versions_ein_entwurf", "deal_calculation_versions_deal_version_unique"]);

/** Postgres 23505 auf einem der Entwurfs-Indizes, auch in `cause` verpackt (DrizzleQueryError). */
export function istEntwurfKonflikt(err: unknown): boolean {
  const gesehen = new Set<unknown>();
  let e: unknown = err;
  while (e && typeof e === "object" && !gesehen.has(e)) {
    gesehen.add(e);
    const f = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    const name = typeof f.constraint_name === "string" ? f.constraint_name : typeof f.constraint === "string" ? f.constraint : null;
    if (f.code === "23505" && name !== null && ENTWURF_CONSTRAINTS.has(name)) return true;
    e = f.cause;
  }
  return false;
}

const alsZeile = (z: typeof dealCalculationVersions.$inferSelect): VersionsZeile => z as unknown as VersionsZeile;

export const dbVersionsSpeicher: VersionsSpeicher = {
  async liste(ws, deal) {
    const zeilen = await db
      .select()
      .from(dealCalculationVersions)
      .where(and(eq(dealCalculationVersions.workspaceId, ws), eq(dealCalculationVersions.dealRecordId, deal)))
      .orderBy(asc(dealCalculationVersions.version));
    return zeilen.map(alsZeile);
  },

  async lesen(ws, deal, version) {
    const [z] = await db
      .select()
      .from(dealCalculationVersions)
      .where(
        and(
          eq(dealCalculationVersions.workspaceId, ws),
          eq(dealCalculationVersions.dealRecordId, deal),
          eq(dealCalculationVersions.version, version)
        )
      )
      .limit(1);
    return z ? alsZeile(z) : null;
  },

  async entwurf(ws, deal) {
    const [z] = await db
      .select()
      .from(dealCalculationVersions)
      .where(
        and(
          eq(dealCalculationVersions.workspaceId, ws),
          eq(dealCalculationVersions.dealRecordId, deal),
          eq(dealCalculationVersions.status, "entwurf")
        )
      )
      .limit(1);
    return z ? alsZeile(z) : null;
  },

  async anlegen(z) {
    try {
      const [neu] = await db.insert(dealCalculationVersions).values(z).returning();
      return alsZeile(neu);
    } catch (err) {
      if (istEntwurfKonflikt(err)) throw new EntwurfExistiertError();
      throw err;
    }
  },

  async aktualisieren(id, patch) {
    // id, Deal, Workspace, Nummer und Status ändert nur das Sperren.
    const felder: Partial<VersionsZeile> = { ...patch };
    // Übersteuerungen nur über anhaengen (atomar), nie durch Überschreiben der Liste.
    for (const k of ["id", "workspaceId", "dealRecordId", "version", "status", "createdAt", "overrides"] as const) delete felder[k];
    const [z] = await db
      .update(dealCalculationVersions)
      .set({ ...felder, updatedAt: new Date() })
      .where(and(eq(dealCalculationVersions.id, id), eq(dealCalculationVersions.status, "entwurf")))
      .returning();
    if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
    return alsZeile(z);
  },

  async anhaengen(id, u) {
    const t = dealCalculationVersions;
    const [z] = await db
      .update(t)
      .set({ overrides: sql`${t.overrides} || ${JSON.stringify([u])}::jsonb`, updatedAt: new Date() })
      .where(and(eq(t.id, id), eq(t.status, "entwurf")))
      .returning();
    if (!z) throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
    return alsZeile(z);
  },

  async sperrenUndAngebot(ws, deal, id, angebot, kvItems, von, stand) {
    return db.transaction(async (tx) => {
      // Zuerst die Sperre des Angebots (wie upsertQuotation), dann die Kundenannahme
      // erneut prüfen: sie kann während der Neuberechnung eingegangen sein. Wirft
      // innerhalb der Transaktion: nichts wird geschrieben.
      await angebotSperren(tx, deal);
      const [annahme] = await tx
        .select({ id: kvaConfirmations.id, total: kvaConfirmations.confirmedTotalCents })
        .from(kvaConfirmations)
        .where(aktivBedingung(deal))
        .limit(1);
      if (annahme && !stand?.annahmeAufheben) throw new AngebotAngenommenError();
      // Plan 16 (Bauteil 4): bestätigt aufheben, unter derselben Sperre wie die Annahme im Portal.
      // Nur die Annahme: Terminwahl, Reservierung, AB und Rechnung bleiben, wie sie sind.
      let annahmeAufgehoben: { id: string; totalCents: number | null } | null = null;
      if (annahme && stand?.annahmeAufheben) {
        await tx
          .update(kvaConfirmations)
          .set({
            supersededAt: new Date(),
            supersededBy: stand.annahmeAufheben.userId,
            supersededReason: stand.annahmeAufheben.grund.slice(0, 500),
          })
          .where(eq(kvaConfirmations.id, annahme.id));
        annahmeAufgehoben = { id: annahme.id, totalCents: annahme.total ?? null };
      }

      const jetzt = new Date();
      const t = dealCalculationVersions;
      const [z] = await tx
        .update(dealCalculationVersions)
        .set({
          // Der Stand, aus dem Preis und Posten gebildet wurden: so bleibt die gesperrte Zeile
          // stimmig, auch wenn eine ältere Neuberechnung kurz vorher noch gelandet ist.
          ...(stand?.schnappschuss ? { ...stand.schnappschuss, error: null } : {}),
          status: "gesperrt",
          kvItems,
          priceCents: stand?.plan5 ? stand.plan5.preise.priceCents : centSumme(kvItems),
          // Plan 5b: alle Kundenpreise samt Posten je Wahl, wie sie das Sperren gebildet hat.
          ...(stand?.plan5
            ? {
                pricingMode: stand.plan5.preise.pricingMode,
                packagePrices: stand.plan5.preise.packagePrices,
                dayPrices: stand.plan5.preise.dayPrices,
              }
            : {}),
          lockedAt: jetzt,
          lockedBy: von,
          updatedAt: jetzt,
        })
        .where(
          and(
            eq(dealCalculationVersions.id, id),
            eq(dealCalculationVersions.workspaceId, ws),
            eq(dealCalculationVersions.dealRecordId, deal),
            eq(dealCalculationVersions.status, "entwurf"),
            stand ? sql`jsonb_array_length(${t.overrides}) = ${stand.uebersteuerungen}` : undefined,
            // F2 (I2): optimistisch auf den gelesenen Stand. Jede Änderung am Entwurf (anhaengen,
            // aktualisieren, auch „Tage anbieten“ mit gleicher Zahl an Anpassungen) setzt
            // `updated_at` neu. Millisekunden, weil JS-Daten keine Mikrosekunden tragen;
            // `timestamp` ohne Zeitzone ignoriert das „Z“ der ISO-Zeit (gespeichert wird UTC).
            stand?.updatedAt
              ? sql`date_trunc('milliseconds', ${t.updatedAt}) = date_trunc('milliseconds', ${new Date(stand.updatedAt).toISOString()}::timestamp)`
              : undefined
          )
        )
        .returning();
      // Wirft innerhalb der Transaktion: nichts wird geschrieben.
      if (!z) {
        const [jetzig] = await tx.select({ status: t.status }).from(t).where(eq(t.id, id)).limit(1);
        if (stand && jetzig?.status === "entwurf") {
          throw new VersionsFehler("UNGUELTIG", "Die Kalkulation wurde gerade geändert. Bitte erneut sperren.");
        }
        throw new VersionsFehler("UNGUELTIG", "Version ist bereits gesperrt.");
      }
      if (stand?.plan5) {
        const wahl = await plan5Schreiben(tx, ws, deal, id, von, stand.plan5);
        await angebotAusVersionSchreiben(tx, deal, angebot, id, wahl);
        // Task T: eine erhaltene Kundenwahl (Paket, Tag) bekommt ihren Preis aus der neuen Version.
        if (!stand.plan5.stunden) {
          const { kundenwahlAnwenden } = await import("./kundenwahl");
          // M3: hat die Wahl des Kunden keinen Preis, nichts sperren (die Transaktion rollt
          // zurück), statt mit einem Preis zu enden, den das Portal nicht zeigt.
          if ((await kundenwahlAnwenden(tx, deal)) === "ohne_preis") throw new VersionsFehler("UNGUELTIG", OHNE_PREIS_TEXT);
        }
      } else {
        await angebotAusVersionSchreiben(tx, deal, angebot, id);
      }
      return { version: alsZeile(z), annahmeAufgehoben };
    });
  },
};

/**
 * Plan 16: Hat der Deal ein verschicktes Angebot aus einer Version? Verschickt heißt:
 * zu einer gesperrten Version gibt es ein KV-PDF (der Kunde sieht es im Portal) oder
 * einen Versandvermerk (`sent_at`).
 */
export async function istVerschickt(ws: string, deal: string): Promise<boolean> {
  const r = await db.execute(sql`
    select 1 from ${dealCalculationVersions} v
    where v.workspace_id = ${ws} and v.deal_record_id = ${deal} and v.status = 'gesperrt'
      and (v.sent_at is not null or exists (
        select 1 from deal_documents d
        where d.workspace_id = v.workspace_id and d.deal_record_id = v.deal_record_id
          and d.document_type = 'quotation' and d.calculation_version_id = v.id))
    limit 1`);
  const zeilen = (r as unknown as { rows?: unknown[] }).rows ?? (Array.isArray(r) ? (r as unknown[]) : []);
  return zeilen.length > 0;
}

/** Hebel je Paket-Slug aus den aktiven offer_packages der Firma des Deals; null ohne Firma oder Pakete. */
export async function ladePaketHebel(ws: string, deal: string): Promise<Record<string, HebelArt[]> | null> {
  const firma = await resolveDealOperatingCompany(ws, deal);
  if (!firma) return null;
  const pakete = await db
    .select({ slug: offerPackages.slug, hebel: offerPackages.hebel })
    .from(offerPackages)
    .where(
      and(eq(offerPackages.workspaceId, ws), eq(offerPackages.operatingCompanyRecordId, firma), eq(offerPackages.active, true))
    )
    .orderBy(asc(offerPackages.sortOrder));
  if (pakete.length === 0) return null;
  return Object.fromEntries(pakete.map((p) => [p.slug, p.hebel ?? []]));
}

const inCent = (eur: number) => Math.round(eur * 100);

/** M3: Die Wahl des Kunden (Paket am Tag) hat in der Version keinen Preis. */
export const OHNE_PREIS_TEXT =
  "Für die Wahl des Kunden (Paket am gewählten Tag) gibt es in dieser Version keinen Preis. Bitte den Preis mit Grund setzen oder den Tag entfernen.";

/**
 * Plan 5b, in der Sperr-Transaktion nach `angebotSperren` (nur über `tx`):
 * Paketoptionen je `catalogue_slug` aktualisieren (IDs und Kundenwahl bleiben),
 * Terminangebote je Datum anlegen oder aktualisieren, nicht mehr angebotene Tage
 * löschen. Liefert, was die Quotation bekommt: Preis und Posten der Kundenwahl,
 * solange sie angeboten ist, sonst der Standardwahl; im Stundenmodus die Stunden.
 */
async function plan5Schreiben(
  tx: Tx,
  ws: string,
  deal: string,
  versionId: string,
  von: string | null,
  p: Plan5Sperre
): Promise<AngebotAusVersion> {
  const optionen = await tx
    .select({
      id: quotationPackageOptions.id,
      slug: quotationPackageOptions.catalogueSlug,
      isRecommended: quotationPackageOptions.isRecommended,
    })
    .from(quotationPackageOptions)
    .where(and(eq(quotationPackageOptions.workspaceId, ws), eq(quotationPackageOptions.dealRecordId, deal)))
    .orderBy(asc(quotationPackageOptions.sortOrder));
  const gebunden = new Set<string>();
  for (const o of optionen) {
    const paket = o.slug ? p.preise.packagePrices.find((x) => x.slug === o.slug) : undefined;
    if (!paket || paket.festpreis === null) continue;
    gebunden.add(o.id);
    await tx
      .update(quotationPackageOptions)
      .set({ priceCents: inCent(paket.festpreis), calculationVersionId: versionId })
      .where(eq(quotationPackageOptions.id, o.id));
  }

  const vorhanden = await tx
    .select({ version: quotationDateOffers.calculationVersionId })
    .from(quotationDateOffers)
    .where(and(eq(quotationDateOffers.workspaceId, ws), eq(quotationDateOffers.dealRecordId, deal)));
  const tage = p.preise.dayPrices;
  // Ohne Tage in der Version bleiben Terminangebote ohne Preis (Altbestand) unberührt;
  // Tage einer früheren Version, die jetzt keine mehr anbietet, fallen weg.
  if (tage.length > 0 || vorhanden.some((o) => o.version !== null)) {
    const { terminangeboteSchreiben } = await import("./customer-portal-data");
    await terminangeboteSchreiben(tx, {
      workspaceId: ws,
      dealRecordId: deal,
      createdBy: von,
      calculationVersionId: versionId,
      offers: tage.map((t) => {
        const paketPreise: Record<string, number> = {};
        for (const pp of t.paketpreise ?? []) if (pp.festpreis !== null) paketPreise[pp.slug] = inCent(pp.festpreis);
        // Preis am Tag = Preis der Standardwahl an diesem Tag (empfohlenes Paket, sonst Tagespreis).
        const standard = p.standard.paketSlug !== null ? paketPreise[p.standard.paketSlug] ?? null : null;
        return {
          date: t.datum,
          slots: t.slots,
          note: t.note,
          isRecommended: t.empfohlen,
          priceCents: standard ?? (t.festpreis === null ? null : inCent(t.festpreis)),
          packagePrices: Object.keys(paketPreise).length > 0 ? paketPreise : null,
        };
      }),
    });
    // Plan 12b (E6): Buchung je Tag eingefroren, wie in `day_prices` (nie im Portal-Kontext).
    // Erst alte Werte lösen (meist keine Zeile), dann je Tag mit Buchung setzen.
    await tx
      .update(quotationDateOffers)
      .set({ vehicleBookingId: null })
      .where(
        and(
          eq(quotationDateOffers.workspaceId, ws),
          eq(quotationDateOffers.dealRecordId, deal),
          sql`${quotationDateOffers.vehicleBookingId} IS NOT NULL`
        )
      );
    for (const t of tage) {
      if (!t.vehicleBookingId) continue;
      await tx
        .update(quotationDateOffers)
        .set({ vehicleBookingId: t.vehicleBookingId })
        .where(
          and(
            eq(quotationDateOffers.workspaceId, ws),
            eq(quotationDateOffers.dealRecordId, deal),
            eq(quotationDateOffers.offerDate, t.datum),
            eq(quotationDateOffers.calculationVersionId, versionId)
          )
        );
    }
  }

  if (p.stunden) return { stunden: p.stunden };

  const [q] = await tx
    .select({ option: quotations.selectedPackageOptionId })
    .from(quotations)
    .where(eq(quotations.dealRecordId, deal))
    .limit(1);
  const [auswahl] = await tx
    .select({ datum: customerDateSelections.selectedDate })
    .from(customerDateSelections)
    .where(and(eq(customerDateSelections.workspaceId, ws), eq(customerDateSelections.dealRecordId, deal)))
    .limit(1);
  // Paket der Kundenwahl nach derselben Regel wie `kundenwahlAnwenden` und das Portal (M2, M3).
  const paketSlug =
    p.preise.packagePrices.length > 0
      ? wahlPaketSlug(
          optionen.map((o) => ({ id: o.id, isRecommended: o.isRecommended, catalogueSlug: o.slug, gebunden: gebunden.has(o.id) })),
          q?.option ?? null
        )
      : null;
  const gewaehlt = sperrWahl(p.preise, p.standard, { paketSlug, datum: auswahl?.datum ?? null });
  if (!gewaehlt) throw new VersionsFehler("UNGUELTIG", OHNE_PREIS_TEXT);
  return { fest: gewaehlt.preis };
}

/** Paketoptionen des Deals (Reihenfolge wie im Portal). */
export async function ladePaketOptionen(deal: string): Promise<PaketOption[]> {
  return db
    .select({
      id: quotationPackageOptions.id,
      catalogueSlug: quotationPackageOptions.catalogueSlug,
      isRecommended: quotationPackageOptions.isRecommended,
    })
    .from(quotationPackageOptions)
    .where(eq(quotationPackageOptions.dealRecordId, deal))
    .orderBy(asc(quotationPackageOptions.sortOrder));
}

/**
 * Feste Aufträge (Umzug im Ton jade oder gold) je Tag im Fenster und die
 * Kapazität über alle Firmen. Mehrtägige Aufträge zählen an jedem Tag im
 * Fenster. `ohneDeal` bleibt in `auftraege` und zählt in der Kapazität nicht
 * als belegt. Eine Plan-Abfrage, danach die Kapazität ohne zweites Laden.
 */
export async function ladeTagesBelegung(
  ws: string,
  von: string,
  bis: string,
  ohneDeal?: string | null,
): Promise<{ auftraege: { datum: string; dealId: string; name: string }[]; kapazitaet: KapazitaetTag[] }> {
  const { ladePlanEintraege, kapazitaetFuer } = await import("./plan");
  const { alle } = await ladePlanEintraege(ws, { von, bis, firmaId: null, mitarbeiterId: null, leads: null });
  const auftraege: { datum: string; dealId: string; name: string }[] = [];
  for (const e of alle) {
    if (!istFest(e)) continue;
    for (let t = e.tag < von ? von : e.tag; t <= e.bisTag && t <= bis; t = naechsterTag(t)) {
      auftraege.push({ datum: t, dealId: e.dealId, name: e.titel });
    }
  }
  const { kapazitaet } = await kapazitaetFuer(ws, von, bis, alle, ohneDeal);
  return { auftraege, kapazitaet };
}

const WUNSCH_EREIGNISSE = ["customer.reschedule_requested", "customer.question", "customer.damage_reported"];

/** Wunschtermine aus der neuesten Kundenanfrage im Portal (`preferredDates`), sonst leer. */
export async function ladeWunschtermine(ws: string, deal: string): Promise<string[]> {
  const zeilen = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(eq(activityEvents.workspaceId, ws), eq(activityEvents.recordId, deal), inArray(activityEvents.eventType, WUNSCH_EREIGNISSE))
    )
    .orderBy(desc(activityEvents.createdAt))
    .limit(10);
  for (const z of zeilen) {
    const daten = (z.payload as { preferredDates?: unknown } | null)?.preferredDates;
    if (Array.isArray(daten) && daten.length > 0) {
      return daten.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x));
    }
  }
  return [];
}
