/**
 * Haken des KV-Editors für neue KVs aus der Kalkulation (Route `/api/tools/run`,
 * `storeCommercialDocument`), Vertrag `KvEditorHaken` in `lib/kv-editor.ts`, Spec 7.6.
 *
 * Dazu die Datenbank-Bausteine, die auch der Dienst (`services/kv-editor.ts`) nutzt: Sperre je Deal,
 * Nummernvergabe, Stand einfügen, Kopf lesen. Bewusst ohne Import des Dienstes (der Dienst lädt
 * `commercial-documents`, das diesen Haken lädt).
 *
 * Sperrreihenfolge überall: erst `angebotSperren`, dann `kv-editor:<deal>`, nie umgekehrt.
 */
import { and, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema/auth";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { dealDocuments } from "@/db/schema/financial";
import { kvStaende, type KvStandRow, type NeuerKvStandRow } from "@/db/schema/kv-editor";
import {
  kvEditorSperrSchluessel,
  type KvAenderung,
  type KvEditorHaken,
  type KvKonflikt,
  type KvPerson,
  type KvStandKopf,
  type KvStandZumNeuenKvEingabe,
} from "@/lib/kv-editor";
import type { DbExecutor } from "@/services/einsatz-personen";
import { quotationLesen } from "@/services/quotations";

// ─── Bausteine ──────────────────────────────────────────────────────────────

/** `pg_advisory_xact_lock(hashtext('kv-editor:<deal>'))` bis zum Ende der Transaktion. */
export async function kvEditorSperren(tx: DbExecutor, deal: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${kvEditorSperrSchluessel(deal)}))`);
}

/** Neuestes `quotation`-Dokument des Deals im Workspace („aktuell“, wie Portal und Akte). */
export async function aktuellesKvDok(
  ex: DbExecutor,
  ws: string,
  deal: string
): Promise<{ id: string; fileName: string; calculationVersionId: string | null } | null> {
  const [doc] = await ex
    .select({ id: dealDocuments.id, fileName: dealDocuments.fileName, calculationVersionId: dealDocuments.calculationVersionId })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.workspaceId, ws), eq(dealDocuments.dealRecordId, deal), eq(dealDocuments.documentType, "quotation")))
    .orderBy(desc(dealDocuments.uploadedAt), desc(dealDocuments.id))
    .limit(1);
  return doc ? { ...doc, calculationVersionId: doc.calculationVersionId ?? null } : null;
}

/** Spalten ohne den PDF-Inhalt (Review 8): Listen und Prüfungen brauchen ihn nicht. */
function ohneDatei() {
  const { fileContent: _ohne, ...spalten } = getTableColumns(kvStaende);
  void _ohne;
  return spalten;
}
const ohneInhalt = (r: Omit<KvStandRow, "fileContent">): KvStandRow => ({ ...r, fileContent: null });

/** Alle Stände des Deals, neueste zuerst; ohne PDF-Inhalt (`fileContent` null, dafür `standLaden`). */
export async function staendeLaden(ex: DbExecutor, ws: string, deal: string): Promise<KvStandRow[]> {
  const rows = await ex
    .select(ohneDatei())
    .from(kvStaende)
    .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.dealRecordId, deal)))
    .orderBy(desc(kvStaende.nummer));
  return rows.map(ohneInhalt);
}

export async function standLaden(ex: DbExecutor, ws: string, deal: string, id: string): Promise<KvStandRow | null> {
  const [row] = await ex
    .select()
    .from(kvStaende)
    .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.dealRecordId, deal), eq(kvStaende.id, id)))
    .limit(1);
  return row ?? null;
}

/** Neuester Stand ohne PDF-Inhalt. */
export async function neuesterStand(ex: DbExecutor, ws: string, deal: string): Promise<KvStandRow | null> {
  const [row] = await ex
    .select(ohneDatei())
    .from(kvStaende)
    .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.dealRecordId, deal)))
    .orderBy(desc(kvStaende.nummer))
    .limit(1);
  return row ? ohneInhalt(row) : null;
}

const centAus = (x: unknown): number | null => {
  if (x === null || x === undefined || String(x).trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/**
 * Preisstand einer Quotation (Aufgabe 8, Review 1): alles, was den Preis im KV bestimmt (Festpreis,
 * nach Aufwand, Posten mit Menge und Satz, Anzahlung, gewähltes Paket, Stunden-Angebot). Gleich heißt:
 * ein früher gedrucktes PDF zeigt noch denselben Preis, auch wenn die Kalkulationsversion gleich blieb
 * (Kundenwahl im Portal, Preis von Hand, Altbestand ohne Version).
 */
export function preisStandAus(q: Awaited<ReturnType<typeof quotationLesen>>): string {
  if (!q) return "ohne-angebot";
  return JSON.stringify({
    fest: centAus(q.fixedPrice),
    aufwand: q.isVariable,
    anzahlung: q.depositRequiredCents ?? null,
    paket: q.selectedPackageSlug ?? null,
    option: q.selectedPackageOptionId ?? null,
    stunden: (q.documentDetails as { stunden?: unknown } | null)?.stunden ?? null,
    posten: q.lineItems.map((li) => [li.type, li.quantity, centAus(li.unitRate)]),
  });
}

export async function preisStandLesen(ex: DbExecutor, deal: string): Promise<string> {
  return preisStandAus(await quotationLesen(ex, deal));
}

/**
 * Fügt einen Stand mit der nächsten Nummer ein. Nimmt selbst die Sperre `kv-editor:<deal>` (in
 * derselben Transaktion ohne Wirkung, wenn sie schon gehalten wird); `ex` muss eine Transaktion sein.
 */
export async function standEinfuegen(
  tx: DbExecutor,
  werte: Omit<NeuerKvStandRow, "id" | "nummer" | "createdAt">
): Promise<KvStandRow> {
  await kvEditorSperren(tx, werte.dealRecordId);
  const [{ n }] = (await tx.execute(
    sql`select coalesce(max(nummer), 0)::int + 1 as n from kv_staende where deal_record_id = ${werte.dealRecordId}`
  )) as unknown as Array<{ n: number }>;
  const [row] = await tx
    .insert(kvStaende)
    .values({ ...werte, nummer: Number(n) })
    .returning();
  return row;
}

/** Köpfe für Verlauf und Ansicht; Namen aus `users.name`, Versionsnummer aus der Kalkulation. */
export async function koepfe(
  ex: DbExecutor,
  rows: readonly KvStandRow[],
  aktuellDokumentId: string | null
): Promise<KvStandKopf[]> {
  const nutzerIds = [...new Set(rows.flatMap((r) => [r.erstelltVon, r.gepushtVon]).filter((x): x is string => !!x))];
  const versionIds = [...new Set(rows.map((r) => r.calculationVersionId).filter((x): x is string => !!x))];
  const namen = new Map<string, string>();
  if (nutzerIds.length > 0) {
    for (const u of await ex.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, nutzerIds))) {
      namen.set(u.id, u.name);
    }
  }
  const versionen = new Map<string, number>();
  if (versionIds.length > 0) {
    for (const v of await ex
      .select({ id: dealCalculationVersions.id, version: dealCalculationVersions.version })
      .from(dealCalculationVersions)
      .where(inArray(dealCalculationVersions.id, versionIds))) {
      versionen.set(v.id, v.version);
    }
  }
  const person = (id: string | null): KvPerson | null => (id ? { id, name: namen.get(id) ?? "Unbekannt" } : null);
  return rows.map((r) => ({
    id: r.id,
    nummer: r.nummer,
    vorgaengerId: r.vorgaengerId ?? null,
    renderer: r.renderer,
    kalkulationVersion: r.calculationVersionId ? (versionen.get(r.calculationVersionId) ?? null) : null,
    quelle: r.quelle,
    status: r.status,
    fehler: r.fehler ?? null,
    aenderungen: r.aenderungen ?? [],
    offen: r.offen ?? [],
    erstelltVon: person(r.erstelltVon ?? null),
    erstelltAm: r.createdAt.toISOString(),
    gepushtVon: person(r.gepushtVon ?? null),
    gepushtAm: r.gepushtAm ? r.gepushtAm.toISOString() : null,
    aktuell: !!r.dealDocumentId && r.dealDocumentId === aktuellDokumentId,
    dealDocumentId: r.dealDocumentId ?? null,
    grundlageRekonstruiert: r.grundlageRekonstruiert,
    pruefung: r.pruefung ?? null,
  }));
}

export async function kopf(ex: DbExecutor, row: KvStandRow, aktuellDokumentId?: string | null): Promise<KvStandKopf> {
  const aktuell = aktuellDokumentId !== undefined ? aktuellDokumentId : ((await aktuellesKvDok(ex, row.workspaceId, row.dealRecordId))?.id ?? null);
  return (await koepfe(ex, [row], aktuell))[0];
}

// ─── Haken ──────────────────────────────────────────────────────────────────

/**
 * Quelle für einen neuen KV (Spec 7.6 Schritt 1, Kimi 2): nur der Stand, dessen `deal_document_id`
 * das aktuelle KV ist, nie ein ungepushter Entwurf. Filtert selbst nach Workspace (wird vor der
 * Workspace-Prüfung des Aufrufers aufgerufen); fremder Deal oder kein KV: null.
 */
export async function kvEditorBeimNeuenKv(
  ws: string,
  deal: string,
  ex: DbExecutor = db
): Promise<{ quelle: { id: string; aenderungen: KvAenderung[]; offen: KvKonflikt[] } | null }> {
  const doc = await aktuellesKvDok(ex, ws, deal);
  if (!doc) return { quelle: null };
  const [stand] = await ex
    .select({ id: kvStaende.id, aenderungen: kvStaende.aenderungen, offen: kvStaende.offen })
    .from(kvStaende)
    .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.dealRecordId, deal), eq(kvStaende.dealDocumentId, doc.id)))
    .limit(1);
  if (!stand) return { quelle: null };
  return { quelle: { id: stand.id, aenderungen: stand.aenderungen ?? [], offen: stand.offen ?? [] } };
}

/**
 * Stand zu einem neuen KV aus der Kalkulation (Spec 7.6 Schritt 3), in der Transaktion des Aufrufers:
 * VPS mit `jobAnlegen` (Ziel `aktuell`, `status druckt`, Preisprüfung `offen`), CRM mit
 * `createDealDocument` (`status fertig`, Datei). `vorgaenger_id` ist die Quelle (Push-Regel 7.6
 * Schritt 4). Quelle `neu` ohne übernommene Änderungen und ohne offene Konflikte, sonst `mitgewandert`.
 */
export async function kvEditorStandZumNeuenKv(
  ex: DbExecutor,
  ws: string,
  deal: string,
  e: KvStandZumNeuenKvEingabe
): Promise<KvStandKopf> {
  const crm = e.renderer === "crm";
  const row = await standEinfuegen(ex, {
    workspaceId: ws,
    dealRecordId: deal,
    vorgaengerId: e.quelleId,
    renderer: e.renderer,
    calculationVersionId: e.calculationVersionId,
    grundlage: e.grundlage,
    grundlageRekonstruiert: false,
    aenderungen: e.aenderungen,
    offen: e.offen,
    quelle: e.aenderungen.length > 0 || e.offen.length > 0 ? "mitgewandert" : "neu",
    status: crm ? "fertig" : "druckt",
    renderJobId: crm ? null : e.renderJobId,
    dealDocumentId: crm ? e.dealDocumentId : null,
    fileName: e.datei?.fileName ?? null,
    fileSize: e.datei?.fileSize ?? null,
    fileContent: e.datei?.fileContent ?? null,
    pruefung: e.pruefung,
    erstelltVon: e.userId,
    preisStand: await preisStandLesen(ex, deal),
  });
  return kopf(ex, row, crm ? e.dealDocumentId : undefined);
}

/** Konflikt-Zeile der Kalkulationsseite (Aufgabe 7): offene Konflikte im Stand des aktuellen KV; null ohne Stand. */
export async function kvEditorOffeneKonflikte(ws: string, deal: string): Promise<{ offeneKonflikte: number } | null> {
  const { quelle } = await kvEditorBeimNeuenKv(ws, deal);
  return quelle ? { offeneKonflikte: quelle.offen.filter((k) => k.status === "offen").length } : null;
}

const _vertrag: KvEditorHaken ={ kvEditorBeimNeuenKv, kvEditorStandZumNeuenKv };
void _vertrag;
