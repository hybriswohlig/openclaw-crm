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
import { rechnungenDerJobsVerwerfen } from "@/services/render-jobs";
import { rechnungStellen } from "@/services/rechnungen";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type Endstand =
  | { status: "abgelegt"; dealDocumentId: string }
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

/** Schließt den Job ab, wenn die Reservierung noch die eigene ist. */
export async function abschliessenMitAnspruch(
  ws: string,
  vpsJobId: string,
  claimedAt: string,
  e: Endstand,
  ex: DbExecutor = db
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
    .returning({ vpsJobId: documentRenderJobs.vpsJobId, invoiceId: documentRenderJobs.invoiceId });
  // Plan 9: eine Rechnung, deren Job verworfen wird oder scheitert, wird nie gestellt.
  if (e.status !== "abgelegt") {
    await rechnungenDerJobsVerwerfen(ex, rows.map((r) => r.invoiceId), e.status === "fehler" ? e.fehler : "Job verworfen");
  }
  return rows.length > 0;
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
  | { art: "verworfen" }
  /** Reservierung nicht mehr die eigene: nichts abgelegt, Endstand neu lesen. */
  | { art: "verloren" };

/**
 * Legt das schon geholte PDF ab oder verwirft es, in einer Transaktion unter der
 * Deal-Sperre. Nachläufe (Portal-Nachricht, Wartet, Fälligkeit) ruft der
 * Aufrufer erst nach dem Commit.
 */
export async function ablegenUnterSperre(job: RenderJob & { claimedAt: string }, datei: Datei): Promise<AblageErgebnis> {
  return db.transaction(async (tx) => {
    await angebotSperren(tx, job.dealRecordId);

    // Reservierung prüfen und die Zeile bis zum Commit halten.
    const gehalten = await tx
      .update(documentRenderJobs)
      .set({ claimedAt: new Date(job.claimedAt) })
      .where(eigeneReservierung(job.workspaceId, job.vpsJobId, job.claimedAt))
      .returning({ vpsJobId: documentRenderJobs.vpsJobId });
    if (gehalten.length === 0) return { art: "verloren" as const };

    const quotationVersionId =
      job.documentType === "quotation" && job.calculationVersionId !== null
        ? await angebotsVersionId(job.dealRecordId, tx)
        : null;
    const ablage = jobAblage(job, quotationVersionId);
    if (ablage === "verwerfen") {
      await abschliessenMitAnspruch(job.workspaceId, job.vpsJobId, job.claimedAt, { status: "verworfen" }, tx);
      return { art: "verworfen" as const };
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
    if (job.invoiceId) await rechnungStellen(tx, job.invoiceId, dokument.id);
    return { art: "abgelegt" as const, dokument };
  });
}
