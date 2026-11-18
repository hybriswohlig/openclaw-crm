/**
 * Datenbankteil von `kvJobAbschliessen` (Plan 5a, Fix-Welle Funde 2 und 3).
 *
 * Genau einmal: Ablegen und Abschließen laufen in EINER Transaktion, und beide
 * Schreibzugriffe auf den Job verlangen die eigene Reservierung
 * (`claimed_at = <eigener Zeitpunkt>`). Wer seine Reservierung verloren hat
 * (abgelaufen, ein anderer hat neu reserviert), legt nichts ab.
 *
 * Kein veraltetes PDF: erste Anweisung ist `angebotSperren`, dieselbe Sperre
 * wie beim Sperren einer Version. Die Version der Quotation wird unter der
 * Sperre neu gelesen; wer danach eine Version sperrt, wartet auf den Commit.
 * Alles läuft über `tx`, keine zweite Verbindung unter der Sperre.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentRenderJobs } from "@/db/schema/document-render-jobs";
import { jobAblage, type RenderJob } from "@/lib/angebot-wahl";
import { angebotSperren } from "@/services/quotations";
import {
  angebotsVersionId,
  createDealDocument,
  type DealDocumentMeta,
  type DealDocumentType,
} from "@/services/deal-documents";
import { kvStaendeFehler, rechnungenDerJobsVerwerfen } from "@/services/render-jobs";
import { rechnungStatus, rechnungStellen } from "@/services/rechnungen";
import { kvStaende } from "@/db/schema/kv-editor";
import {
  KV_PDF_NICHT_PRUEFBAR_TEXT,
  KV_PREIS_ABWEICHUNG_TEXT,
  KV_STAND_VERWORFEN_TEXT,
  kvVerworfenPushText,
  type KvPreisPruefung,
} from "@/lib/kv-editor";
import { pushDazwischen } from "@/services/kv-push-regel";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** `abgelegt` ohne Dokument-ID: Entwurf des KV-Editors (PDF im Stand, nie in `deal_documents`). */
type Endstand =
  | { status: "abgelegt"; dealDocumentId: string | null }
  | { status: "verworfen" }
  | { status: "fehler"; fehler: string };

/** Nur mit eigener Reservierung und nur, solange der Job läuft. */
function eigeneReservierung(ws: string, vpsJobId: string, claimedAt: string) {
  return and(
    eq(documentRenderJobs.workspaceId, ws),
    eq(documentRenderJobs.vpsJobId, vpsJobId),
    eq(documentRenderJobs.status, "laeuft"),
    eq(documentRenderJobs.claimedAt, new Date(claimedAt))
  );
}

/**
 * Schließt den Job ab, wenn die Reservierung noch die eigene ist. Scheitert oder verfällt der Job,
 * geht ein noch druckender Stand des KV-Editors mit auf `fehler` (`standFehler`, sonst der Fehler
 * des Jobs bzw. „verworfen“).
 */
export async function abschliessenMitAnspruch(
  ws: string,
  vpsJobId: string,
  claimedAt: string,
  e: Endstand,
  ex: DbExecutor = db,
  standFehler?: string
): Promise<boolean> {
  const rows = await ex
    .update(documentRenderJobs)
    .set({
      status: e.status,
      fehler: e.status === "fehler" ? e.fehler : null,
      dealDocumentId: e.status === "abgelegt" ? e.dealDocumentId : null,
      storedAt: e.status === "abgelegt" ? sql`now()` : undefined,
    })
    .where(eigeneReservierung(ws, vpsJobId, claimedAt))
    .returning({ vpsJobId: documentRenderJobs.vpsJobId, invoiceId: documentRenderJobs.invoiceId, kvStandId: documentRenderJobs.kvStandId });
  // Plan 9: eine Rechnung, deren Job verworfen wird oder scheitert, wird nie gestellt.
  if (e.status !== "abgelegt") {
    await rechnungenDerJobsVerwerfen(ex, rows.map((r) => r.invoiceId), e.status === "fehler" ? e.fehler : "Job verworfen");
    await kvStaendeFehler(ex, rows, standFehler ?? (e.status === "fehler" ? e.fehler : KV_STAND_VERWORFEN_TEXT));
  }
  return rows.length > 0;
}

/** Text am Stand, wenn die Preisprüfung nicht `ok` ist (Spec 7.3). */
export function pruefFehlerText(p: KvPreisPruefung | null): string {
  return p?.preis === "abweichung" ? KV_PREIS_ABWEICHUNG_TEXT : KV_PDF_NICHT_PRUEFBAR_TEXT;
}

/** Erwartete Beträge, die beim Start des Drucks am Stand gespeichert wurden; null ohne Prüfung (CRM). */
export async function kvStandPruefungLaden(ws: string, standId: string): Promise<KvPreisPruefung | null> {
  const [row] = await db
    .select({ pruefung: kvStaende.pruefung })
    .from(kvStaende)
    .where(and(eq(kvStaende.workspaceId, ws), eq(kvStaende.id, standId)))
    .limit(1);
  return row?.pruefung ?? null;
}

/** Ergebnis der Preisprüfung des gerade geholten PDFs (`kvJobAbschliessenDetails`). */
export interface KvAblage {
  /** Erwartete Beträge des Stands plus Ergebnis; null, wenn der Stand keine Prüfung trägt. */
  pruefung: KvPreisPruefung | null;
}

export interface Datei {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileContent: string;
  documentType: DealDocumentType;
}

export type AblageErgebnis =
  | { art: "abgelegt"; dokument: DealDocumentMeta }
  /** `text`: Grund am Stand des KV-Editors (Push dazwischen, Preis), sonst Version veraltet. */
  | { art: "verworfen"; text?: string }
  /** KV-Editor: Entwurf im Stand abgelegt (`fertig`) oder an der Preisprüfung gescheitert (`fehler`). */
  | { art: "entwurf"; status: "fertig" | "fehler" }
  /** Reservierung nicht mehr die eigene: nichts abgelegt, Endstand neu lesen. */
  | { art: "verloren" };

/**
 * Legt das schon geholte PDF ab oder verwirft es, in einer Transaktion unter der
 * Deal-Sperre. Nachläufe (Portal-Nachricht, Wartet, Fälligkeit) ruft der
 * Aufrufer erst nach dem Commit.
 *
 * KV-Editor (Spec 7.3), vor `jobAblage` nach `kv_stand_ziel`:
 * - Ziel ohne Stand (Stand gelöscht): verwerfen.
 * - `entwurf`: PDF, Prüfung und Status nur in den Stand (`fertig` nur bei Preis `ok`), nie in
 *   `deal_documents`, keine Nachläufe; jeder Schreibzugriff nur, solange der Stand mit genau diesem
 *   Job druckt (ein spätes Ergebnis ändert einen fertigen Stand nicht).
 * - `aktuell`: wie heute, dazu Preis (mit Änderungen und ohne `ok`: verwerfen; ohne Änderungen
 *   ablegen, die Warnung bleibt am Stand), Push-Regel 7.6 Schritt 4, dann Stand verknüpfen.
 */
export async function ablegenUnterSperre(
  job: RenderJob & { claimedAt: string },
  datei: Datei,
  kv: KvAblage = { pruefung: null }
): Promise<AblageErgebnis> {
  return db.transaction(async (tx) => {
    await angebotSperren(tx, job.dealRecordId);

    // Reservierung prüfen und die Zeile bis zum Commit halten.
    const gehalten = await tx
      .update(documentRenderJobs)
      .set({ claimedAt: new Date(job.claimedAt) })
      .where(eigeneReservierung(job.workspaceId, job.vpsJobId, job.claimedAt))
      .returning({ vpsJobId: documentRenderJobs.vpsJobId, kvStandId: documentRenderJobs.kvStandId, kvStandZiel: documentRenderJobs.kvStandZiel });
    if (gehalten.length === 0) return { art: "verloren" as const };

    const verwerfen = async (standFehler?: string) => {
      await abschliessenMitAnspruch(job.workspaceId, job.vpsJobId, job.claimedAt, { status: "verworfen" }, tx, standFehler);
      return standFehler ? { art: "verworfen" as const, text: standFehler } : { art: "verworfen" as const };
    };

    // Ziel und Stand aus der gehaltenen Zeile (ON DELETE SET NULL leert nur die ID).
    const ziel = gehalten[0].kvStandZiel ?? null;
    const standId = gehalten[0].kvStandId ?? null;
    const stand =
      ziel && standId
        ? (
            await tx
              .select({ id: kvStaende.id, aenderungen: kvStaende.aenderungen, vorgaengerId: kvStaende.vorgaengerId })
              .from(kvStaende)
              .where(and(eq(kvStaende.id, standId), eq(kvStaende.workspaceId, job.workspaceId)))
              .limit(1)
          )[0] ?? null
        : null;
    if (ziel && !stand) return verwerfen();
    const druckt = stand
      ? and(eq(kvStaende.id, stand.id), eq(kvStaende.renderJobId, job.vpsJobId), eq(kvStaende.status, "druckt"))
      : undefined;
    const preisOk = kv.pruefung?.preis === "ok";

    if (ziel === "entwurf" && stand) {
      const status = preisOk ? ("fertig" as const) : ("fehler" as const);
      const gesetzt = await tx
        .update(kvStaende)
        .set({
          fileName: datei.fileName,
          fileSize: datei.fileSize,
          fileContent: datei.fileContent,
          pruefung: kv.pruefung,
          status,
          fehler: preisOk ? null : pruefFehlerText(kv.pruefung),
        })
        .where(druckt)
        .returning({ id: kvStaende.id });
      if (gesetzt.length === 0) return verwerfen();
      await abschliessenMitAnspruch(job.workspaceId, job.vpsJobId, job.claimedAt, { status: "abgelegt", dealDocumentId: null }, tx);
      return { art: "entwurf" as const, status };
    }

    const quotationVersionId =
      job.documentType === "quotation" && job.calculationVersionId !== null
        ? await angebotsVersionId(job.dealRecordId, tx)
        : null;
    // Fix-Welle I4: ein Job, dessen Rechnungsdatensatz storniert oder verworfen ist,
    // wird verworfen und nicht abgelegt (sonst stünde ein PDF ohne Datensatz im Portal).
    const rechnungWeg = job.invoiceId ? (await rechnungStatus(tx, job.invoiceId)) !== "entwurf" : false;
    const ablage = rechnungWeg ? "verwerfen" : jobAblage(job, quotationVersionId);
    if (ablage === "verwerfen") return verwerfen();

    if (ziel === "aktuell" && stand) {
      if (kv.pruefung && !preisOk && stand.aenderungen.length > 0) {
        await tx.update(kvStaende).set({ pruefung: kv.pruefung }).where(druckt);
        return verwerfen(pruefFehlerText(kv.pruefung));
      }
      const push = await pushDazwischen(tx, job.workspaceId, job.dealRecordId, stand.vorgaengerId);
      if (push) return verwerfen(kvVerworfenPushText(push.nummer));
    }

    const dokument = await createDealDocument(
      {
        workspaceId: job.workspaceId,
        dealRecordId: job.dealRecordId,
        ...datei,
        calculationVersionId: ablage === "mit_version" ? job.calculationVersionId : null,
      },
      tx
    );
    await abschliessenMitAnspruch(
      job.workspaceId,
      job.vpsJobId,
      job.claimedAt,
      { status: "abgelegt", dealDocumentId: dokument.id },
      tx
    );
    if (ziel === "aktuell" && stand) {
      // Jeder Stand behält seine Datei (Spec 5.1); eine Preiswarnung bleibt sichtbar am Stand: `fehler`
      // trägt dann den Text der Prüfung, obwohl der Stand `fertig` und aktuell ist (Aufgabe 8, Grok 2).
      await tx
        .update(kvStaende)
        .set({
          dealDocumentId: dokument.id,
          fileName: datei.fileName,
          fileSize: datei.fileSize,
          fileContent: datei.fileContent,
          pruefung: kv.pruefung,
          status: "fertig",
          fehler: kv.pruefung && !preisOk ? pruefFehlerText(kv.pruefung) : null,
        })
        .where(druckt);
    }
    if (job.invoiceId) await rechnungStellen(tx, job.invoiceId, dokument.id);
    return { art: "abgelegt" as const, dokument };
  });
}
