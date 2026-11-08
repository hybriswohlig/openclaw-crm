/**
 * Rechnung als Datensatz (Plan 9, Entscheidungen 1 bis 7). Alle drei Wege
 * (CRM-Renderer, VPS-Job, Hand-Upload) prüfen und reservieren hier in der
 * Transaktion des Aufrufers (`rechnungPruefenUndReservieren`), stellen über
 * `rechnungStellen` und laufen nach dem Commit durch `nachRechnung`.
 *
 * Wo die Quotation gelesen wird, hält der Aufrufer `angebotSperren(tx, deal)`;
 * hier läuft dann alles über `tx`, nie über die globale `db`.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dealInvoices, paymentReminders, type DealInvoiceRow } from "@/db/schema/deal-invoices";
import { belegNumberCounters } from "@/db/schema/financial";
import { attributes, objects } from "@/db/schema/objects";
import { recordValues } from "@/db/schema/records";
import { quotations } from "@/db/schema/quotations";
import { employeeTimeEntries } from "@/db/schema/employee-portal";
import { agentDrafts } from "@/db/schema/agent";
import {
  berlinTag,
  faelligAm,
  GeldFehler,
  grundGueltig,
  rechnungsNummer,
  rechnungsPruefung,
  stundenVorschlag,
  type ErinnerungStand,
  type RechnungEingabe,
  type RechnungHerkunft,
  type RechnungKurz,
  type RechnungsVorschlag,
  type RechnungZeile,
  type ZeitEintrag,
} from "@/lib/geld";
import type { StundenAngebot } from "@/lib/angebot-wahl";
import { ladeAktiveAnnahme, type DbExecutor } from "./kva-annahme";
import { ladeZahlungsregel } from "./company-settings";
import { leereRechnungFaelligAm, setRechnungFaelligAm } from "./rechnung-faellig";
import { aktualisiereWartet } from "./wartet";
import { nachZahlung } from "./nach-zahlung";
import { emitEvent } from "./activity-events";
import { angebotSperren } from "./quotations";
import {
  createDealDocument,
  dealDokumentNachlauf,
  type DealDocumentInput,
  type DealDocumentMeta,
} from "./deal-documents";

export type Tx = DbExecutor;

const AKTIV = ["entwurf", "gestellt"] as const;

function iso(d: Date | string | null): string | null {
  if (d == null) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function zeileAus(r: DealInvoiceRow): RechnungZeile {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    dealRecordId: r.dealRecordId,
    operatingCompanyId: r.operatingCompanyId,
    nummer: r.nummer,
    jahr: r.jahr,
    laufnummer: r.laufnummer,
    herkunft: r.herkunft,
    status: r.status,
    bruttoCent: r.bruttoCent,
    rechnungstag: r.rechnungstag,
    faelligAm: r.faelligAm,
    abweichungGrund: r.abweichungGrund,
    dealDocumentId: r.dealDocumentId,
    renderJobId: r.renderJobId,
    stornoGrund: r.stornoGrund,
    storniertAm: iso(r.storniertAm),
    storniertVon: r.storniertVon,
    verworfenGrund: r.verworfenGrund,
    createdBy: r.createdBy,
    createdAt: iso(r.createdAt)!,
  };
}

export function kurzAus(r: RechnungZeile, erinnerung: ErinnerungStand | null = null): RechnungKurz {
  return {
    id: r.id,
    nummer: r.nummer,
    status: r.status,
    bruttoCent: r.bruttoCent,
    rechnungstag: r.rechnungstag,
    faelligAm: r.faelligAm,
    abweichungGrund: r.abweichungGrund,
    erinnerung,
  };
}

/** Aktive Rechnung (`entwurf` oder `gestellt`) des Deals; höchstens eine. */
export async function aktiveRechnung(ws: string, deal: string, ex: DbExecutor = db): Promise<RechnungZeile | null> {
  const [row] = await ex
    .select()
    .from(dealInvoices)
    .where(
      and(
        eq(dealInvoices.workspaceId, ws),
        eq(dealInvoices.dealRecordId, deal),
        inArray(dealInvoices.status, [...AKTIV])
      )
    )
    .limit(1);
  return row ? zeileAus(row) : null;
}

/** Neuester Erinnerungsstand einer Rechnung. */
export async function erinnerungStand(invoiceId: string, ex: DbExecutor = db): Promise<ErinnerungStand | null> {
  const [row] = await ex
    .select({
      stufe: paymentReminders.stufe,
      status: paymentReminders.status,
      createdAt: paymentReminders.createdAt,
      gesendetAm: paymentReminders.gesendetAm,
    })
    .from(paymentReminders)
    .where(eq(paymentReminders.invoiceId, invoiceId))
    .orderBy(desc(paymentReminders.stufe), desc(paymentReminders.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    stufe: row.stufe,
    status: row.status,
    am: iso(row.status === "gesendet" && row.gesendetAm ? row.gesendetAm : row.createdAt)!,
  };
}

/** Stand der Quotation ohne Zeitstempel: gleich heißt, das PDF zeigt noch, was gespeichert ist. */
export function angebotsStandAus(q: { lineItems: readonly object[] } & Record<string, unknown>): string {
  const ohneZeit = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== "createdAt" && k !== "updatedAt").sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    ...ohneZeit(q),
    lineItems: q.lineItems.map((li) => ohneZeit(li as Record<string, unknown>)),
  });
}

// ─── Stand des Deals über `ex` ──────────────────────────────────────────────

interface GeldStand {
  firmaId: string | null;
  umzugstag: string | null;
  istStunden: boolean;
  festpreisCent: number | null;
  annahmeCent: number | null;
  stunden: StundenAngebot | null;
}

function centAusEuro(t: string | null | undefined): number | null {
  if (t == null || String(t).trim() === "") return null;
  const n = Number(String(t).trim());
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** `document_details.stunden` mit `quelle: "version"`, sonst null. */
export function stundenAusDetails(details: unknown): StundenAngebot | null {
  if (!details || typeof details !== "object") return null;
  const s = (details as { stunden?: unknown }).stunden as Partial<StundenAngebot> | undefined;
  if (!s || typeof s !== "object" || s.quelle !== "version") return null;
  const zahl = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const helfer = zahl(s.helfer);
  const satzHelferEur = zahl(s.satzHelferEur);
  if (helfer == null || satzHelferEur == null) return null;
  return {
    helfer,
    transporter: zahl(s.transporter) ?? 0,
    stundenGeschaetzt: zahl(s.stundenGeschaetzt) ?? 0,
    mindestStunden: zahl(s.mindestStunden) ?? 0,
    satzHelferEur,
    satzTransporterEur: zahl(s.satzTransporterEur) ?? 0,
    summeGeschaetztCent: zahl(s.summeGeschaetztCent) ?? 0,
    mindestbetragCent: zahl(s.mindestbetragCent) ?? 0,
    quelle: "version",
  };
}

async function dealWerte(ex: DbExecutor, ws: string, deal: string): Promise<{ firmaId: string | null; umzugstag: string | null }> {
  const rows = await ex
    .select({ slug: attributes.slug, ref: recordValues.referencedRecordId, tag: recordValues.dateValue })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .innerJoin(objects, eq(objects.id, attributes.objectId))
    .where(
      and(
        eq(recordValues.recordId, deal),
        eq(objects.workspaceId, ws),
        eq(objects.slug, "deals"),
        inArray(attributes.slug, ["operating_company", "move_date"])
      )
    );
  return {
    firmaId: rows.find((r) => r.slug === "operating_company" && r.ref)?.ref ?? null,
    umzugstag: rows.find((r) => r.slug === "move_date" && r.tag)?.tag ?? null,
  };
}

async function geldStand(ex: DbExecutor, ws: string, deal: string): Promise<GeldStand> {
  const [werte, [q], annahme] = await Promise.all([
    dealWerte(ex, ws, deal),
    ex
      .select({
        isVariable: quotations.isVariable,
        fixedPrice: quotations.fixedPrice,
        documentDetails: quotations.documentDetails,
      })
      .from(quotations)
      .where(eq(quotations.dealRecordId, deal))
      .limit(1),
    ladeAktiveAnnahme(deal, ex),
  ]);
  return {
    ...werte,
    istStunden: q?.isVariable ?? false,
    festpreisCent: centAusEuro(q?.fixedPrice ?? null),
    annahmeCent: annahme && annahme.workspaceId === ws ? annahme.confirmedTotalCents ?? null : null,
    stunden: q?.isVariable ? stundenAusDetails(q.documentDetails) : null,
  };
}

// ─── Prüfen, reservieren, stellen ───────────────────────────────────────────

async function naechsteLaufnummer(tx: Tx, ws: string, ocId: string, jahr: number): Promise<number> {
  const [row] = await tx
    .insert(belegNumberCounters)
    .values({ workspaceId: ws, operatingCompanyId: ocId, year: jahr, kind: "invoice", lastNumber: 1 })
    .onConflictDoUpdate({
      target: [
        belegNumberCounters.workspaceId,
        belegNumberCounters.operatingCompanyId,
        belegNumberCounters.year,
        belegNumberCounters.kind,
      ],
      set: { lastNumber: sql`${belegNumberCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: belegNumberCounters.lastNumber });
  return row.lastNumber;
}

function istAktivKonflikt(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint_name ?? e?.cause?.constraint_name;
  return code === "23505" && (!name || name === "deal_invoices_aktiv_uniq");
}

/**
 * Prüft (Entscheidung 4) und legt den Datensatz als `entwurf` an; bei CRM und
 * VPS mit Nummer aus dem Zähler derselben Transaktion. Wirft `GeldFehler`.
 */
export async function rechnungPruefenUndReservieren(
  tx: Tx,
  e: {
    ws: string;
    deal: string;
    herkunft: RechnungHerkunft;
    pdfBetragCent: number | null;
    eingabe: RechnungEingabe | null;
    durchAgent: boolean;
    userId: string | null;
    jetzt: Date;
    renderJobId?: string | null;
  }
): Promise<RechnungZeile> {
  const [stand, aktiv] = await Promise.all([geldStand(tx, e.ws, e.deal), aktiveRechnung(e.ws, e.deal, tx)]);
  const pruefung = rechnungsPruefung({
    firmaId: stand.firmaId,
    aktiveRechnung: aktiv != null,
    istStunden: stand.istStunden,
    annahmeCent: stand.annahmeCent,
    festpreisCent: stand.festpreisCent,
    pdfBetragCent: e.pdfBetragCent,
    eingabe: e.eingabe,
    durchAgent: e.durchAgent,
  });
  if (!pruefung.ok) throw new GeldFehler(pruefung.code);

  const regel = await ladeZahlungsregel(e.ws, stand.firmaId, tx);
  const rechnungstag = berlinTag(e.jetzt);
  const faellig = faelligAm({
    rechnungstag,
    umzugstag: stand.umzugstag,
    regel,
    ausdruecklich: e.eingabe?.faelligAm ?? null,
  });

  let nummer: string | null = null;
  let jahr: number | null = null;
  let laufnummer: number | null = null;
  if (e.herkunft === "crm" || e.herkunft === "vps") {
    jahr = Number(rechnungstag.slice(0, 4));
    laufnummer = await naechsteLaufnummer(tx, e.ws, stand.firmaId!, jahr);
    nummer = rechnungsNummer(jahr, laufnummer);
  }

  try {
    const [row] = await tx
      .insert(dealInvoices)
      .values({
        workspaceId: e.ws,
        dealRecordId: e.deal,
        operatingCompanyId: stand.firmaId,
        nummer,
        jahr,
        laufnummer,
        herkunft: e.herkunft,
        status: "entwurf",
        bruttoCent: pruefung.bruttoCent,
        rechnungstag,
        faelligAm: faellig,
        abweichungGrund: pruefung.abweichungGrund,
        renderJobId: e.renderJobId ?? null,
        createdBy: e.userId,
        createdAt: e.jetzt,
        updatedAt: e.jetzt,
      })
      .returning();
    return zeileAus(row);
  } catch (err) {
    if (istAktivKonflikt(err)) throw new GeldFehler("AKTIVE_RECHNUNG");
    throw err;
  }
}

/** `entwurf` → `gestellt` mit verknüpftem PDF. */
export async function rechnungStellen(tx: Tx, id: string, dealDocumentId: string): Promise<void> {
  await tx
    .update(dealInvoices)
    .set({ status: "gestellt", dealDocumentId, updatedAt: new Date() })
    .where(and(eq(dealInvoices.id, id), eq(dealInvoices.status, "entwurf")));
}

/** Nie gestellt (VPS-Fehler, verworfen): die Nummer bleibt dokumentiert. */
export async function rechnungVerwerfen(ws: string, id: string, grund: string, ex: DbExecutor = db): Promise<void> {
  await ex
    .update(dealInvoices)
    .set({ status: "verworfen", verworfenGrund: grund.slice(0, 500), updatedAt: new Date() })
    .where(and(eq(dealInvoices.workspaceId, ws), eq(dealInvoices.id, id), eq(dealInvoices.status, "entwurf")));
}

/**
 * Storno einer gestellten Rechnung (G4): Datensatz `storniert`, Fälligkeit am
 * Deal geleert, offene Erinnerungen gestoppt. Das PDF bleibt im CRM.
 */
export async function rechnungStornieren(
  ws: string,
  deal: string,
  id: string,
  grund: string,
  userId: string
): Promise<RechnungZeile> {
  const g = grundGueltig(grund);
  if (!g) throw new GeldFehler("GRUND_FEHLT");
  const jetzt = new Date();
  const ergebnis = await db.transaction(async (tx) => {
    const [vorher] = await tx
      .select()
      .from(dealInvoices)
      .where(and(eq(dealInvoices.workspaceId, ws), eq(dealInvoices.dealRecordId, deal), eq(dealInvoices.id, id)))
      .for("update")
      .limit(1);
    if (!vorher) return null;
    if (vorher.status === "storniert") throw new GeldFehler("SCHON_STORNIERT");
    if (vorher.status !== "gestellt" && vorher.status !== "entwurf") throw new GeldFehler("SCHON_STORNIERT");
    const [row] = await tx
      .update(dealInvoices)
      .set({ status: "storniert", stornoGrund: g, storniertAm: jetzt, storniertVon: userId, updatedAt: jetzt })
      .where(eq(dealInvoices.id, id))
      .returning();
    const offen = await tx
      .update(paymentReminders)
      .set({ status: "gestoppt", stoppGrund: "rechnung_storniert", updatedAt: jetzt })
      .where(and(eq(paymentReminders.invoiceId, id), eq(paymentReminders.status, "entwurf")))
      .returning({ draftId: paymentReminders.draftId });
    await entwuerfeSchliessen(tx, ws, offen.map((o) => o.draftId));
    return zeileAus(row);
  });
  if (!ergebnis) throw Object.assign(new Error("Rechnung nicht gefunden."), { status: 404 });

  await leereRechnungFaelligAm({ workspaceId: ws, dealRecordId: deal, updatedBy: userId });
  await emitEvent({
    workspaceId: ws,
    recordId: deal,
    objectSlug: "deals",
    eventType: "invoice.storniert",
    payload: { invoiceId: id, nummer: ergebnis.nummer, grund: g },
    actorId: userId,
  }).catch(() => {});
  await nachRechnung(ws, deal, userId);
  return ergebnis;
}

/** Nur die offenen Entwürfe genau dieser Erinnerungen (nicht andere Entwürfe des Deals). */
export async function entwuerfeSchliessen(ex: DbExecutor, ws: string, draftIds: (string | null)[]): Promise<number> {
  const ids = draftIds.filter((d): d is string => !!d);
  if (ids.length === 0) return 0;
  const jetzt = new Date();
  const rows = await ex
    .update(agentDrafts)
    .set({
      status: "superseded",
      reviewedAt: jetzt,
      updatedAt: jetzt,
      filterVerdicts: sql`coalesce(${agentDrafts.filterVerdicts}, '{}'::jsonb) || ${JSON.stringify({
        supersededBy: "zahlungserinnerung_gestoppt",
        supersededAt: jetzt.toISOString(),
      })}::jsonb`,
    })
    .where(and(eq(agentDrafts.workspaceId, ws), inArray(agentDrafts.id, ids), eq(agentDrafts.status, "pending")))
    .returning({ id: agentDrafts.id });
  return rows.length;
}

/** Nach dem Commit: Spiegel `rechnung_faellig_am`, Wartet, Abschluss. Fehler brechen nie. */
export async function nachRechnung(ws: string, deal: string, userId: string | null): Promise<void> {
  try {
    const aktiv = await aktiveRechnung(ws, deal);
    if (aktiv?.status === "gestellt" && aktiv.faelligAm) {
      await setRechnungFaelligAm({ workspaceId: ws, dealRecordId: deal, dueDay: aktiv.faelligAm, updatedBy: userId });
    }
  } catch (err) {
    console.error("[rechnungen] Spiegel fehlgeschlagen:", err);
  }
  try {
    await aktualisiereWartet(ws, deal);
  } catch (err) {
    console.error("[wartet] nach Rechnung fehlgeschlagen:", err);
  }
  try {
    await nachZahlung(ws, deal, userId);
  } catch (err) {
    console.error("[nach-zahlung] nach Rechnung fehlgeschlagen:", err);
  }
}

// ─── Vorschlag für den Rechnungsschritt ─────────────────────────────────────

/** `GET …/invoices/vorschlag` (Entscheidung 17). */
export async function rechnungsVorschlag(ws: string, deal: string, jetzt: Date = new Date()): Promise<RechnungsVorschlag> {
  const [stand, aktiv] = await Promise.all([geldStand(db, ws, deal), aktiveRechnung(ws, deal)]);
  const regel = await ladeZahlungsregel(ws, stand.firmaId);
  const rechnungstag = berlinTag(jetzt);
  const faellig = faelligAm({ rechnungstag, umzugstag: stand.umzugstag, regel });
  const erinnerung = aktiv ? await erinnerungStand(aktiv.id) : null;

  let stunden: RechnungsVorschlag["stunden"] = null;
  if (stand.istStunden) {
    const eintraege = await db
      .select({
        employeeId: employeeTimeEntries.employeeId,
        startAt: employeeTimeEntries.startAt,
        endAt: employeeTimeEntries.endAt,
        breakMinutes: employeeTimeEntries.breakMinutes,
        status: employeeTimeEntries.status,
      })
      .from(employeeTimeEntries)
      .where(and(eq(employeeTimeEntries.workspaceId, ws), eq(employeeTimeEntries.dealRecordId, deal)));
    stunden = stundenVorschlag({
      eintraege: eintraege.map(
        (z): ZeitEintrag => ({
          employeeId: z.employeeId,
          startAt: iso(z.startAt)!,
          endAt: iso(z.endAt),
          breakMinutes: z.breakMinutes ?? 0,
          status: z.status,
        })
      ),
      stunden: stand.stunden,
    });
  }

  const pdfBetragCent = stand.istStunden ? null : stand.festpreisCent;
  const abweichung =
    !stand.istStunden && stand.annahmeCent != null && pdfBetragCent != null && pdfBetragCent !== stand.annahmeCent;
  return {
    istStunden: stand.istStunden,
    annahmeCent: stand.annahmeCent,
    pdfBetragCent,
    bruttoCent: stand.istStunden ? stunden?.bruttoCent ?? null : pdfBetragCent ?? stand.annahmeCent,
    abweichung,
    stunden,
    faelligAm: faellig,
    aktiveRechnung: aktiv ? kurzAus(aktiv, erinnerung) : null,
    sperrgrund: !stand.firmaId ? "FIRMA_FEHLT" : aktiv ? "AKTIVE_RECHNUNG" : null,
  };
}

/** Rechnungsdatensatz zu einem PDF (Löschsperre, Portal-Filter). */
export async function rechnungZuDokument(ws: string, dealDocumentId: string): Promise<RechnungZeile | null> {
  const [row] = await db
    .select()
    .from(dealInvoices)
    .where(and(eq(dealInvoices.workspaceId, ws), eq(dealInvoices.dealDocumentId, dealDocumentId)))
    .limit(1);
  return row ? zeileAus(row) : null;
}

/** IDs der Rechnungs-PDFs eines Deals, deren Datensatz storniert ist (Portal blendet sie aus). */
export async function stornierteRechnungsDokumente(deal: string, ex: DbExecutor = db): Promise<Set<string>> {
  const rows = await ex
    .select({ id: dealInvoices.dealDocumentId })
    .from(dealInvoices)
    .where(and(eq(dealInvoices.dealRecordId, deal), eq(dealInvoices.status, "storniert")));
  return new Set(rows.map((r) => r.id).filter((x): x is string => !!x));
}

// ─── Hand-Upload (Entscheidung 6, dritter Weg) ──────────────────────────────

/**
 * Rechnungs-PDF von Hand: Datensatz `upload` ohne Nummer. Betrag aus dem Aufruf,
 * sonst Annahme oder Festpreis; Stunden-KV ohne Betrag → `STUNDEN_BETRAG_FEHLT`.
 * Eine Transaktion unter der Angebots-Sperre; Nachläufe nach dem Commit.
 */
export async function rechnungHochladen(
  dokument: DealDocumentInput,
  e: {
    bruttoCent: number | null;
    abweichungGrund: string | null;
    faelligAm: string | null;
    durchAgent: boolean;
    userId: string | null;
    jetzt?: Date;
  }
): Promise<{ document: DealDocumentMeta; rechnung: RechnungZeile }> {
  const jetzt = e.jetzt ?? new Date();
  const ergebnis = await db.transaction(async (tx) => {
    await angebotSperren(tx, dokument.dealRecordId);
    const zeile = await rechnungPruefenUndReservieren(tx, {
      ws: dokument.workspaceId,
      deal: dokument.dealRecordId,
      herkunft: "upload",
      pdfBetragCent: null,
      eingabe: { bruttoCent: e.bruttoCent, abweichungGrund: e.abweichungGrund, faelligAm: e.faelligAm },
      durchAgent: e.durchAgent,
      userId: e.userId,
      jetzt,
    });
    const document = await createDealDocument({ ...dokument, documentType: "invoice" }, tx);
    await rechnungStellen(tx, zeile.id, document.id);
    return { document, rechnung: { ...zeile, status: "gestellt" as const, dealDocumentId: document.id } };
  });
  await dealDokumentNachlauf(dokument, "invoice");
  await nachRechnung(dokument.workspaceId, dokument.dealRecordId, e.userId);
  return ergebnis;
}

/**
 * Offene Erinnerungs-Entwürfe eines Deals stoppen (Zahlung, Meldung, Storno;
 * Entscheidung 19). Nur die eigenen Entwürfe dieser Erinnerungen.
 */
export async function erinnerungenStoppen(ws: string, deal: string, grund: string): Promise<number> {
  const offen = await db
    .update(paymentReminders)
    .set({ status: "gestoppt", stoppGrund: grund, updatedAt: new Date() })
    .where(
      and(
        eq(paymentReminders.workspaceId, ws),
        eq(paymentReminders.dealRecordId, deal),
        eq(paymentReminders.status, "entwurf")
      )
    )
    .returning({ draftId: paymentReminders.draftId });
  await entwuerfeSchliessen(db, ws, offen.map((o) => o.draftId));
  return offen.length;
}
