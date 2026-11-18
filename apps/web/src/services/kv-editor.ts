/**
 * Dienst des KV-Editors (Plan Aufgabe 3, Spec 7). Vertrag `KvEditorDienst` in `lib/kv-editor.ts`.
 *
 * Ein Stand = Grundlage (Auswahl beim Erstellen) + vollständige Änderungsliste; jeder Druck baut das
 * Paket frisch aus Lead und Quotation und wendet die Liste an (`vpsPaket` bzw. `crmDruck`). Speichern
 * legt immer einen neuen Stand als Entwurf an: lesen und prüfen, Druck starten, dann EINE Transaktion
 * unter `kv-editor:<deal>` mit Neu-Prüfung (`STAND_VERALTET`), Stand und (VPS) Job mit Ziel `entwurf`.
 * Ein Entwurf landet nie in `deal_documents`; das tut nur `pushen`, unter `angebotSperren`, mit dem
 * gesehenen PDF, und hebt dort eine aktive Annahme auf (nur Admin). Ereignisse erst nach dem Commit.
 *
 * Sperrreihenfolge: `angebotSperren` vor `kv-editor:<deal>`. Netz und Renderer sind über
 * `KvEditorOptionen` austauschbar (Tests rufen nie VPS, KI oder Renderer).
 */
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents } from "@/db/schema/activity";
import { dealCalculationVersions } from "@/db/schema/deal-calculation-versions";
import { kvaConfirmations } from "@/db/schema/customer-portal";
import { kvStaende, type KvStandRow } from "@/db/schema/kv-editor";
import {
  KV_CHAT_EVENT,
  KV_EDITOR_TEXT,
  KV_FELDER_VPS_GEPRUEFT,
  type KiAntwort,
  type KonflikteAntwort,
  type KonflikteEingabe,
  type KvAblehnung,
  type KvAenderung,
  type KvAufrufer,
  type KvBasis,
  type KvChatBeitrag,
  type KvChatEingabe,
  type KvChatEreignis,
  type KvEditorAnsicht,
  type KvEditorDienst,
  type KvEditorFehler,
  type KvGrundlage,
  type KvGrundlageCrm,
  type KvGrundlageVps,
  type KvKonflikt,
  type KvPreisPruefung,
  type KvRenderer,
  type KvStandDetail,
  type KvStandKopf,
  type KvWert,
  type PushenAntwort,
  type PushenEingabe,
  type StandAnlegenEingabe,
} from "@/lib/kv-editor";
import { abgleichen, listeFortschreiben, pruefeEingabe, pushPruefung, standUnterschied } from "@/lib/kv-editor-anwenden";
import { kvNummer } from "@/lib/kv-nummer";
import { euroText } from "@/lib/anzeige";
import { KvEditorFehlerKlasse } from "./kv-editor-fehler";
import {
  aktuellesKvDok,
  koepfe,
  kopf,
  kvEditorSperren,
  neuesterStand,
  staendeLaden,
  standEinfuegen,
  standLaden,
} from "./kv-editor-haken";
import { kvChat as kiChat, kvChatVerlauf as kiVerlauf, kvKiAnrede, type KvKiQuellen } from "./kv-editor-ki";
import { aktivBedingung, annahmeAufgehobenMelden, annahmeAufhebenInTx } from "./kva-annahme";
import { angebotSperren, getQuotation } from "./quotations";
import { angebotsVersionId, createDealDocument, dealDokumentNachlauf } from "./deal-documents";
import { assertDealInWorkspace } from "./document-job-context";
import { jobAnlegen } from "./render-jobs";
import type { DbExecutor } from "./einsatz-personen";

// ─── Typen und Optionen ─────────────────────────────────────────────────────

/** VPS-Paket eines Drucks (nach `attachDocumentJobContext` mit Änderungen, `nurLesen`). */
export interface KvVpsPaket {
  /** Genau das Paket für `vpsJobStarten` (mit `_image_attachment_ids`). */
  params: Record<string, unknown>;
  /** Katalog vor den Änderungen. */
  basis: KvBasis;
  /** Umzugsgut ohne Lead-ID, nur lesend. */
  nurLesen: { name: string; raum: string | null }[];
  calculationVersionId: string | null;
  priceCents: number | null;
  kvPreise: { erwartetCent: number[]; erlaubtCent: number[] } | null;
}

/** CRM-Druck eines Stands (Modell ohne Änderungen → Basis, dann mit Änderungen gerendert). */
export interface KvCrmDruck {
  pdf: Uint8Array;
  fileName: string;
  basis: KvBasis;
  calculationVersionId: string | null;
}

export interface KvDealKopf {
  kunde: string | null;
  /** „kottke“, „ceylan“ (wie `buildDealDataForDocs`). */
  firma: string | null;
  /** Anzeigename der Betriebsfirma (für die KI). */
  firmaName: string | null;
}

/** Liste aus der frisch gelesenen Basis; darf `KvEditorFehlerKlasse` werfen (vor jedem Druck). */
type ListeAus = (basis: KvBasis) => readonly KvAenderung[];

export interface KvEditorOptionen {
  jetzt?: () => Date;
  /** Freigegebene VPS-Felder (sonst `KV_FELDER_VPS_GEPRUEFT`). */
  gepruefte?: ReadonlySet<string>;
  dealKopf?: (ws: string, deal: string) => Promise<KvDealKopf>;
  /** Grundlage eines rekonstruierten VPS-Ausgangs-Stands (Spec 7.4). */
  ausgangGrundlageVps?: (ws: string, deal: string) => Promise<KvGrundlageVps>;
  vpsPaket?: (ws: string, deal: string, grundlage: KvGrundlageVps, aenderungen: ListeAus, gepruefte: ReadonlySet<string>) => Promise<KvVpsPaket>;
  /** Startet den VPS-Job (Fotos laden, Skill starten), gibt die Job-ID zurück; wirft `VPS_FEHLER`. */
  vpsStarten?: (ws: string, deal: string, userId: string, params: Record<string, unknown>) => Promise<string>;
  crmBasis?: (ws: string, deal: string, grundlage: KvGrundlageCrm) => Promise<{ basis: KvBasis; anrede: "sie" | "du" }>;
  crmDruck?: (ws: string, deal: string, grundlage: KvGrundlageCrm, aenderungen: ListeAus) => Promise<KvCrmDruck>;
  /** Druckender VPS-Stand: Abschluss anstoßen (wie der Cron); Fehler werden geschluckt. */
  druckAnstossen?: (ws: string, vpsJobId: string) => Promise<void>;
  /** Nachläufe eines gepushten Dokuments, nach dem Commit. */
  nachPush?: (ws: string, deal: string) => Promise<void>;
  /** Ereignis „Annahme aufgehoben“, nach dem Commit. */
  annahmeGemeldet?: typeof annahmeAufgehobenMelden;
  /** KI-Quellen außer `stand` (den liefert der Dienst). */
  ki?: Partial<Omit<KvKiQuellen, "stand">>;
}

type Q = Required<Omit<KvEditorOptionen, "ki">> & { ki: KvEditorOptionen["ki"] };

function mitStandard(o: KvEditorOptionen = {}): Q {
  return {
    jetzt: () => new Date(),
    gepruefte: KV_FELDER_VPS_GEPRUEFT,
    dealKopf: dealKopfStandard,
    ausgangGrundlageVps: ausgangGrundlageVpsStandard,
    vpsPaket: vpsPaketStandard,
    vpsStarten: vpsStartenStandard,
    crmBasis: crmBasisStandard,
    crmDruck: crmDruckStandard,
    druckAnstossen: async (ws, jobId) => {
      const { kvJobAbschliessen } = await import("./kv-job-abschluss");
      await kvJobAbschliessen(ws, jobId);
    },
    nachPush: (ws, deal) => dealDokumentNachlauf({ workspaceId: ws, dealRecordId: deal, notifyCustomer: false }, "quotation"),
    annahmeGemeldet: annahmeAufgehobenMelden,
    ...o,
    ki: o.ki,
  } as Q;
}

const fehler = <C extends KvEditorFehler>(code: C, message?: string, daten?: ConstructorParameters<typeof KvEditorFehlerKlasse<C>>[2]) =>
  new KvEditorFehlerKlasse(code, message ?? KV_EDITOR_TEXT[code], daten);

const ungueltig = (abgelehnt: { schluessel: string | null; grund: KvAblehnung }[], message?: string) =>
  fehler("UNGUELTIG", message, { abgelehnt });

async function dealPruefen(ws: string, deal: string): Promise<void> {
  if (!(await assertDealInWorkspace(ws, deal))) throw fehler("KEIN_KV", "Auftrag nicht gefunden.");
}

async function standOderFehler(ex: DbExecutor, ws: string, deal: string, id: string): Promise<KvStandRow> {
  const row = typeof id === "string" && id ? await standLaden(ex, ws, deal, id) : null;
  if (!row) throw fehler("KEIN_KV", "Stand nicht gefunden.");
  return row;
}

async function versionNummer(ex: DbExecutor, id: string | null): Promise<number | null> {
  if (!id) return null;
  const [v] = await ex
    .select({ version: dealCalculationVersions.version })
    .from(dealCalculationVersions)
    .where(eq(dealCalculationVersions.id, id))
    .limit(1);
  return v?.version ?? null;
}

async function aktiveAnnahme(ex: DbExecutor, ws: string, deal: string) {
  const [a] = await ex
    .select({ id: kvaConfirmations.id, signedAt: kvaConfirmations.signedAt, quotationDocumentId: kvaConfirmations.quotationDocumentId })
    .from(kvaConfirmations)
    .where(aktivBedingung(deal, ws))
    .limit(1);
  return a ?? null;
}

const nummerZuDokument = (rows: readonly KvStandRow[], dokId: string | null | undefined) =>
  dokId ? (rows.find((r) => r.dealDocumentId === dokId)?.nummer ?? null) : null;

// ─── Ansicht ────────────────────────────────────────────────────────────────

/**
 * Spec 7.4: Hat der Deal ein KV-Dokument, aber keinen Stand, entsteht unter der Sperre und nach
 * erneutem Lesen genau ein „Stand 1, Ausgangs-KV“ (auch bei parallelen Erstaufrufen).
 */
async function ausgangSicherstellen(ws: string, deal: string, firma: string | null, q: Q): Promise<void> {
  const doc0 = await aktuellesKvDok(db, ws, deal);
  if (!doc0 || (await neuesterStand(db, ws, deal))) return;
  const rendererFuer = (fileName: string): KvRenderer => (firma === "kottke" || kvNummer(fileName) ? "vps" : "crm");
  const vpsGrundlage = rendererFuer(doc0.fileName) === "vps" ? await q.ausgangGrundlageVps(ws, deal) : null;

  await db.transaction(async (tx) => {
    await kvEditorSperren(tx, deal);
    if (await neuesterStand(tx, ws, deal)) return;
    const doc = await aktuellesKvDok(tx, ws, deal);
    if (!doc) return;
    const [datei] = (await tx.execute(
      sql`select file_name, file_size, file_content from deal_documents where id = ${doc.id}`
    )) as unknown as Array<{ file_name: string; file_size: number; file_content: string }>;
    const renderer = rendererFuer(doc.fileName);
    const grundlage: KvGrundlage = renderer === "vps" ? (vpsGrundlage ?? { bildIds: [] }) : { copy: {} };
    await standEinfuegen(tx, {
      workspaceId: ws,
      dealRecordId: deal,
      vorgaengerId: null,
      renderer,
      calculationVersionId: doc.calculationVersionId,
      grundlage,
      grundlageRekonstruiert: true,
      aenderungen: [],
      offen: [],
      quelle: "ausgang",
      status: "fertig",
      dealDocumentId: doc.id,
      fileName: datei?.file_name ?? doc.fileName,
      fileSize: datei?.file_size ?? null,
      fileContent: datei?.file_content ?? null,
      pruefung: null,
      erstelltVon: null,
    });
  });
}

function preisText(quotation: Awaited<ReturnType<typeof getQuotation>>, version: number | null): string {
  const aus = version ? ` aus Kalkulation v${version}` : " aus der Kalkulation";
  if (!quotation) return "Preis aus der Kalkulation";
  if (quotation.isVariable) return `Preis nach Aufwand${aus}`;
  const n = Number(quotation.fixedPrice);
  if (quotation.fixedPrice && Number.isFinite(n)) return `Gesamtpreis ${euroText(Math.round(n * 100))}${aus}`;
  return `Preis${aus}`;
}

export async function ansicht(ws: string, deal: string, wer: KvAufrufer, o?: KvEditorOptionen): Promise<KvEditorAnsicht> {
  const q = mitStandard(o);
  await dealPruefen(ws, deal);
  const dk = await q.dealKopf(ws, deal);
  await ausgangSicherstellen(ws, deal, dk.firma, q);

  const [rows, doc, annahme, quotation] = await Promise.all([
    staendeLaden(db, ws, deal),
    aktuellesKvDok(db, ws, deal),
    aktiveAnnahme(db, ws, deal),
    getQuotation(deal),
  ]);
  const staende = await koepfe(db, rows, doc?.id ?? null);
  const aktuellStand = staende.find((s) => s.aktuell) ?? null;
  const neuester = staende[0] ?? null;
  const quotationVersionId = quotation?.calculationVersionId ?? null;
  const kalkulationVersion = await versionNummer(db, quotationVersionId);
  const hinweis: KvEditorAnsicht["hinweis"] = !doc
    ? "kein_kv"
    : !aktuellStand && rows.length > 0
      ? "quelle_ohne_stand"
      : neuester?.quelle === "ausgang" && neuester.grundlageRekonstruiert
        ? "rekonstruiert"
        : null;
  return {
    dealId: deal,
    kunde: dk.kunde,
    firma: dk.firma,
    staende,
    aktuellStandId: aktuellStand?.id ?? null,
    aktuellDokumentId: doc?.id ?? null,
    quotationVersionId,
    kalkulationVersion,
    annahme: {
      aktiv: !!annahme,
      am: annahme?.signedAt ? annahme.signedAt.toISOString() : null,
      standNummer: nummerZuDokument(rows, annahme?.quotationDocumentId),
      aufhebenErlaubt: wer.admin === true,
    },
    preis: { text: preisText(quotation, kalkulationVersion), kalkulationUrl: `/app/leads/${encodeURIComponent(deal)}/kalkulation` },
    hinweis,
    offeneKonflikte: (neuester ?? aktuellStand)?.offen.filter((k) => k.status === "offen").length ?? 0,
  };
}

// ─── Stand lesen ────────────────────────────────────────────────────────────

interface StandIntern {
  detail: KvStandDetail;
  anrede: "sie" | "du";
}

async function basisLesen(
  ws: string,
  deal: string,
  row: KvStandRow,
  q: Q
): Promise<{ basis: KvBasis; nurLesen: KvStandDetail["nurLesen"]; anrede: "sie" | "du" }> {
  try {
    if (row.renderer === "vps") {
      const p = await q.vpsPaket(ws, deal, row.grundlage as KvGrundlageVps, () => [], q.gepruefte);
      return { basis: p.basis, nurLesen: p.nurLesen, anrede: kvKiAnrede("vps") };
    }
    const c = await q.crmBasis(ws, deal, row.grundlage as KvGrundlageCrm);
    return { basis: c.basis, nurLesen: undefined, anrede: c.anrede };
  } catch (err) {
    // Fehlen Angaben am Lead, bleibt der Stand lesbar (PDF, Verlauf), nur ohne Formular.
    if (err instanceof KvEditorFehlerKlasse && err.code === "ANGABEN_FEHLEN") {
      return { basis: { renderer: row.renderer, felder: [] }, nurLesen: undefined, anrede: kvKiAnrede(row.renderer) };
    }
    throw err;
  }
}

async function standIntern(ws: string, deal: string, standId: string, q: Q): Promise<StandIntern> {
  await dealPruefen(ws, deal);
  let row = await standOderFehler(db, ws, deal, standId);
  if (row.status === "druckt" && row.renderJobId) {
    // Entwurf-Jobs schließt sonst der Cron ab; die Abfrage des Browsers darf ihn anstoßen.
    await q.druckAnstossen(ws, row.renderJobId).catch((err) => console.error("[kv-editor] Druck anstoßen", err));
    row = await standOderFehler(db, ws, deal, standId);
  }
  const [b, vorgaenger, k] = await Promise.all([
    basisLesen(ws, deal, row, q),
    row.vorgaengerId ? standLaden(db, ws, deal, row.vorgaengerId) : Promise.resolve(null),
    kopf(db, row),
  ]);
  const werte: Record<string, KvWert> = Object.fromEntries(b.basis.felder.map((f) => [f.schluessel, f.basis]));
  for (const a of row.aenderungen ?? []) if (a.schluessel in werte) werte[a.schluessel] = a.wert;
  const detail: KvStandDetail = {
    ...k,
    basis: b.basis,
    werte,
    unterschied: standUnterschied(b.basis, vorgaenger?.aenderungen ?? [], row.aenderungen ?? []),
    ...(b.nurLesen && b.nurLesen.length > 0 ? { nurLesen: b.nurLesen } : {}),
  };
  return { detail, anrede: b.anrede };
}

export async function standLesen(ws: string, deal: string, standId: string, o?: KvEditorOptionen): Promise<KvStandDetail> {
  return (await standIntern(ws, deal, standId, mitStandard(o))).detail;
}

/**
 * Schlanker Weg für die 5-s-Abfrage druckender Stände: nur Kopf und Status (ohne PDF-Inhalt,
 * ohne Basis, ohne Lead- und Quotation-Lesen). Ein druckender VPS-Stand stößt wie `standLesen`
 * seinen Abschluss an. Das volle Detail lädt die Oberfläche einmal, wenn der Druck endet.
 * Der Deal ist in der Route schon geprüft; `standLaden` filtert zusätzlich nach Workspace und Deal.
 */
export async function standKopfLesen(ws: string, deal: string, standId: string, o?: KvEditorOptionen): Promise<KvStandKopf> {
  const q = mitStandard(o);
  const lesen = async (): Promise<KvStandRow> => {
    const { fileContent: _ohne, ...spalten } = getTableColumns(kvStaende);
    void _ohne;
    const [row] =
      typeof standId === "string" && standId
        ? await db
            .select(spalten)
            .from(kvStaende)
            .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.dealRecordId, deal), eq(kvStaende.id, standId)))
            .limit(1)
        : [];
    if (!row) throw fehler("KEIN_KV", "Stand nicht gefunden.");
    return { ...row, fileContent: null };
  };
  let row = await lesen();
  if (row.status === "druckt" && row.renderJobId) {
    await q.druckAnstossen(ws, row.renderJobId).catch((err) => console.error("[kv-editor] Druck anstoßen", err));
    row = await lesen();
  }
  return kopf(db, row);
}

export async function standPdf(
  ws: string,
  deal: string,
  standId: string
): Promise<{ fileName: string; mimeType: string; bytes: Buffer } | null> {
  await dealPruefen(ws, deal);
  const row = await standOderFehler(db, ws, deal, standId);
  if (!row.fileContent) return null;
  return { fileName: row.fileName || `KV-Stand-${row.nummer}.pdf`, mimeType: "application/pdf", bytes: Buffer.from(row.fileContent, "base64") };
}

// ─── Entwurf drucken (gemeinsam für Speichern, Neu drucken, Übertragen, Übernehmen) ─────

interface EntwurfEingabe {
  renderer: KvRenderer;
  grundlage: KvGrundlage;
  grundlageRekonstruiert: boolean;
  /** Muss beim Einfügen noch der neueste Stand sein (sonst `STAND_VERALTET`). */
  vorgaengerId: string | null;
  /** Liste und offene Konflikte aus der frisch gelesenen Basis; darf werfen. */
  liste: (basis: KvBasis) => { liste: KvAenderung[]; offen: KvKonflikt[] };
  quelle: "hand" | "ki";
  kiNachrichtId: string | null;
  userId: string;
  /** Zusätzliche Schritte in derselben Transaktion (Konflikt-Entscheidungen). */
  imTx?: (tx: DbExecutor, stand: KvStandRow) => Promise<void>;
}

function istEindeutigVerletzt(err: unknown, index: string): boolean {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown } | null;
  if (!e) return false;
  if (e.code === "23505" && (e.constraint_name === index || e.constraint === index)) return true;
  return e.cause ? istEindeutigVerletzt(e.cause, index) : false;
}

const SCHON_UEBERNOMMEN = "Dieser Vorschlag wurde schon übernommen.";

async function entwurfDrucken(ws: string, deal: string, e: EntwurfEingabe, q: Q): Promise<KvStandKopf> {
  let ergebnis: { liste: KvAenderung[]; offen: KvKonflikt[] } | null = null;
  const listeAus: ListeAus = (basis) => {
    ergebnis = e.liste(basis);
    return ergebnis.liste;
  };

  // 1 und 2: lesen, prüfen, Druck starten (VPS noch ohne Register; CRM synchron).
  let druck:
    | { art: "vps"; jobId: string; paket: KvVpsPaket; pruefung: KvPreisPruefung | null }
    | { art: "crm"; d: KvCrmDruck };
  if (e.renderer === "vps") {
    const paket = await q.vpsPaket(ws, deal, e.grundlage as KvGrundlageVps, listeAus, q.gepruefte);
    if (!ergebnis) listeAus(paket.basis);
    const jobId = await q.vpsStarten(ws, deal, e.userId, paket.params);
    druck = {
      art: "vps",
      jobId,
      paket,
      pruefung: paket.kvPreise ? { ...paket.kvPreise, preis: "offen", fehlt: [], fremd: [] } : null,
    };
  } else {
    const d = await q.crmDruck(ws, deal, e.grundlage as KvGrundlageCrm, listeAus);
    if (!ergebnis) listeAus(d.basis);
    druck = { art: "crm", d };
  }
  const { liste, offen } = ergebnis as unknown as { liste: KvAenderung[]; offen: KvKonflikt[] };

  // 3: eine Transaktion; der Cron sieht den Job erst nach dem Commit. Ist der Vorgänger nicht mehr
  // der neueste Stand, bleibt ein schon gestarteter VPS-Job unregistriert und wird nie abgelegt.
  try {
    return await db.transaction(async (tx) => {
      await kvEditorSperren(tx, deal);
      const neu = await neuesterStand(tx, ws, deal);
      if ((neu?.id ?? null) !== e.vorgaengerId) {
        throw fehler("STAND_VERALTET", undefined, neu ? { neuester: await kopf(tx, neu) } : undefined);
      }
      const row = await standEinfuegen(tx, {
        workspaceId: ws,
        dealRecordId: deal,
        vorgaengerId: e.vorgaengerId,
        renderer: e.renderer,
        grundlage: e.grundlage,
        grundlageRekonstruiert: e.grundlageRekonstruiert,
        aenderungen: liste,
        offen,
        quelle: e.quelle,
        kiNachrichtId: e.kiNachrichtId,
        erstelltVon: e.userId,
        ...(druck.art === "vps"
          ? {
              calculationVersionId: druck.paket.calculationVersionId,
              status: "druckt" as const,
              renderJobId: druck.jobId,
              pruefung: druck.pruefung,
            }
          : {
              calculationVersionId: druck.d.calculationVersionId,
              status: "fertig" as const,
              fileName: druck.d.fileName,
              fileSize: druck.d.pdf.byteLength,
              fileContent: Buffer.from(druck.d.pdf).toString("base64"),
              pruefung: null,
            }),
      });
      if (druck.art === "vps") {
        await jobAnlegen(
          {
            vpsJobId: druck.jobId,
            workspaceId: ws,
            dealRecordId: deal,
            documentType: "quotation",
            calculationVersionId: druck.paket.calculationVersionId,
            priceCents: druck.paket.priceCents,
            createdBy: e.userId,
            invoiceId: null,
            kvStandId: row.id,
            kvStandZiel: "entwurf",
          },
          tx
        );
      }
      if (e.imTx) await e.imTx(tx, row);
      return kopf(tx, row);
    });
  } catch (err) {
    if (istEindeutigVerletzt(err, "kv_staende_ki_nachricht_uq")) {
      throw ungueltig([{ schluessel: null, grund: "NICHT_VORGESCHLAGEN" }], SCHON_UEBERNOMMEN);
    }
    throw err;
  }
}

/** Gleich für den Vergleich mit einem KI-Vorschlag: Text getrimmt wie `pruefeEingabe`. */
const vergleichswert = (w: unknown) => (typeof w === "string" ? w.trim() : w);

/**
 * KI-Herkunft (Spec 7.2, Kimi 17): das Ereignis gehört zu Workspace und Deal, stammt von der KI, ist
 * zu einem Stand dieses Deals entstanden, wurde noch nicht übernommen, und jedes `setzen` gleicht einem
 * Vorschlag daraus. Zurücksetzen gehört nicht zu einem KI-Vorschlag.
 */
async function kiHerkunftPruefen(ws: string, deal: string, e: StandAnlegenEingabe): Promise<void> {
  const id = e.kiNachrichtId!;
  const [ev] = await db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.id, id),
        eq(activityEvents.workspaceId, ws),
        eq(activityEvents.recordId, deal),
        eq(activityEvents.eventType, KV_CHAT_EVENT)
      )
    )
    .limit(1);
  const p = (ev?.payload ?? null) as Partial<KvChatEreignis> | null;
  if (!p || p.rolle !== "ki" || typeof p.standId !== "string" || !(await standLaden(db, ws, deal, p.standId))) {
    throw ungueltig([{ schluessel: null, grund: "NICHT_VORGESCHLAGEN" }], KV_EDITOR_TEXT.NICHT_VORGESCHLAGEN);
  }
  const [schon] = await db.select({ id: kvStaende.id }).from(kvStaende).where(eq(kvStaende.kiNachrichtId, id)).limit(1);
  if (schon) throw ungueltig([{ schluessel: null, grund: "NICHT_VORGESCHLAGEN" }], SCHON_UEBERNOMMEN);

  const vorschlaege = new Map((Array.isArray(p.vorschlaege) ? p.vorschlaege : []).map((v) => [v.schluessel, vergleichswert(v.wert)]));
  const abgelehnt: { schluessel: string | null; grund: KvAblehnung }[] = [];
  for (const s of e.setzen) {
    if (!vorschlaege.has(s.schluessel) || vorschlaege.get(s.schluessel) !== vergleichswert(s.wert)) {
      abgelehnt.push({ schluessel: s.schluessel, grund: "NICHT_VORGESCHLAGEN" });
    }
  }
  for (const s of e.zuruecksetzen) abgelehnt.push({ schluessel: s, grund: "NICHT_VORGESCHLAGEN" });
  if (abgelehnt.length > 0) throw ungueltig(abgelehnt);
}

function eingabePruefen(e: StandAnlegenEingabe): void {
  const ok =
    e &&
    typeof e.vorgaengerId === "string" &&
    Array.isArray(e.setzen) &&
    e.setzen.every((s) => s && typeof s.schluessel === "string") &&
    Array.isArray(e.zuruecksetzen) &&
    e.zuruecksetzen.every((s) => typeof s === "string") &&
    (e.kiNachrichtId === undefined || e.kiNachrichtId === null || typeof e.kiNachrichtId === "string");
  if (!ok) throw ungueltig([], "Eingabe unvollständig.");
}

/** Offene Konflikte auf Feldern, die der Nutzer gerade selbst setzt oder zurücksetzt, sind damit entschieden. */
function offenNachEingabe(offen: readonly KvKonflikt[], schluessel: ReadonlySet<string>, von: string, am: string): KvKonflikt[] {
  return offen.map((k) =>
    k.status === "offen" && schluessel.has(k.aenderung.schluessel) ? { ...k, status: "verworfen", entschiedenVon: von, entschiedenAm: am } : { ...k }
  );
}

export async function standAnlegen(
  ws: string,
  deal: string,
  e: StandAnlegenEingabe,
  userId: string,
  o?: KvEditorOptionen
): Promise<KvStandKopf> {
  const q = mitStandard(o);
  eingabePruefen(e);
  await dealPruefen(ws, deal);
  const vorgaenger = await standOderFehler(db, ws, deal, e.vorgaengerId);
  // Früh prüfen, damit kein VPS-Job für einen veralteten Stand startet; endgültig in der Transaktion.
  const neu = await neuesterStand(db, ws, deal);
  if (neu && neu.id !== vorgaenger.id) throw fehler("STAND_VERALTET", undefined, { neuester: await kopf(db, neu) });
  const ki = typeof e.kiNachrichtId === "string" && e.kiNachrichtId !== "";
  if (ki) await kiHerkunftPruefen(ws, deal, e);
  const quelle = ki ? ("ki" as const) : ("hand" as const);
  const am = q.jetzt().toISOString();
  const beruehrt = new Set([...e.setzen.map((s) => s.schluessel), ...e.zuruecksetzen]);

  return entwurfDrucken(
    ws,
    deal,
    {
      renderer: vorgaenger.renderer,
      grundlage: vorgaenger.grundlage,
      grundlageRekonstruiert: vorgaenger.grundlageRekonstruiert,
      vorgaengerId: vorgaenger.id,
      liste: (basis) => {
        const p = pruefeEingabe(basis, e.setzen);
        if (p.abgelehnt.length > 0) throw ungueltig(p.abgelehnt);
        return {
          liste: listeFortschreiben(vorgaenger.aenderungen ?? [], p.ok, e.zuruecksetzen, { quelle, von: userId, am }),
          offen: offenNachEingabe(vorgaenger.offen ?? [], beruehrt, userId, am),
        };
      },
      quelle,
      kiNachrichtId: ki ? e.kiNachrichtId! : null,
      userId,
    },
    q
  );
}

/** Kimi 21: „Neu drucken“ legt einen neuen Stand mit derselben Liste und Grundlage an (eigener Druck). */
export async function neuDrucken(ws: string, deal: string, standId: string, userId: string, o?: KvEditorOptionen): Promise<KvStandKopf> {
  const q = mitStandard(o);
  await dealPruefen(ws, deal);
  const s = await standOderFehler(db, ws, deal, standId);
  const neu = await neuesterStand(db, ws, deal);
  return entwurfDrucken(
    ws,
    deal,
    {
      renderer: s.renderer,
      grundlage: s.grundlage,
      grundlageRekonstruiert: s.grundlageRekonstruiert,
      vorgaengerId: neu?.id ?? null,
      liste: (basis) => {
        const a = abgleichen(basis, s.aenderungen ?? [], s.offen ?? []);
        return { liste: a.liste, offen: a.konflikte };
      },
      quelle: s.quelle === "ki" ? "ki" : "hand",
      kiNachrichtId: null,
      userId,
    },
    q
  );
}

/**
 * `KALKULATION_NEU` und Hinweis `quelle_ohne_stand`: die Liste dieses Stands auf den aktuellen KV legen
 * (Grundlage und Renderer des aktuellen KV, wenn er einen Stand hat). Neuer Entwurf, nicht passende
 * Änderungen werden Konflikte.
 */
export async function uebertragen(ws: string, deal: string, standId: string, userId: string, o?: KvEditorOptionen): Promise<KvStandKopf> {
  const q = mitStandard(o);
  await dealPruefen(ws, deal);
  const s = await standOderFehler(db, ws, deal, standId);
  const doc = await aktuellesKvDok(db, ws, deal);
  if (!doc) throw fehler("KEIN_KV");
  const rows = await staendeLaden(db, ws, deal);
  const ziel = rows.find((r) => r.dealDocumentId === doc.id) ?? s;
  return entwurfDrucken(
    ws,
    deal,
    {
      renderer: ziel.renderer,
      grundlage: ziel.grundlage,
      grundlageRekonstruiert: ziel.grundlageRekonstruiert,
      vorgaengerId: rows[0]?.id ?? null,
      liste: (basis) => {
        const a = abgleichen(basis, s.aenderungen ?? [], s.offen ?? []);
        return { liste: a.liste, offen: a.konflikte };
      },
      quelle: "hand",
      kiNachrichtId: null,
      userId,
    },
    q
  );
}

// ─── Konflikte ──────────────────────────────────────────────────────────────

/**
 * Spec 7.6 Schritt 5: Entscheidungen schreiben `offen[].status` unter der Sperre, in jedem Stand des
 * Deals, der den Konflikt offen trägt (damit er beim nächsten Mitwandern nicht wiederkommt).
 * „übernehmen“ (nur `basis_geaendert`) legt einen Entwurf auf dem neuesten Stand an.
 */
export async function konflikteEntscheiden(
  ws: string,
  deal: string,
  e: KonflikteEingabe,
  userId: string,
  o?: KvEditorOptionen
): Promise<KonflikteAntwort> {
  const q = mitStandard(o);
  if (!e || typeof e.standId !== "string" || !Array.isArray(e.entscheidungen) || e.entscheidungen.length === 0) {
    throw ungueltig([], "Keine Entscheidung übergeben.");
  }
  await dealPruefen(ws, deal);
  const stand = await standOderFehler(db, ws, deal, e.standId);
  const abgelehnt: { schluessel: string | null; grund: KvAblehnung }[] = [];
  const gewaehlt = new Map<string, "uebernehmen" | "verwerfen">();
  const uebernehmen: KvKonflikt[] = [];
  for (const d of e.entscheidungen) {
    const k = (stand.offen ?? []).find((x) => x.status === "offen" && x.aenderung.schluessel === d?.schluessel);
    if (!k || (d.aktion !== "uebernehmen" && d.aktion !== "verwerfen") || (d.aktion === "uebernehmen" && k.art !== "basis_geaendert")) {
      abgelehnt.push({ schluessel: typeof d?.schluessel === "string" ? d.schluessel : null, grund: "UNBEKANNT" });
      continue;
    }
    gewaehlt.set(d.schluessel, d.aktion);
    if (d.aktion === "uebernehmen") uebernehmen.push(k);
  }
  if (abgelehnt.length > 0) throw ungueltig(abgelehnt);
  const am = q.jetzt().toISOString();
  const entscheide = (offen: readonly KvKonflikt[]): KvKonflikt[] =>
    offen.map((k) => {
      const a = k.status === "offen" ? gewaehlt.get(k.aenderung.schluessel) : undefined;
      return a ? { ...k, status: a === "uebernehmen" ? "uebernommen" : "verworfen", entschiedenVon: userId, entschiedenAm: am } : { ...k };
    });
  const entscheidenInTx = async (tx: DbExecutor) => {
    for (const r of await staendeLaden(tx, ws, deal)) {
      if (!(r.offen ?? []).some((k) => k.status === "offen" && gewaehlt.has(k.aenderung.schluessel))) continue;
      await tx.update(kvStaende).set({ offen: entscheide(r.offen ?? []) }).where(eq(kvStaende.id, r.id));
    }
  };

  let neuerEntwurf: KvStandKopf | null = null;
  if (uebernehmen.length === 0) {
    await db.transaction(async (tx) => {
      await kvEditorSperren(tx, deal);
      await entscheidenInTx(tx);
    });
  } else {
    const neu = (await neuesterStand(db, ws, deal))!;
    neuerEntwurf = await entwurfDrucken(
      ws,
      deal,
      {
        renderer: neu.renderer,
        grundlage: neu.grundlage,
        grundlageRekonstruiert: neu.grundlageRekonstruiert,
        vorgaengerId: neu.id,
        liste: (basis) => {
          const p = pruefeEingabe(
            basis,
            uebernehmen.map((k) => ({ schluessel: k.aenderung.schluessel, wert: k.aenderung.wert }))
          );
          if (p.abgelehnt.length > 0) throw ungueltig(p.abgelehnt);
          return {
            liste: listeFortschreiben(neu.aenderungen ?? [], p.ok, [], { quelle: "hand", von: userId, am }),
            offen: entscheide(neu.offen ?? []),
          };
        },
        quelle: "hand",
        kiNachrichtId: null,
        userId,
        imTx: (tx) => entscheidenInTx(tx),
      },
      q
    );
  }
  return { stand: await kopf(db, await standOderFehler(db, ws, deal, e.standId)), neuerEntwurf };
}

// ─── Pushen ─────────────────────────────────────────────────────────────────

/**
 * Spec 7.5: eine Transaktion unter `angebotSperren`, dann `kv-editor:<deal>`; `pushPruefung`; Annahme
 * aufheben (nur Admin, mit Bestätigung); das gesehene PDF als neues `quotation`-Dokument mit der
 * Kalkulationsversion des Stands. Nachläufe und Ereignis nach dem Commit. Push druckt nie neu.
 */
export async function pushen(
  ws: string,
  deal: string,
  standId: string,
  e: PushenEingabe,
  wer: KvAufrufer,
  o?: KvEditorOptionen
): Promise<PushenAntwort> {
  const q = mitStandard(o);
  await dealPruefen(ws, deal);
  const bestaetigt = e?.annahmeAufhebenBestaetigt === true;
  // Zweite Prüfung zur Route (Kimi 9): Bestätigen darf nur ein Admin.
  if (bestaetigt && !wer.admin) throw fehler("NUR_ADMIN");

  const r = await db.transaction(async (tx) => {
    await angebotSperren(tx, deal);
    await kvEditorSperren(tx, deal);
    const row = await standOderFehler(tx, ws, deal, standId);
    const [doc, quotationVersionId, annahme] = [
      await aktuellesKvDok(tx, ws, deal),
      await angebotsVersionId(deal, tx),
      await aktiveAnnahme(tx, ws, deal),
    ];
    const pruef = pushPruefung({
      status: row.status,
      standVersionId: row.calculationVersionId ?? null,
      quotationVersionId,
      aktuellDokumentId: doc?.id ?? null,
      erwartetAktuellDokumentId: e?.erwartetAktuellDokumentId ?? null,
      schonGepusht: !!row.dealDocumentId || !!row.gepushtAm,
      annahmeAktiv: !!annahme,
      annahmeAufhebenBestaetigt: bestaetigt,
      admin: wer.admin === true,
      // Ein schon abgelegter Stand (Ausgang, KV aus der Kalkulation) scheitert an „schon gepusht“, nicht am Preis.
      preisOk: row.renderer === "crm" || row.pruefung?.preis === "ok" || !!row.dealDocumentId,
    });
    if (!pruef.ok) {
      const rows = await staendeLaden(tx, ws, deal);
      switch (pruef.fehler) {
        case "STAND_NICHT_FERTIG":
          throw fehler("STAND_NICHT_FERTIG", undefined, { status: row.status });
        case "UNGUELTIG":
          throw ungueltig([], "Dieser Stand ist schon gepusht. Für einen älteren Stand erst einen neuen Entwurf anlegen.");
        case "AKTUELL_GEAENDERT": {
          const akt = rows.find((x) => !!doc && x.dealDocumentId === doc.id) ?? null;
          const k = akt ? await kopf(tx, akt, doc?.id ?? null) : null;
          throw fehler("AKTUELL_GEAENDERT", undefined, { aktuellStandNummer: k?.nummer ?? null, gepushtVon: k?.gepushtVon?.name ?? null });
        }
        case "KALKULATION_NEU":
          throw fehler("KALKULATION_NEU", undefined, { kalkulationVersion: await versionNummer(tx, quotationVersionId) });
        case "ANNAHME_AKTIV":
          throw fehler("ANNAHME_AKTIV", undefined, {
            am: annahme?.signedAt ? annahme.signedAt.toISOString() : null,
            standNummer: nummerZuDokument(rows, annahme?.quotationDocumentId),
          });
        default:
          throw fehler(pruef.fehler);
      }
    }
    if (!row.fileContent || !row.fileName) throw fehler("STAND_NICHT_FERTIG", undefined, { status: row.status });

    const aufhebung = { workspaceId: ws, dealRecordId: deal, userId: wer.userId, grund: `KV geändert, Stand ${row.nummer}` };
    const aufgehoben = pruef.annahmeAufheben ? await annahmeAufhebenInTx(tx, aufhebung) : null;
    const dokument = await createDealDocument(
      {
        workspaceId: ws,
        dealRecordId: deal,
        documentType: "quotation",
        fileName: row.fileName,
        fileSize: row.fileSize ?? Buffer.from(row.fileContent, "base64").byteLength,
        mimeType: "application/pdf",
        fileContent: row.fileContent,
        calculationVersionId: row.calculationVersionId ?? null,
        notifyCustomer: false,
      },
      tx
    );
    const [gepusht] = await tx
      .update(kvStaende)
      .set({ dealDocumentId: dokument.id, gepushtVon: wer.userId, gepushtAm: q.jetzt() })
      .where(eq(kvStaende.id, row.id))
      .returning();
    return { stand: await kopf(tx, gepusht, dokument.id), dealDocumentId: dokument.id, aufgehoben, aufhebung };
  });

  await q.nachPush(ws, deal).catch((err) => console.error("[kv-editor] Nachlauf nach Push", err));
  if (r.aufgehoben) {
    await q.annahmeGemeldet(r.aufhebung, r.aufgehoben).catch((err) => console.error("[kv-editor] Ereignis Aufhebung", err));
  }
  return { stand: r.stand, dealDocumentId: r.dealDocumentId, annahmeAufgehoben: !!r.aufgehoben };
}

// ─── KI-Chat (Aufgabe 4b in der Vertragsform) ───────────────────────────────

export async function kvChat(ws: string, deal: string, e: KvChatEingabe, userId: string, o?: KvEditorOptionen): Promise<KiAntwort> {
  const q = mitStandard(o);
  await dealPruefen(ws, deal);
  return kiChat(ws, deal, e, userId, {
    ...(q.ki ?? {}),
    stand: async (w, d, standId) => {
      const s = await standIntern(w, d, standId, q);
      const dk = await q.dealKopf(w, d);
      return { renderer: s.detail.renderer, basis: s.detail.basis, werte: s.detail.werte, firma: dk.firmaName, anrede: s.anrede };
    },
  });
}

export async function kvChatVerlauf(ws: string, deal: string, o?: KvEditorOptionen): Promise<KvChatBeitrag[]> {
  await dealPruefen(ws, deal);
  return kiVerlauf(ws, deal, o?.ki);
}

const _vertrag: KvEditorDienst = {
  ansicht,
  standLesen,
  standKopfLesen,
  standPdf,
  standAnlegen,
  neuDrucken,
  pushen,
  konflikteEntscheiden,
  uebertragen,
  kvChat,
  kvChatVerlauf,
};
void _vertrag;

// ─── Standardquellen (Lead, VPS, CRM-Renderer) ──────────────────────────────

async function dealKopfStandard(ws: string, deal: string): Promise<KvDealKopf> {
  const { loadLeadContext } = await import("./lead-context");
  const { buildDealDataForDocs } = await import("@/lib/deal-doc-data");
  const ctx = await loadLeadContext(ws, deal);
  if (!ctx) return { kunde: null, firma: null, firmaName: null };
  const daten = buildDealDataForDocs(deal, ctx as unknown as Parameters<typeof buildDealDataForDocs>[1]);
  const kunde = daten ? [daten.kunde.vorname, daten.kunde.nachname].filter(Boolean).join(" ") || null : null;
  const firmaName = (ctx as { operating_company?: { displayName?: string } | null }).operating_company?.displayName ?? null;
  return { kunde, firma: daten?.firma ?? null, firmaName };
}

/** Spec 7.4: alle für den Kunden sichtbaren Bilder (wie der Dialog), Küchenblock wie der Dialog. */
async function ausgangGrundlageVpsStandard(ws: string, deal: string): Promise<KvGrundlageVps> {
  const { getAttachmentsForDeal } = await import("./inbox");
  const bildIds = (await getAttachmentsForDeal(deal, ws))
    .filter((a) => a.mimeType.startsWith("image/") && a.customerVisible !== false)
    .map((a) => a.id);
  const quotation = await getQuotation(deal);
  if (quotation?.serviceType !== "kitchen_installation" || quotation.documentDetails?.kitchen) return { bildIds };
  const { loadLeadContext } = await import("./lead-context");
  const { buildDealDataForDocs } = await import("@/lib/deal-doc-data");
  const ctx = await loadLeadContext(ws, deal);
  const daten = ctx ? buildDealDataForDocs(deal, ctx as unknown as Parameters<typeof buildDealDataForDocs>[1]) : null;
  if (!daten) return { bildIds };
  return {
    bildIds,
    kitchen: {
      address: daten.auftrag.strecke_nach,
      date: daten.auftrag.datum,
      notes: daten.auftrag.besonderheiten,
      services: {
        installation: { owner: "company" },
        oldKitchenDismantling: { owner: "none" },
        delivery: { owner: "company" },
        worktop: { owner: "none" },
        appliances: { owner: "none" },
        connections: { owner: "none" },
        packagingRemoval: { owner: "none" },
        disposal: { owner: "none" },
      },
      components: [],
    },
  };
}

/**
 * Spec 7.1 VPS: `kvEingabeAusDeal` → Kunde aus dem Lead, Anschrift ergänzen, Pflichtangaben →
 * `attachDocumentJobContext(…, { aenderungen, nurLesen: true })`. Preise baut der Server aus der
 * Quotation; der Editor schickt nie `preise`.
 */
async function vpsPaketStandard(
  ws: string,
  deal: string,
  grundlage: KvGrundlageVps,
  aenderungen: ListeAus,
  gepruefte: ReadonlySet<string>
): Promise<KvVpsPaket> {
  const { kvEingabeAusDeal } = await import("./kv-eingabe-aus-deal");
  const { rewriteKundeParamsFromDeal } = await import("./doc-customer-name");
  const { kundeAdresseErgaenzen } = await import("./doc-kunde-adresse");
  const { angabenFehlenText, fehlendeVpsAngaben } = await import("@/lib/dokument-angaben");
  const { attachDocumentJobContext } = await import("./document-job-context");

  let params = await kvEingabeAusDeal(ws, deal, grundlage);
  if (!params) throw fehler("ANGABEN_FEHLEN", undefined, { text: KV_EDITOR_TEXT.ANGABEN_FEHLEN });
  try {
    params = await rewriteKundeParamsFromDeal(ws, params);
  } catch (err) {
    console.warn("[kv-editor] Kunde aus dem Lead nicht gesetzt:", err);
  }
  try {
    params = await kundeAdresseErgaenzen(ws, params);
  } catch (err) {
    console.warn("[kv-editor] Kundenanschrift aus dem Lead nicht geladen:", err);
  }
  const fehlt = fehlendeVpsAngaben(params);
  if (fehlt.length > 0) {
    const text = angabenFehlenText("KV", fehlt);
    throw fehler("ANGABEN_FEHLEN", text, { text });
  }
  let kontext: Awaited<ReturnType<typeof attachDocumentJobContext>>;
  try {
    kontext = await attachDocumentJobContext(ws, params, { aenderungen, nurLesen: true, gepruefte });
  } catch (err) {
    if (err instanceof KvEditorFehlerKlasse) throw err;
    const text = err instanceof Error ? err.message : "Dokumentkontext fehlgeschlagen";
    throw fehler("ANGABEN_FEHLEN", text, { text });
  }
  const details = (kontext.params.document_details ?? {}) as { inventory?: { name?: string; room?: string }[] };
  const nurLesen = (details.inventory ?? [])
    .map((z, i) => ({ z, id: kontext.inventarIds[i] }))
    .filter((x) => x.id === null)
    .map(({ z }) => ({ name: typeof z.name === "string" ? z.name : "", raum: typeof z.room === "string" && z.room ? z.room : null }));
  return {
    params: kontext.params,
    basis: kontext.kvBasis ?? { renderer: "vps", felder: [] },
    nurLesen,
    calculationVersionId: kontext.kv?.calculationVersionId ?? null,
    priceCents: kontext.kv?.priceCents ?? null,
    kvPreise: kontext.kvPreise,
  };
}

async function vpsStartenStandard(ws: string, deal: string, userId: string, paket: Record<string, unknown>): Promise<string> {
  const { fotosLaden, vpsJobStarten } = await import("./vps-dokument-start");
  const params = { ...paket };
  const ids = Array.isArray(params._image_attachment_ids)
    ? (params._image_attachment_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  delete params._image_attachment_ids;
  const fotos = await fotosLaden(ws, deal, ids);
  if (!fotos.ok) throw fehler("VPS_FEHLER", fotos.error);
  if (fotos.images.length > 0) params._images = fotos.images;
  try {
    const r = await vpsJobStarten({ ws, userId, skill: "rechnungen-und-auftragsbestaetigungen", params });
    if (r.ok) return r.jobId;
    console.error("[kv-editor] VPS-Start", r.status, r.data);
  } catch (err) {
    console.error("[kv-editor] VPS nicht erreichbar", err);
  }
  throw fehler("VPS_FEHLER");
}

async function crmFehler<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof KvEditorFehlerKlasse) throw err;
    const { CommercialDocumentError } = await import("./commercial-documents");
    if (err instanceof CommercialDocumentError) throw fehler("ANGABEN_FEHLEN", err.message, { text: err.message });
    throw err;
  }
}

async function crmBasisStandard(ws: string, deal: string, grundlage: KvGrundlageCrm) {
  return crmFehler(async () => {
    const { kvCrmBasis } = await import("./commercial-documents");
    const r = await kvCrmBasis({ workspaceId: ws, dealRecordId: deal, copy: grundlage.copy });
    return { basis: r.kvBasis, anrede: kvKiAnrede("crm", r.addressForm) };
  });
}

async function crmDruckStandard(ws: string, deal: string, grundlage: KvGrundlageCrm, aenderungen: ListeAus): Promise<KvCrmDruck> {
  return crmFehler(async () => {
    const { previewCommercialDocument } = await import("./commercial-documents");
    const r = await previewCommercialDocument({ workspaceId: ws, dealRecordId: deal, kind: "KV", copy: grundlage.copy, aenderungen });
    return {
      pdf: r.pdf,
      fileName: `${r.model.fileStem}-${crypto.randomUUID().slice(0, 8)}.pdf`,
      basis: r.kvBasis ?? { renderer: "crm", felder: [] },
      calculationVersionId: r.calculationVersionId,
    };
  });
}
