/**
 * Speicher für `document_render_jobs` (Migration 0060).
 * Jede Abfrage filtert nach `workspace_id`, außer `offeneJobs` und
 * `jobsAbgelaufenMarkieren` (Cron, über alle Workspaces).
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { documentRenderJobs, type DocumentRenderJobRow } from "@/db/schema/document-render-jobs";
import { dealInvoices } from "@/db/schema/deal-invoices";
import { vormerkungenLoeschen } from "./rechnung-vormerkung";
import { kvStaende } from "@/db/schema/kv-editor";
import {
  RENDER_JOB_ABLAUF_MS,
  RENDER_JOB_RESERVIERUNG_MS,
  type RenderJob,
} from "@/lib/angebot-wahl";
import { KV_STAND_VERWORFEN_TEXT } from "@/lib/kv-editor";

/** Stand `fehler`, wenn sein Druck nie fertig wurde (Cron, RENDER_JOB_ABLAUF_MS). */
export const KV_STAND_ABGELAUFEN_TEXT = "Druck nicht fertig geworden. Bitte neu drucken.";

type NeuerJob = Omit<RenderJob, "status" | "createdAt" | "claimedAt" | "storedAt" | "dealDocumentId" | "fehler">;

function iso(wert: Date | string): string {
  return (wert instanceof Date ? wert : new Date(wert)).toISOString();
}

function zuJob(row: DocumentRenderJobRow): RenderJob {
  return {
    vpsJobId: row.vpsJobId,
    workspaceId: row.workspaceId,
    dealRecordId: row.dealRecordId,
    documentType: row.documentType,
    calculationVersionId: row.calculationVersionId,
    priceCents: row.priceCents,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
    claimedAt: row.claimedAt === null ? null : iso(row.claimedAt),
    storedAt: row.storedAt === null ? null : iso(row.storedAt),
    dealDocumentId: row.dealDocumentId,
    fehler: row.fehler,
    invoiceId: row.invoiceId ?? null,
    kvStandId: row.kvStandId ?? null,
    kvStandZiel: row.kvStandZiel ?? null,
  };
}

type Ex = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Plan 9: Rechnungsdatensätze verworfener oder gescheiterter Jobs auf
 * `verworfen` (nie gestellt; die Nummer bleibt dokumentiert, keine stille Lücke).
 */
export async function rechnungenDerJobsVerwerfen(ex: Ex, invoiceIds: (string | null | undefined)[], grund: string): Promise<void> {
  const ids = invoiceIds.filter((x): x is string => !!x);
  if (ids.length === 0) return;
  const rows = await ex
    .update(dealInvoices)
    .set({ status: "verworfen", verworfenGrund: grund.slice(0, 500), updatedAt: new Date() })
    .where(and(inArray(dealInvoices.id, ids), eq(dealInvoices.status, "entwurf")))
    .returning({ id: dealInvoices.id });
  // Rechnung anpassen (Review Grok 2): nie gestellt, also auch kein Vermerk „angepasst“.
  await vormerkungenLoeschen(ex, rows.map((r) => r.id));
}

/**
 * KV-Editor (Spec 7.3): Stände gescheiterter oder verworfener Jobs auf `fehler`, nur solange der
 * Stand noch druckt und genau dieser Job sein Druck ist. Ein fertiger Stand bleibt unverändert.
 */
export async function kvStaendeFehler(
  ex: Ex,
  jobs: { vpsJobId: string; kvStandId: string | null | undefined }[],
  fehler: string
): Promise<void> {
  for (const j of jobs) {
    if (!j.kvStandId) continue;
    await ex
      .update(kvStaende)
      .set({ status: "fehler", fehler: fehler.slice(0, 500) })
      .where(and(eq(kvStaende.id, j.kvStandId), eq(kvStaende.renderJobId, j.vpsJobId), eq(kvStaende.status, "druckt")));
  }
}

/** Legt den Job an (über `ex`, sonst `db`). Dieselbe `vps_job_id` ein zweites Mal ändert nichts. */
export async function jobAnlegen(j: NeuerJob, ex: Ex = db): Promise<void> {
  await ex
    .insert(documentRenderJobs)
    .values({
      vpsJobId: j.vpsJobId,
      workspaceId: j.workspaceId,
      dealRecordId: j.dealRecordId,
      documentType: j.documentType,
      calculationVersionId: j.calculationVersionId,
      priceCents: j.priceCents,
      createdBy: j.createdBy,
      invoiceId: j.invoiceId ?? null,
      kvStandId: j.kvStandId ?? null,
      kvStandZiel: j.kvStandZiel ?? null,
    })
    .onConflictDoNothing({ target: documentRenderJobs.vpsJobId });
}

export async function jobLaden(ws: string, vpsJobId: string): Promise<RenderJob | null> {
  const [row] = await db
    .select()
    .from(documentRenderJobs)
    .where(and(eq(documentRenderJobs.workspaceId, ws), eq(documentRenderJobs.vpsJobId, vpsJobId)))
    .limit(1);
  return row ? zuJob(row) : null;
}

/**
 * Reserviert den Job in einer Anweisung. Es gewinnt, wer `laeuft` trifft und
 * keine Reservierung jünger als RENDER_JOB_RESERVIERUNG_MS vorfindet.
 */
export async function jobReservieren(ws: string, vpsJobId: string, jetzt: Date): Promise<RenderJob | null> {
  const grenze = new Date(jetzt.getTime() - RENDER_JOB_RESERVIERUNG_MS);
  const [row] = await db
    .update(documentRenderJobs)
    .set({ claimedAt: jetzt })
    .where(
      and(
        eq(documentRenderJobs.workspaceId, ws),
        eq(documentRenderJobs.vpsJobId, vpsJobId),
        eq(documentRenderJobs.status, "laeuft"),
        or(isNull(documentRenderJobs.claimedAt), lt(documentRenderJobs.claimedAt, grenze)),
      ),
    )
    .returning();
  return row ? zuJob(row) : null;
}

/** Schließt den Job ab. `stored_at` setzt nur der Status `abgelegt` (`now()`). */
export async function jobAbschliessen(
  ws: string,
  vpsJobId: string,
  e: { status: "abgelegt" | "verworfen" | "fehler"; dealDocumentId?: string; fehler?: string },
): Promise<void> {
  const rows = await db
    .update(documentRenderJobs)
    .set({
      status: e.status,
      fehler: e.fehler ?? null,
      dealDocumentId: e.dealDocumentId,
      storedAt: e.status === "abgelegt" ? sql`now()` : undefined,
    })
    // Nur laufende Jobs: ein abgeschlossener Job wird nie überschrieben.
    .where(
      and(
        eq(documentRenderJobs.workspaceId, ws),
        eq(documentRenderJobs.vpsJobId, vpsJobId),
        eq(documentRenderJobs.status, "laeuft")
      )
    )
    .returning({ invoiceId: documentRenderJobs.invoiceId, vpsJobId: documentRenderJobs.vpsJobId, kvStandId: documentRenderJobs.kvStandId });
  if (e.status !== "abgelegt") {
    await rechnungenDerJobsVerwerfen(db, rows.map((r) => r.invoiceId), e.fehler ?? `Job ${e.status}`);
    await kvStaendeFehler(db, rows, e.fehler ?? (e.status === "verworfen" ? KV_STAND_VERWORFEN_TEXT : `Job ${e.status}`));
  }
}

/**
 * Laufende Jobs, deren Reservierung fehlt oder älter als `grenze` ist,
 * älteste zuerst, optional nur eine Dokumentart (der Cron nimmt nur KVs).
 * Einzige lesende Abfrage ohne Workspace-Filter (Cron).
 */
export async function offeneJobs(grenze: Date, limit: number, documentType?: string): Promise<RenderJob[]> {
  const rows = await db
    .select()
    .from(documentRenderJobs)
    .where(
      and(
        eq(documentRenderJobs.status, "laeuft"),
        or(isNull(documentRenderJobs.claimedAt), lt(documentRenderJobs.claimedAt, grenze)),
        documentType === undefined ? undefined : eq(documentRenderJobs.documentType, documentType),
      ),
    )
    .orderBy(asc(documentRenderJobs.createdAt))
    .limit(limit);
  return rows.map(zuJob);
}

/** Neuester KV-Job (`quotation`) zu Deal und Version in diesem Workspace; Entwürfe des KV-Editors zählen nicht. */
export async function letzterKvJob(ws: string, deal: string, versionId: string): Promise<RenderJob | null> {
  const [row] = await db
    .select()
    .from(documentRenderJobs)
    .where(
      and(
        eq(documentRenderJobs.workspaceId, ws),
        eq(documentRenderJobs.dealRecordId, deal),
        eq(documentRenderJobs.calculationVersionId, versionId),
        eq(documentRenderJobs.documentType, "quotation"),
        sql`${documentRenderJobs.kvStandZiel} IS DISTINCT FROM 'entwurf'`,
      ),
    )
    .orderBy(desc(documentRenderJobs.createdAt))
    .limit(1);
  return row ? zuJob(row) : null;
}

/**
 * Laufende Jobs älter als RENDER_JOB_ABLAUF_MS auf `fehler` / `abgelaufen` setzen.
 * Wie `offeneJobs` ohne Workspace-Filter (Cron). Gibt die Zahl der Zeilen zurück.
 */
export async function jobsAbgelaufenMarkieren(jetzt: Date): Promise<number> {
  const grenze = new Date(jetzt.getTime() - RENDER_JOB_ABLAUF_MS);
  const rows = await db
    .update(documentRenderJobs)
    .set({ status: "fehler", fehler: "abgelaufen" })
    .where(and(eq(documentRenderJobs.status, "laeuft"), lt(documentRenderJobs.createdAt, grenze)))
    .returning({ vpsJobId: documentRenderJobs.vpsJobId, invoiceId: documentRenderJobs.invoiceId, kvStandId: documentRenderJobs.kvStandId });
  await rechnungenDerJobsVerwerfen(db, rows.map((r) => r.invoiceId), "Dokumentjob abgelaufen");
  await kvStaendeFehler(db, rows, KV_STAND_ABGELAUFEN_TEXT);
  return rows.length;
}
